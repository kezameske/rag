"""Text-to-SQL service for natural language queries against documents/chunks."""
import json
import logging
import re
from pydantic import BaseModel

from app.db.supabase import get_supabase_client
from app.services.langsmith import get_traced_async_openai_client
from app.routers.settings import decrypt_value

logger = logging.getLogger(__name__)

SCHEMA_CONTEXT = """Available tables (PostgreSQL):

TABLE documents (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL,
  filename TEXT NOT NULL,
  file_type TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  storage_path TEXT,
  status TEXT NOT NULL DEFAULT 'pending',  -- pending, processing, completed, failed
  error_message TEXT,
  content_hash TEXT,
  chunk_count INTEGER DEFAULT 0,
  extracted_metadata JSONB,  -- {title, summary, keywords[], document_type, language}
  metadata_status TEXT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
);

TABLE chunks (
  id UUID PRIMARY KEY,
  document_id UUID REFERENCES documents(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  content TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  metadata JSONB,  -- {filename, chunk_index}
  created_at TIMESTAMPTZ
);

IMPORTANT:
- Always filter by user_id = '{user_id}' for security
- Only generate SELECT queries
- Use extracted_metadata->'key' for JSONB access
- Use extracted_metadata->>'key' for text comparison"""


class SQLQuery(BaseModel):
    sql: str
    explanation: str


def _get_llm_settings() -> dict:
    """Get LLM settings for SQL generation."""
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


def _validate_sql(sql: str) -> None:
    """Validate that SQL is a safe SELECT query."""
    normalized = sql.strip().lower()

    if not re.match(r'^(select|with)\s', normalized):
        raise ValueError("Only SELECT queries are allowed")

    dangerous = re.search(
        r'\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|copy|execute|exec)\b',
        normalized,
    )
    if dangerous:
        raise ValueError(f"Forbidden SQL keyword: {dangerous.group()}")


def _inject_user_filter(sql: str, user_id: str) -> str:
    """Ensure user_id filter is present in the query."""
    if user_id in sql:
        return sql
    # The LLM should include user_id, but as a safety net:
    return sql.replace("{user_id}", user_id)


async def text_to_sql_query(question: str, user_id: str) -> str:
    """
    Convert a natural language question to SQL, execute, and return results.

    Args:
        question: Natural language question
        user_id: User ID to scope the query

    Returns:
        Formatted string with SQL explanation and results
    """
    llm_settings = _get_llm_settings()
    client = get_traced_async_openai_client(
        base_url=llm_settings["base_url"],
        api_key=llm_settings["api_key"],
    )

    schema = SCHEMA_CONTEXT.replace("{user_id}", user_id)

    response = await client.chat.completions.create(
        model=llm_settings["model"],
        messages=[
            {
                "role": "system",
                "content": (
                    "You are a SQL query generator. Convert natural language questions "
                    "into PostgreSQL SELECT queries. Always include the user_id filter "
                    "for security. Return only valid SQL."
                ),
            },
            {
                "role": "user",
                "content": f"Schema:\n{schema}\n\nQuestion: {question}\n\nGenerate a SELECT query to answer this question. Include user_id = '{user_id}' in WHERE clause.",
            },
        ],
        response_format={
            "type": "json_schema",
            "json_schema": {
                "name": "sql_query",
                "strict": True,
                "schema": {
                    "type": "object",
                    "properties": {
                        "sql": {"type": "string"},
                        "explanation": {"type": "string"},
                    },
                    "required": ["sql", "explanation"],
                    "additionalProperties": False,
                },
            },
        },
    )

    raw = json.loads(response.choices[0].message.content)
    query = SQLQuery(**raw)

    # Validate and sanitize
    _validate_sql(query.sql)
    safe_sql = _inject_user_filter(query.sql, user_id)

    # Execute via RPC
    supabase = get_supabase_client()
    try:
        result = supabase.rpc("execute_readonly_query", {
            "query_text": safe_sql,
            "p_user_id": user_id,
        }).execute()

        data = result.data
        if data is None or data == []:
            data = []

        # Format results
        output = f"**Query:** {query.explanation}\n\n```sql\n{safe_sql}\n```\n\n"
        if isinstance(data, list) and len(data) > 0:
            output += f"**Results ({len(data)} rows):**\n```json\n{json.dumps(data, indent=2, default=str)}\n```"
        else:
            output += "**Results:** No rows returned."

        logger.info(f"SQL query executed: {safe_sql[:100]}")
        return output

    except Exception as e:
        error_msg = str(e)
        logger.error(f"SQL execution failed: {error_msg}")
        return f"SQL query failed: {error_msg}\n\nAttempted query:\n```sql\n{safe_sql}\n```"
