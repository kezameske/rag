"""Tool execution dispatcher."""
import json
import logging
from app.services.retrieval_service import search_documents

logger = logging.getLogger(__name__)


async def execute_tool_call(tool_call: dict, user_id: str) -> str:
    """
    Execute a tool call and return the result as a string.

    Args:
        tool_call: Dict with 'name' and 'arguments' keys
        user_id: The user's ID for context

    Returns:
        Tool result as a string
    """
    name = tool_call["name"]
    arguments = json.loads(tool_call["arguments"])

    if name == "search_documents":
        query = arguments.get("query", "")
        filters = arguments.get("filters")
        metadata_filter = filters if isinstance(filters, dict) else None

        results = await search_documents(query, user_id, metadata_filter=metadata_filter)

        if not results:
            return "No relevant documents found."

        # Format results for LLM context
        formatted = []
        for r in results:
            meta = r.get("metadata", {}) or {}
            filename = meta.get("filename", "unknown")
            # Prefer the reranker's 0-10 relevance; fall back to the hybrid/vector
            # score. Use .get() so a missing key never raises a KeyError, and
            # avoid mislabeling the hybrid RPC's RRF value as "similarity".
            rerank_score = r.get("rerank_score")
            if rerank_score is not None:
                score_str = f"relevance: {rerank_score:.1f}/10"
            else:
                score_str = f"score: {r.get('similarity', r.get('rrf_score', 0.0)):.3f}"
            doc_id = r.get("document_id", "")
            source = f"[Source: {filename}"
            if doc_id:
                source += f" | doc:{doc_id}"
            source += f" | {score_str}]"
            formatted.append(f"{source}\n{r.get('content', '')}")

        return "\n\n---\n\n".join(formatted)

    if name == "query_documents_sql":
        question = arguments.get("question", "")
        from app.services.sql_service import text_to_sql_query
        return await text_to_sql_query(question, user_id)

    # analyze_document is handled specially in chat.py, not here
    if name == "analyze_document":
        return "Error: analyze_document should be handled by the chat router"

    logger.warning(f"Unknown tool: {name}")
    return f"Error: Unknown tool '{name}'"
