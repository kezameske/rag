"""Adaptive query router: gate retrieval by query type to control latency and cost.

The router is the single gate that keeps heavy retrieval paths rare:
- none:      greetings / small talk / meta — skip retrieval entirely (no tools).
- simple:    one direct question — single search + rerank (current default).
- iterative: complex/comparative — enable corrective retrieval (CRAG).
"""
import json
import logging

from app.db.supabase import get_supabase_client
from app.services.langsmith import get_traced_async_openai_client
from app.routers.settings import decrypt_value

logger = logging.getLogger(__name__)

ROUTE_NONE = "none"
ROUTE_SIMPLE = "simple"
ROUTE_ITERATIVE = "iterative"
VALID_ROUTES = (ROUTE_NONE, ROUTE_SIMPLE, ROUTE_ITERATIVE)

ROUTER_SYSTEM = (
    "You route a user's message to a retrieval strategy. Choose one label:\n"
    "- none: greetings, small talk, or meta questions about the assistant itself — no document lookup needed.\n"
    "- simple: a single, direct question answerable by one document search.\n"
    "- iterative: a multi-part, comparative, or complex question that likely needs several searches or correction.\n"
    "Default to 'simple' when unsure."
)


def _get_llm_settings() -> dict | None:
    supabase = get_supabase_client()
    result = supabase.table("global_settings").select(
        "llm_model, llm_base_url, llm_api_key"
    ).limit(1).maybe_single().execute()
    data = result.data if result else None
    api_key = decrypt_value(data.get("llm_api_key")) if data else None
    if not api_key:
        return None
    return {
        "model": data.get("llm_model") or "gpt-4o",
        "base_url": data.get("llm_base_url") or None,
        "api_key": api_key,
    }


async def classify_query(query: str, has_docs: bool) -> str:
    """Return one of 'none' | 'simple' | 'iterative'. Falls back to 'simple' on error."""
    if not has_docs or not query.strip():
        return ROUTE_NONE
    try:
        settings = _get_llm_settings()
        if not settings:
            return ROUTE_SIMPLE
        client = get_traced_async_openai_client(
            base_url=settings["base_url"], api_key=settings["api_key"]
        )
        response = await client.chat.completions.create(
            model=settings["model"],
            messages=[
                {"role": "system", "content": ROUTER_SYSTEM},
                {"role": "user", "content": query},
            ],
            response_format={
                "type": "json_schema",
                "json_schema": {
                    "name": "route",
                    "strict": True,
                    "schema": {
                        "type": "object",
                        "properties": {
                            "route": {"type": "string", "enum": list(VALID_ROUTES)},
                        },
                        "required": ["route"],
                        "additionalProperties": False,
                    },
                },
            },
            max_tokens=20,
            temperature=0.0,
        )
        data = json.loads(response.choices[0].message.content)
        route = data.get("route", ROUTE_SIMPLE)
        if route not in VALID_ROUTES:
            route = ROUTE_SIMPLE
        logger.info(f"Query routed: '{query[:50]}' -> {route}")
        return route
    except Exception as e:
        logger.warning(f"Query routing failed, defaulting to simple: {e}")
        return ROUTE_SIMPLE
