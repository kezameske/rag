"""Sub-agent service for deep document analysis."""
import logging
from typing import AsyncGenerator

from app.db.supabase import get_supabase_client
from app.services.langsmith import get_traced_async_openai_client
from app.routers.settings import decrypt_value

logger = logging.getLogger(__name__)

MAX_CONTENT_LENGTH = 100_000  # ~100k chars


def _get_llm_settings() -> dict:
    """Get LLM settings for sub-agent."""
    supabase = get_supabase_client()
    result = supabase.table("global_settings").select(
        "llm_model, llm_base_url, llm_api_key"
    ).limit(1).maybe_single().execute()

    data = result.data if result else None
    api_key = decrypt_value(data.get("llm_api_key")) if data else None
    if not api_key:
        raise ValueError("LLM not configured")

    return {
        "model": data.get("llm_model") or "gpt-4o",
        "base_url": data.get("llm_base_url") or None,
        "api_key": api_key,
    }


async def run_sub_agent(
    document_id: str,
    query: str,
    user_id: str,
) -> AsyncGenerator[dict, None]:
    """
    Run a sub-agent that analyzes a full document.

    Loads all chunks for the document, sends to LLM with the user's query,
    and yields progress events.

    Yields:
        - {"type": "sub_agent_thinking", "content": "..."}
        - {"type": "sub_agent_result", "content": "..."}
    """
    supabase = get_supabase_client()

    # Verify document belongs to user
    doc_result = supabase.table("documents").select("id, filename").eq(
        "id", document_id
    ).eq("user_id", user_id).maybe_single().execute()

    if not doc_result.data:
        yield {"type": "sub_agent_result", "content": "Error: Document not found or access denied."}
        return

    filename = doc_result.data["filename"]

    # Load all chunks
    chunks_result = supabase.table("chunks").select("content").eq(
        "document_id", document_id
    ).order("chunk_index").execute()

    if not chunks_result.data:
        yield {"type": "sub_agent_result", "content": "Error: No content found for this document."}
        return

    # Concatenate all chunks
    full_content = "\n\n".join(c["content"] for c in chunks_result.data)
    if len(full_content) > MAX_CONTENT_LENGTH:
        full_content = full_content[:MAX_CONTENT_LENGTH] + "\n\n[Content truncated...]"

    yield {"type": "sub_agent_thinking", "content": f"Reading {filename} ({len(chunks_result.data)} chunks)..."}

    # Call LLM with full document context
    llm_settings = _get_llm_settings()
    client = get_traced_async_openai_client(
        base_url=llm_settings["base_url"],
        api_key=llm_settings["api_key"],
    )

    yield {"type": "sub_agent_thinking", "content": "Analyzing document content..."}

    try:
        response = await client.chat.completions.create(
            model=llm_settings["model"],
            messages=[
                {
                    "role": "system",
                    "content": (
                        f"You are analyzing the document '{filename}'. "
                        "The full document content is provided below. "
                        "Answer the user's question thoroughly based on the document content. "
                        "Be detailed and comprehensive in your analysis."
                    ),
                },
                {
                    "role": "user",
                    "content": f"Document content:\n\n{full_content}\n\n---\n\nQuestion: {query}",
                },
            ],
        )

        result = response.choices[0].message.content or "No analysis generated."
        yield {"type": "sub_agent_result", "content": result}

    except Exception as e:
        logger.error(f"Sub-agent error for document {document_id}: {e}")
        yield {"type": "sub_agent_result", "content": f"Error during analysis: {str(e)}"}
