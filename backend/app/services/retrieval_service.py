"""Hybrid search via match_chunks_hybrid RPC with HyDE, reranking, and corrective retrieval."""
import json
import logging
from app.db.supabase import get_supabase_client
from app.services.embedding_service import get_embeddings

logger = logging.getLogger(__name__)

# Corrective-RAG: if the best reranked score is below this (0-10), rewrite the
# query and search again; if it's still below, return nothing (honest "not found").
CRAG_RERANK_CUTOFF = 5.0


def _should_use_hyde(query: str, metadata_filter: dict | None) -> bool:
    """Heuristic gate for HyDE.

    HyDE costs an extra LLM round-trip and helps natural-language questions, but
    it adds latency and can hurt precision on short keyword/identifier lookups,
    or when a metadata filter already narrows the candidate set. Skip those.
    """
    if metadata_filter:
        return False
    if len(query.split()) < 5:
        return False
    return True


def _best_rerank(candidates: list[dict]) -> float | None:
    """Best reranker score among candidates, or None if reranking didn't run."""
    scores = [c.get("rerank_score") for c in candidates if c.get("rerank_score") is not None]
    return max(scores) if scores else None


async def _expand_with_neighbors(
    chunks: list[dict], user_id: str, window: int = 1
) -> list[dict]:
    """Parent-document / small-to-big retrieval.

    Reranking runs on precise, small chunks (good for matching), but a small
    chunk can be thin context for the LLM. Here we stitch each matched chunk
    together with its `window` neighbors (by chunk_index) from the same
    document, so the model sees a fuller passage. The matched chunk's metadata
    (filename, chunk_index) is preserved for citation.
    """
    if not chunks or window <= 0:
        return chunks

    supabase = get_supabase_client()

    # document_id -> set of chunk_index values we need (match + neighbors)
    needed: dict[str, set[int]] = {}
    for c in chunks:
        doc_id = c.get("document_id")
        idx = (c.get("metadata") or {}).get("chunk_index")
        if doc_id is None or idx is None:
            continue
        bucket = needed.setdefault(doc_id, set())
        for i in range(idx - window, idx + window + 1):
            if i >= 0:
                bucket.add(i)

    # Fetch neighbor contents, one query per document
    neighbor_map: dict[str, dict[int, str]] = {}
    for doc_id, idxs in needed.items():
        try:
            res = supabase.table("chunks").select("chunk_index, content").eq(
                "document_id", doc_id
            ).eq("user_id", user_id).in_("chunk_index", sorted(idxs)).execute()
            neighbor_map[doc_id] = {
                row["chunk_index"]: row["content"] for row in (res.data or [])
            }
        except Exception as e:
            logger.warning(f"Neighbor fetch failed for document {doc_id}: {e}")

    # Stitch each match together with its neighbors, in reading order
    for c in chunks:
        doc_id = c.get("document_id")
        idx = (c.get("metadata") or {}).get("chunk_index")
        nm = neighbor_map.get(doc_id)
        if nm is None or idx is None:
            continue
        pieces = [nm[i] for i in range(idx - window, idx + window + 1) if i in nm]
        if pieces:
            c["content"] = "\n\n".join(pieces)
    return chunks


async def _retrieve_once(
    query: str,
    user_id: str,
    top_k: int,
    threshold: float,
    metadata_filter: dict | None,
) -> list[dict]:
    """One retrieval pass: HyDE (gated) -> hybrid (vector+FTS, RRF) -> rerank."""
    # Step 1: HyDE query transformation (gated — skip for short/keyword/filtered queries)
    search_text = query  # Keep original for FTS
    if _should_use_hyde(query, metadata_filter):
        try:
            from app.services.query_transform_service import hyde_transform
            hypothetical = await hyde_transform(query)
            query_embedding = await get_embeddings([hypothetical], user_id=user_id)
            logger.info("Using HyDE-transformed query for vector search")
        except Exception as e:
            logger.warning(f"HyDE transform failed, using raw query: {e}")
            query_embedding = await get_embeddings([query], user_id=user_id)
    else:
        logger.info("Skipping HyDE (short/keyword/filtered query)")
        query_embedding = await get_embeddings([query], user_id=user_id)

    supabase = get_supabase_client()
    meta_param = json.dumps(metadata_filter) if metadata_filter else None

    # Step 2: Hybrid search (vector + FTS combined with RRF)
    try:
        result = supabase.rpc("match_chunks_hybrid", {
            "query_embedding": query_embedding[0],
            "query_text": search_text,
            "match_count": top_k * 2,
            "p_user_id": user_id,
            "p_metadata_filter": meta_param,
        }).execute()
        candidates = result.data or []
    except Exception as e:
        logger.warning(f"Hybrid search failed, falling back to vector search: {e}")
        result = supabase.rpc("match_chunks", {
            "query_embedding": query_embedding[0],
            "match_threshold": threshold,
            "match_count": top_k * 2,
            "p_user_id": user_id,
            "p_metadata_filter": meta_param,
        }).execute()
        candidates = result.data or []

    # Step 3: Rerank if we have enough candidates
    if len(candidates) > top_k:
        try:
            from app.services.reranking_service import rerank_chunks
            candidates = await rerank_chunks(query, candidates, top_k)
        except Exception as e:
            logger.warning(f"Reranking failed, using raw results: {e}")
            candidates = candidates[:top_k]
    else:
        candidates = candidates[:top_k]

    return candidates


async def search_documents(
    query: str,
    user_id: str,
    top_k: int = 15,
    threshold: float = 0.3,
    metadata_filter: dict | None = None,
    corrective: bool = False,
) -> list[dict]:
    """
    Search a user's documents: HyDE + hybrid + rerank, then parent-document expansion.

    When `corrective` (the router's 'iterative' route), apply Corrective-RAG: if
    the best reranked result is weak, rewrite the query and search again; if it's
    still weak, return nothing so the model can say it honestly.
    """
    candidates = await _retrieve_once(query, user_id, top_k, threshold, metadata_filter)

    if corrective:
        best = _best_rerank(candidates)
        if best is not None and best < CRAG_RERANK_CUTOFF:
            logger.info(f"CRAG: weak results (best={best:.1f}); rewriting query")
            try:
                from app.services.query_transform_service import rewrite_query
                rewritten = await rewrite_query(query)
                if rewritten and rewritten.lower() != query.lower():
                    alt = await _retrieve_once(rewritten, user_id, top_k, threshold, metadata_filter)
                    alt_best = _best_rerank(alt)
                    if alt_best is not None and alt_best > best:
                        candidates, best = alt, alt_best
            except Exception as e:
                logger.warning(f"Corrective rewrite failed: {e}")
            if best is not None and best < CRAG_RERANK_CUTOFF:
                logger.info("CRAG: still weak after rewrite -> returning no results")
                return []

    # Parent-document expansion — stitch neighbors for fuller context
    try:
        candidates = await _expand_with_neighbors(candidates, user_id, window=1)
    except Exception as e:
        logger.warning(f"Neighbor expansion failed, using matched chunks: {e}")

    return candidates
