"""LLM service using ChatCompletions API with provider abstraction."""
from typing import AsyncGenerator, Any

from fastapi import HTTPException, status

from app.db.supabase import get_supabase_client
from app.services.langsmith import get_traced_async_openai_client
from app.routers.settings import decrypt_value

SYSTEM_PROMPT = """You are a helpful assistant with access to the user's uploaded documents.

IMPORTANT RULES:
- When the user asks about their documents or any topic that might be covered in them, ALWAYS use the search_documents tool first.
- Answer based strictly on the retrieved document content. Do NOT guess, infer, or add information beyond what the documents contain.
- If the search returns relevant results, quote or closely paraphrase the source material.
- If the search returns no results or irrelevant results, say so honestly.
- When multiple chunks are returned, synthesize them into a complete answer.
- Cite the source filename when referencing document content.

TOOL USAGE GUIDANCE:
- Use search_documents for finding specific information, answering questions about document content, or searching by topic. You can pass optional filters to narrow by document_type, language, or keywords.
- Use query_documents_sql for analytical questions like counts, listings, comparisons across documents (e.g. "how many documents do I have?", "list my PDFs", "which documents mention X?").
- Use analyze_document when the user wants deep analysis of a specific document (e.g. "summarize document X in detail", "analyze the key findings in my report"). This delegates to a sub-agent that reads the full document."""

SEARCH_DOCUMENTS_TOOL = {
    "type": "function",
    "function": {
        "name": "search_documents",
        "description": "Search the user's uploaded documents for relevant information. Use this tool whenever the user asks any question about their documents, personal information, work history, or any topic that could be in their uploaded files. You can optionally filter by metadata like document_type or language.",
        "parameters": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "The search query to find relevant document content"
                },
                "filters": {
                    "type": "object",
                    "description": "Optional metadata filters. Keys can include: document_type (e.g. report, article, notes), language (e.g. English), keywords (array of terms)",
                    "properties": {
                        "document_type": {"type": "string"},
                        "language": {"type": "string"},
                    },
                }
            },
            "required": ["query"]
        }
    }
}

QUERY_SQL_TOOL = {
    "type": "function",
    "function": {
        "name": "query_documents_sql",
        "description": "Run analytical queries against the user's documents and chunks using natural language converted to SQL. Use for counting, listing, comparing, or aggregating document metadata. Examples: 'how many documents?', 'list all PDFs', 'total chunks across documents'.",
        "parameters": {
            "type": "object",
            "properties": {
                "question": {
                    "type": "string",
                    "description": "The natural language question to convert to SQL"
                }
            },
            "required": ["question"]
        }
    }
}

ANALYZE_DOCUMENT_TOOL = {
    "type": "function",
    "function": {
        "name": "analyze_document",
        "description": "Delegate deep analysis of a specific document to a sub-agent that reads the full document content. Use when the user asks to summarize, analyze, review, or deeply examine a particular document. The sub-agent loads all chunks and provides a thorough analysis.",
        "parameters": {
            "type": "object",
            "properties": {
                "document_id": {
                    "type": "string",
                    "description": "The UUID of the document to analyze"
                },
                "query": {
                    "type": "string",
                    "description": "What to analyze or what question to answer about the document"
                }
            },
            "required": ["document_id", "query"]
        }
    }
}

# Legacy alias for backward compatibility
RAG_TOOLS = [SEARCH_DOCUMENTS_TOOL]


def get_available_tools(has_docs: bool) -> list[dict] | None:
    """Return the list of tools available based on user state."""
    if not has_docs:
        return None

    return [SEARCH_DOCUMENTS_TOOL, QUERY_SQL_TOOL, ANALYZE_DOCUMENT_TOOL]


def get_global_llm_settings() -> dict[str, Any]:
    """
    Get global LLM settings from the global_settings table.

    Returns dict with keys: model, base_url, api_key
    Raises HTTPException(503) if no API key is configured.
    """
    supabase = get_supabase_client()
    result = supabase.table("global_settings").select(
        "llm_model, llm_base_url, llm_api_key"
    ).limit(1).maybe_single().execute()

    data = result.data if result else None

    api_key = decrypt_value(data.get("llm_api_key")) if data else None
    if not api_key:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="LLM not configured. An admin must configure LLM settings."
        )

    return {
        "model": data.get("llm_model") or "gpt-4o",
        "base_url": data.get("llm_base_url") or None,
        "api_key": api_key,
    }


async def astream_chat_response(
    messages: list[dict],
    tools: list[dict] | None = None,
    user_id: str | None = None,
) -> AsyncGenerator[dict[str, Any], None]:
    """
    Stream a chat response using the ChatCompletions API.

    Args:
        messages: List of message dicts with 'role' and 'content' keys
        tools: Optional list of tool definitions for function calling
        user_id: Unused, kept for API compatibility

    Yields:
        Event dicts with 'type' and additional data
    """
    llm_settings = get_global_llm_settings()
    model = llm_settings["model"]
    client = get_traced_async_openai_client(
        base_url=llm_settings["base_url"],
        api_key=llm_settings["api_key"],
    )

    request_kwargs: dict[str, Any] = {
        "model": model,
        "messages": [{"role": "system", "content": SYSTEM_PROMPT}, *messages],
        "stream": True,
    }
    if tools:
        request_kwargs["tools"] = tools

    try:
        stream = await client.chat.completions.create(**request_kwargs)

        full_response = ""
        tool_calls_buffer: dict[int, dict] = {}

        async for chunk in stream:
            delta = chunk.choices[0].delta if chunk.choices else None
            finish_reason = chunk.choices[0].finish_reason if chunk.choices else None

            if delta and delta.content:
                full_response += delta.content
                yield {"type": "text_delta", "content": delta.content}

            if delta and delta.tool_calls:
                for tc in delta.tool_calls:
                    idx = tc.index
                    if idx not in tool_calls_buffer:
                        tool_calls_buffer[idx] = {
                            "id": tc.id,
                            "name": tc.function.name if tc.function else None,
                            "arguments": "",
                        }
                    else:
                        if tc.id:
                            tool_calls_buffer[idx]["id"] = tc.id
                        if tc.function and tc.function.name:
                            tool_calls_buffer[idx]["name"] = tc.function.name
                    if tc.function and tc.function.arguments:
                        tool_calls_buffer[idx]["arguments"] += tc.function.arguments

            if finish_reason == "tool_calls":
                yield {"type": "tool_calls", "tool_calls": list(tool_calls_buffer.values())}

            if finish_reason == "stop":
                yield {"type": "response_completed", "content": full_response}

    except HTTPException:
        raise
    except Exception as e:
        yield {"type": "error", "error": str(e)}
