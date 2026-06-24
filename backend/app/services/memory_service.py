"""Long-term memory: store + recall durable user facts, scoped personal/work/shared."""
import json
import logging

from app.db.supabase import get_supabase_client
from app.services.embedding_service import get_embeddings
from app.services.langsmith import get_traced_async_openai_client
from app.routers.settings import decrypt_value

logger = logging.getLogger(__name__)

EXTRACT_SYSTEM = (
    "You extract durable, user-specific facts worth remembering across future "
    "conversations: stable preferences, ongoing projects, identity, recurring "
    "constraints. Ignore ephemeral or one-off details and anything trivial. Return "
    "an empty list if nothing is worth saving. Each memory is a single, "
    "self-contained sentence."
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


async def add_memory(user_id: str, content: str, scope: str, kind: str | None = None) -> None:
    """Embed and store a single durable memory."""
    embeddings = await get_embeddings([content], user_id=user_id)
    supabase = get_supabase_client()
    supabase.table("user_memories").insert({
        "user_id": user_id,
        "scope": scope,
        "kind": kind,
        "content": content,
        "embedding": embeddings[0],
    }).execute()


async def search_memory(query: str, user_id: str, scopes: list[str], top_k: int = 5) -> list[dict]:
    """Vector search over the user's memories, filtered to the given scopes."""
    if not query.strip():
        return []
    embeddings = await get_embeddings([query], user_id=user_id)
    supabase = get_supabase_client()
    result = supabase.rpc("match_memories", {
        "query_embedding": embeddings[0],
        "match_count": top_k,
        "p_user_id": user_id,
        "p_scopes": scopes,
    }).execute()
    return result.data or []


async def build_memory_context(user_id: str, query: str, scope: str, top_k: int = 5) -> str:
    """Return a system-prompt snippet of relevant memories, or '' if none.

    Searches the thread's scope plus 'shared' (shared memories apply everywhere).
    Non-fatal: returns '' on any error.
    """
    try:
        scopes = list({scope, "shared"})
        memories = await search_memory(query, user_id, scopes, top_k)
        memories = [m for m in memories if (m.get("similarity") or 0) > 0.3]
        if not memories:
            return ""
        lines = "\n".join(f"- {m['content']}" for m in memories)
        return (
            f"Things you remember about this user (memory scope: {scope}). "
            f"Use them when relevant; don't mention them unless asked:\n{lines}"
        )
    except Exception as e:
        logger.warning(f"Memory context build failed: {e}")
        return ""


async def extract_and_store_memories(
    user_id: str, scope: str, user_text: str, assistant_text: str
) -> None:
    """Extract durable facts from the latest exchange and store them. Fire-and-forget."""
    try:
        settings = _get_llm_settings()
        if not settings:
            return
        client = get_traced_async_openai_client(
            base_url=settings["base_url"], api_key=settings["api_key"]
        )
        response = await client.chat.completions.create(
            model=settings["model"],
            messages=[
                {"role": "system", "content": EXTRACT_SYSTEM},
                {
                    "role": "user",
                    "content": (
                        f"User said:\n{user_text}\n\nAssistant replied:\n{assistant_text}\n\n"
                        "Extract durable facts worth remembering."
                    ),
                },
            ],
            response_format={
                "type": "json_schema",
                "json_schema": {
                    "name": "memories",
                    "strict": True,
                    "schema": {
                        "type": "object",
                        "properties": {
                            "memories": {
                                "type": "array",
                                "items": {
                                    "type": "object",
                                    "properties": {
                                        "content": {"type": "string"},
                                        "kind": {"type": "string"},
                                    },
                                    "required": ["content", "kind"],
                                    "additionalProperties": False,
                                },
                            }
                        },
                        "required": ["memories"],
                        "additionalProperties": False,
                    },
                },
            },
            max_tokens=300,
            temperature=0.0,
        )
        data = json.loads(response.choices[0].message.content)
        for m in data.get("memories", []):
            content = (m.get("content") or "").strip()
            if content:
                try:
                    await add_memory(user_id, content, scope, m.get("kind"))
                except Exception as e:
                    logger.warning(f"add_memory failed: {e}")
    except Exception as e:
        logger.warning(f"Memory extraction failed: {e}")
