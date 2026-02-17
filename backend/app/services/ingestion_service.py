"""Ingestion orchestration: download -> extract -> chunk -> contextual embed -> store."""
import logging
from app.db.supabase import get_supabase_client
from app.services.chunking_service import chunk_text
from app.services.embedding_service import get_embeddings
from app.services.metadata_service import extract_metadata

logger = logging.getLogger(__name__)

BATCH_SIZE = 50  # embeddings per batch


async def _generate_document_context(text: str, filename: str) -> str:
    """
    Generate a short document-level context string using LLM.

    This context is prepended to each chunk before embedding, so the
    embedding model understands where the chunk fits in the broader document.
    This improves retrieval accuracy for generic or ambiguous passages.

    Returns empty string on failure (non-fatal).
    """
    try:
        from app.services.langsmith import get_traced_async_openai_client
        from app.routers.settings import decrypt_value

        supabase = get_supabase_client()
        result = supabase.table("global_settings").select(
            "llm_model, llm_base_url, llm_api_key"
        ).limit(1).maybe_single().execute()

        data = result.data if result else None
        api_key = decrypt_value(data.get("llm_api_key")) if data else None
        if not api_key:
            return ""

        client = get_traced_async_openai_client(
            base_url=data.get("llm_base_url") or None,
            api_key=api_key,
        )

        # Use first ~2000 chars for context generation
        preview = text[:2000]

        response = await client.chat.completions.create(
            model=data.get("llm_model") or "gpt-4o",
            messages=[
                {
                    "role": "system",
                    "content": (
                        "Write a very brief context sentence (15-25 words) describing "
                        "what this document is about. This will be prepended to text "
                        "chunks for better search. Be factual and specific."
                    ),
                },
                {
                    "role": "user",
                    "content": f"Filename: {filename}\n\nContent preview:\n{preview}",
                },
            ],
            max_tokens=50,
            temperature=0.0,
        )

        context = response.choices[0].message.content or ""
        context = context.strip().rstrip(".")
        logger.info(f"Document context for '{filename}': {context}")
        return context

    except Exception as e:
        logger.warning(f"Document context generation failed: {e}")
        return ""


def _prepend_context(chunks: list[str], context: str) -> list[str]:
    """Prepend document context to each chunk for contextual embeddings."""
    if not context:
        return chunks
    return [f"[Document context: {context}]\n\n{chunk}" for chunk in chunks]


async def process_document(document_id: str, user_id: str) -> None:
    """
    Process an uploaded document: extract text, chunk, contextual embed, and store.

    Pipeline:
    1. Download from Supabase Storage
    2. Extract text based on file type
    3. Chunk text with recursive splitting
    4. Generate document-level context (LLM)
    5. Prepend context to chunks for contextual embeddings
    6. Batch embed and store in pgvector
    7. Extract structured metadata (non-fatal)

    Updates document status throughout the process.
    """
    supabase = get_supabase_client()

    try:
        # Update status to processing
        supabase.table("documents").update({
            "status": "processing"
        }).eq("id", document_id).execute()

        # Get document record
        doc_result = supabase.table("documents").select("*").eq("id", document_id).single().execute()
        doc = doc_result.data

        if not doc:
            raise ValueError(f"Document {document_id} not found")

        # Download file from storage
        storage_path = doc["storage_path"]
        file_bytes = supabase.storage.from_("documents").download(storage_path)

        # Extract text based on file type
        text = extract_text(file_bytes, doc["file_type"])

        if not text.strip():
            raise ValueError("No text content extracted from document")

        # Chunk the text
        chunks = chunk_text(text)

        if not chunks:
            raise ValueError("No chunks generated from document")

        # Generate document-level context for contextual embeddings
        doc_context = await _generate_document_context(text, doc["filename"])

        # Prepend context to each chunk before embedding
        chunks_for_embedding = _prepend_context(chunks, doc_context)

        # Batch embed and store chunks
        total_chunks = 0
        for i in range(0, len(chunks), BATCH_SIZE):
            batch_raw = chunks[i:i + BATCH_SIZE]
            batch_contextual = chunks_for_embedding[i:i + BATCH_SIZE]

            # Embed the contextual version (with doc context prepended)
            embeddings = await get_embeddings(batch_contextual, user_id=user_id)

            # Store the raw chunk content (without context prefix) for display
            chunk_records = []
            for j, (chunk_content, embedding) in enumerate(zip(batch_raw, embeddings)):
                chunk_records.append({
                    "document_id": document_id,
                    "user_id": user_id,
                    "content": chunk_content,
                    "chunk_index": i + j,
                    "embedding": embedding,
                    "metadata": {
                        "filename": doc["filename"],
                        "chunk_index": i + j,
                        "doc_context": doc_context if doc_context else None,
                    },
                })

            supabase.table("chunks").insert(chunk_records).execute()
            total_chunks += len(batch_raw)

        # Update document status to completed
        supabase.table("documents").update({
            "status": "completed",
            "chunk_count": total_chunks,
        }).eq("id", document_id).execute()

        logger.info(f"Document {document_id} processed: {total_chunks} chunks created (contextual={bool(doc_context)})")

        # Extract metadata (non-fatal on error)
        try:
            await extract_metadata(document_id, user_id)
        except Exception as meta_err:
            logger.warning(f"Metadata extraction failed for {document_id}: {meta_err}")

    except Exception as e:
        logger.error(f"Error processing document {document_id}: {e}")
        supabase.table("documents").update({
            "status": "failed",
            "error_message": str(e),
        }).eq("id", document_id).execute()


