"""Tool execution dispatcher."""
import json
import logging
from app.services.retrieval_service import search_documents

logger = logging.getLogger(__name__)


async def execute_tool_call(tool_call: dict, user_id: str, corrective: bool = False) -> tuple[str, list]:
    """
    Execute a tool call.

    Returns:
        (result_text, sources) where result_text is the tool output fed back to the
        model, and sources is a list of structured citations (non-empty only for
        search_documents) for the frontend to render and for persistence.
    """
    name = tool_call["name"]
    arguments = json.loads(tool_call["arguments"])

    if name == "search_documents":
        query = arguments.get("query", "")
        filters = arguments.get("filters")
        metadata_filter = filters if isinstance(filters, dict) else None

        results = await search_documents(query, user_id, metadata_filter=metadata_filter, corrective=corrective)

        if not results:
            return "No relevant documents found.", []

        formatted = []
        sources = []
        for r in results:
            meta = r.get("metadata", {}) or {}
            filename = meta.get("filename", "unknown")
            ctype = meta.get("content_type", "text")
            page = meta.get("page_number")
            # Prefer the reranker's 0-10 relevance; fall back to the hybrid/vector
            # score. Use .get() so a missing key never raises a KeyError, and
            # avoid mislabeling the hybrid RPC's RRF value as "similarity".
            rerank_score = r.get("rerank_score")
            if rerank_score is not None:
                score_str = f"relevance: {rerank_score:.1f}/10"
            else:
                score_str = f"score: {r.get('similarity', r.get('rrf_score', 0.0)):.3f}"
            doc_id = r.get("document_id", "")
            # Image chunks carry a vision-model caption as their content; flag them
            # so the model knows the source is an image/figure (and can cite it).
            label = "Image" if ctype == "image" else "Source"
            loc = f", page {page + 1}" if isinstance(page, int) else ""
            source_line = f"[{label}: {filename}{loc}"
            if doc_id:
                source_line += f" | doc:{doc_id}"
            source_line += f" | {score_str}]"
            formatted.append(f"{source_line}\n{r.get('content', '')}")

            sources.append({
                "chunk_id": r.get("id"),
                "document_id": doc_id or None,
                "filename": filename,
                "content_type": ctype,
                "page_number": page,
                "has_image": bool(meta.get("image_path")),
                "snippet": (r.get("content") or "")[:160],
            })

        return "\n\n---\n\n".join(formatted), sources

    if name == "query_documents_sql":
        question = arguments.get("question", "")
        from app.services.sql_service import text_to_sql_query
        return await text_to_sql_query(question, user_id), []

    # analyze_document is handled specially in chat.py, not here
    if name == "analyze_document":
        return "Error: analyze_document should be handled by the chat router", []

    logger.warning(f"Unknown tool: {name}")
    return f"Error: Unknown tool '{name}'", []
