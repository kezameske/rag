"""LLM-based reranking of search results."""
import json
import logging
from pydantic import BaseModel

from app.services.langsmith import get_traced_async_openai_client
from app.routers.settings import decrypt_value
from app.db.supabase import get_supabase_client

logger = logging.getLogger(__name__)


class RelevanceScore(BaseModel):
    index: int
    score: float


def _get_llm_settings() -> dict:
    """Get LLM settings for reranking."""
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


async def rerank_chunks(query: str, chunks: list[dict], top_k: int = 10) -> list[dict]:
    """
    Rerank search result chunks using LLM relevance scoring.

    Args:
        query: The original search query
        chunks: List of chunk dicts with 'content' key
        top_k: Number of top results to return

    Returns:
        Reranked list of chunks, sorted by relevance
    """
    if not chunks:
        return []

    llm_settings = _get_llm_settings()
    client = get_traced_async_openai_client(
        base_url=llm_settings["base_url"],
        api_key=llm_settings["api_key"],
    )

    # Build passages list for the prompt
    passages = []
    for i, chunk in enumerate(chunks):
        content = chunk.get("content", "")[:500]  # Truncate for prompt size
        passages.append(f"[{i}] {content}")

    passages_text = "\n\n".join(passages)

    response = await client.chat.completions.create(
        model=llm_settings["model"],
        messages=[
            {
                "role": "system",
                "content": "You are a relevance scoring system. Rate how relevant each passage is to the query on a scale of 0-10. Return only a JSON array of objects with 'index' and 'score' keys.",
            },
            {
                "role": "user",
                "content": f"Query: {query}\n\nPassages:\n{passages_text}\n\nRate each passage's relevance (0-10). Return JSON array: [{{\"index\": 0, \"score\": 8}}, ...]",
            },
        ],
        response_format={
            "type": "json_schema",
            "json_schema": {
                "name": "relevance_scores",
                "strict": True,
                "schema": {
                    "type": "object",
                    "properties": {
                        "scores": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "index": {"type": "integer"},
                                    "score": {"type": "number"},
                                },
                                "required": ["index", "score"],
                                "additionalProperties": False,
                            },
                        }
                    },
                    "required": ["scores"],
                    "additionalProperties": False,
                },
            },
        },
    )

    raw = json.loads(response.choices[0].message.content)
    scores = raw.get("scores", [])

    # Sort by score descending, map back to chunks
    scores.sort(key=lambda x: x["score"], reverse=True)

    reranked = []
    for s in scores[:top_k]:
        idx = s["index"]
        if 0 <= idx < len(chunks):
            reranked.append(chunks[idx])

    logger.info(f"Reranked {len(chunks)} chunks to top {len(reranked)}")
    return reranked
