"""Hybrid search via match_chunks_hybrid RPC with HyDE query transformation and reranking."""
import json
import logging
from app.db.supabase import get_supabase_client
from app.services.embedding_service import get_embeddings

logger = logging.getLogger(__name__)


async def search_documents(
    query: str,
    user_id: str,
    top_k: int = 10,
    threshold: float = 0.3,
    metadata_filter: dict | None = None,
) -> list[dict]:
    """
    Search user's documents using HyDE + hybrid search (vector + FTS with RRF) + reranking.

    Pipeline:
    1. HyDE: Generate hypothetical answer passage, embed that for vector search
    2. Hybrid: Run vector + full-text search in parallel, combine with RRF
    3. Rerank: LLM scores relevance of candidates, returns top_k

    Falls back gracefully if any stage fails.

    Args:
        query: Search query text
        user_id: The user's ID for RLS filtering
        top_k: Maximum number of results
        threshold: Minimum similarity threshold (used in fallback only)
        metadata_filter: Optional JSONB filter for document metadata

    Returns:
        List of matching chunks with similarity scores
    """
    # Step 1: HyDE query transformation
    search_text = query  # Keep original for FTS
    try:
        from app.services.query_transform_service import hyde_transform
        hypothetical = await hyde_transform(query)
        # Embed the hypothetical passage instead of the raw query
        query_embedding = await get_embeddings([hypothetical], user_id=user_id)
        logger.info("Using HyDE-transformed query for vector search")
    except Exception as e:
        logger.warning(f"HyDE transform failed, using raw query: {e}")
        query_embedding = await get_embeddings([query], user_id=user_id)

    supabase = get_supabase_client()

    # Build metadata filter param
    meta_param = json.dumps(metadata_filter) if metadata_filter else None

    # Step 2: Hybrid search (vector + FTS combined with RRF)
    try:
        result = supabase.rpc("match_chunks_hybrid", {
            "query_embedding": query_embedding[0],
            "query_text": search_text,  # Original query for FTS keyword matching
            "match_count": top_k * 2,   # Fetch extra for reranking
            "p_user_id": user_id,
            "p_metadata_filter": meta_param,
        }).execute()

        candidates = result.data or []

    except Exception as e:
        logger.warning(f"Hybrid search failed, falling back to vector search: {e}")
        # Fallback to vector-only search
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
