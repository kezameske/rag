"""Query transformation using HyDE (Hypothetical Document Embeddings).

Generates a hypothetical answer to the user's query, then embeds that
instead of the raw query. This bridges the vocabulary gap between
questions and document passages, improving retrieval accuracy.
"""
import logging

from app.db.supabase import get_supabase_client
from app.services.langsmith import get_traced_async_openai_client
from app.routers.settings import decrypt_value

logger = logging.getLogger(__name__)


def _get_llm_settings() -> dict:
    """Get LLM settings for query transformation."""
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


async def hyde_transform(query: str) -> str:
    """
    Generate a hypothetical document passage that would answer the query.

    Instead of embedding the raw question (which lives in "question space"),
    this generates a passage in "document space" — making the embedding
    much closer to actual relevant passages in the vector store.

    Args:
        query: The user's original search query

    Returns:
        A hypothetical passage that answers the query
    """
    llm_settings = _get_llm_settings()
    client = get_traced_async_openai_client(
        base_url=llm_settings["base_url"],
        api_key=llm_settings["api_key"],
    )

    response = await client.chat.completions.create(
        model=llm_settings["model"],
        messages=[
            {
                "role": "system",
                "content": (
                    "You are a helpful assistant. Given a question, write a short paragraph "
                    "(3-5 sentences) that would be found in a document answering this question. "
                    "Write it as factual document content, NOT as a response to a question. "
                    "Do not start with 'Based on' or 'According to'. Just write the passage."
                ),
            },
            {
                "role": "user",
                "content": query,
            },
        ],
        max_tokens=200,
        temperature=0.0,
    )

    hypothetical = response.choices[0].message.content or query
    logger.info(f"HyDE transform: '{query[:50]}...' -> '{hypothetical[:50]}...'")
    return hypothetical


async def expand_query(query: str) -> list[str]:
    """
    Generate multiple reformulations of the query to improve recall.

    Returns the original query plus 2 reformulations. All are used
    for search, with results deduplicated.

    Args:
        query: The user's original search query

    Returns:
        List of query strings (original + reformulations)
    """
    llm_settings = _get_llm_settings()
    client = get_traced_async_openai_client(
        base_url=llm_settings["base_url"],
        api_key=llm_settings["api_key"],
    )

    response = await client.chat.completions.create(
        model=llm_settings["model"],
        messages=[
            {
                "role": "system",
                "content": (
                    "Generate 2 alternative search queries for the given question. "
                    "Each should use different wording/synonyms to find the same information. "
                    "Return ONLY the 2 queries, one per line. No numbering or bullets."
                ),
            },
            {
                "role": "user",
                "content": query,
            },
        ],
        max_tokens=100,
        temperature=0.3,
    )

    raw = response.choices[0].message.content or ""
    reformulations = [line.strip() for line in raw.strip().split("\n") if line.strip()]

    # Return original + reformulations
    all_queries = [query] + reformulations[:2]
    logger.info(f"Query expansion: {len(all_queries)} queries from '{query[:50]}'")
    return all_queries