def extract_text(file_bytes: bytes, file_type: str) -> str:
    """Extract text from file bytes based on file type."""
    # Plain text / markdown
    if file_type in ("text/plain", "text/markdown"):
        return file_bytes.decode("utf-8")

    # PDF
    if file_type == "application/pdf":
        return _extract_pdf(file_bytes)

    # DOCX
    if file_type == "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
        return _extract_docx(file_bytes)

    # DOC (old Word format) - try as DOCX first, fall back to raw text
    if file_type == "application/msword":
        try:
            return _extract_docx(file_bytes)
        except Exception:
            raise ValueError("Old .doc format is not supported. Please save as .docx and re-upload.")

    # Excel (XLSX/XLS)
    if file_type in (
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "application/vnd.ms-excel",
    ):
        return _extract_excel(file_bytes)

    # HTML
    if file_type == "text/html":
        return _extract_html(file_bytes)

    # CSV
    if file_type == "text/csv":
        return _extract_csv(file_bytes)

    # Fallback: try UTF-8
    try:
        return file_bytes.decode("utf-8")
    except UnicodeDecodeError:
        raise ValueError(f"Unsupported file type: {file_type}")


def _extract_pdf(file_bytes: bytes) -> str:
    """Extract text from PDF bytes."""
    import io
    from PyPDF2 import PdfReader

    reader = PdfReader(io.BytesIO(file_bytes))
    pages = []
    for page in reader.pages:
        text = page.extract_text()
        if text:
            pages.append(text)
    return "\n\n".join(pages)


def _extract_docx(file_bytes: bytes) -> str:
    """Extract text from DOCX bytes."""
    import io
    from docx import Document

    doc = Document(io.BytesIO(file_bytes))
    paragraphs = [p.text for p in doc.paragraphs if p.text.strip()]
    return "\n\n".join(paragraphs)


def _extract_excel(file_bytes: bytes) -> str:
    """Extract text from Excel bytes. Converts each sheet to readable text."""
    import io
    from openpyxl import load_workbook

    wb = load_workbook(io.BytesIO(file_bytes), read_only=True, data_only=True)
    sheets = []
    for sheet_name in wb.sheetnames:
        ws = wb[sheet_name]
        rows = []
        for row in ws.iter_rows(values_only=True):
            cells = [str(c) if c is not None else "" for c in row]
            if any(cells):
                rows.append(" | ".join(cells))
        if rows:
            sheets.append(f"## Sheet: {sheet_name}\n" + "\n".join(rows))
    wb.close()
    return "\n\n".join(sheets)


def _extract_html(file_bytes: bytes) -> str:
    """Extract text from HTML bytes. Strips scripts, styles, and nav elements."""
    from bs4 import BeautifulSoup

    soup = BeautifulSoup(file_bytes, "lxml")

    # Remove non-content elements
    for tag in soup(["script", "style", "nav", "header", "footer", "aside"]):
        tag.decompose()

    text = soup.get_text(separator="\n")
    # Clean up whitespace
    lines = [line.strip() for line in text.splitlines()]
    return "\n".join(line for line in lines if line)


def _extract_csv(file_bytes: bytes) -> str:
    """Extract text from CSV bytes. Returns pipe-separated rows."""
    import csv
    import io

    text = file_bytes.decode("utf-8")
    reader = csv.reader(io.StringIO(text))
    rows = []
    for row in reader:
        if any(cell.strip() for cell in row):
            rows.append(" | ".join(row))
    return "\n".join(rows)
