"""Metadata extraction from documents using LLM with structured output."""
import json
import logging
from pydantic import BaseModel

from app.db.supabase import get_supabase_client
from app.services.langsmith import get_traced_async_openai_client
from app.routers.settings import decrypt_value

logger = logging.getLogger(__name__)


class DocumentMetadata(BaseModel):
    title: str
    summary: str
    keywords: list[str]
    document_type: str
    language: str


def _get_llm_settings() -> dict:
    """Get LLM settings for metadata extraction."""
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


async def extract_metadata(document_id: str, user_id: str) -> None:
    """
    Extract structured metadata from a document using LLM.

    Fetches first ~4000 chars from document chunks, sends to LLM with
    structured output, stores result in documents.extracted_metadata.
    """
    supabase = get_supabase_client()

    try:
        # Update metadata status to processing
        supabase.table("documents").update({
            "metadata_status": "processing"
        }).eq("id", document_id).execute()

        # Fetch first 5 chunks for context
        chunks_result = supabase.table("chunks").select("content").eq(
            "document_id", document_id
        ).order("chunk_index").limit(5).execute()

        if not chunks_result.data:
            raise ValueError("No chunks found for document")

        # Concatenate chunks, truncate to ~4000 chars
        content = "\n\n".join(c["content"] for c in chunks_result.data)
        if len(content) > 4000:
            content = content[:4000]

        # Call LLM with structured output
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
                        "You are a document metadata extractor. Analyze the provided document "
                        "content and extract structured metadata. Be concise and accurate."
                    ),
                },
                {
                    "role": "user",
                    "content": (
                        f"Extract metadata from this document:\n\n{content}\n\n"
                        "Return a JSON object with: title, summary (1-2 sentences), "
                        "keywords (3-7 relevant terms), document_type (e.g. report, article, "
                        "notes, manual, spreadsheet, presentation, email, resume, contract, other), "
                        "language (e.g. English, Spanish, etc.)"
                    ),
                },
            ],
            response_format={
                "type": "json_schema",
                "json_schema": {
                    "name": "document_metadata",
                    "strict": True,
                    "schema": {
                        "type": "object",
                        "properties": {
                            "title": {"type": "string"},
                            "summary": {"type": "string"},
                            "keywords": {
                                "type": "array",
                                "items": {"type": "string"},
                            },
                            "document_type": {"type": "string"},
                            "language": {"type": "string"},
                        },
                        "required": ["title", "summary", "keywords", "document_type", "language"],
                        "additionalProperties": False,
                    },
                },
            },
        )

        # Parse and validate
        raw = json.loads(response.choices[0].message.content)
        metadata = DocumentMetadata(**raw)

        # Store metadata
        supabase.table("documents").update({
            "extracted_metadata": metadata.model_dump(),
            "metadata_status": "completed",
        }).eq("id", document_id).execute()

        logger.info(f"Metadata extracted for document {document_id}: {metadata.title}")

    except Exception as e:
        logger.error(f"Metadata extraction failed for {document_id}: {e}")
        supabase.table("documents").update({
            "metadata_status": "failed",
        }).eq("id", document_id).execute()
