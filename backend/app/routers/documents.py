"""Document upload, list, and delete endpoints."""
import hashlib
import uuid
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, BackgroundTasks, status

from app.dependencies import get_approved_user, User
from app.db.supabase import get_supabase_client
from app.services.ingestion_service import process_document

router = APIRouter(prefix="/documents", tags=["documents"])

ALLOWED_TYPES = {
    "text/plain": ".txt",
    "text/markdown": ".md",
    "application/pdf": ".pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
    "application/msword": ".doc",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
    "application/vnd.ms-excel": ".xls",
    "text/html": ".html",
    "text/csv": ".csv",
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "application/octet-stream": None,  # fallback, check extension
}
ALLOWED_EXTENSIONS = {
    ".txt", ".md", ".pdf", ".docx", ".doc", ".xlsx", ".xls", ".html", ".csv",
    ".png", ".jpg", ".jpeg", ".webp", ".gif",
}
MAX_FILE_SIZE = 50 * 1024 * 1024  # 50 MB


@router.post("/upload")
async def upload_document(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    current_user: User = Depends(get_approved_user),
):
    """Upload a document for ingestion."""
    # Validate file extension
    filename = file.filename or "unknown"
    ext = "." + filename.rsplit(".", 1)[-1].lower() if "." in filename else ""

    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unsupported file type. Allowed: {', '.join(ALLOWED_EXTENSIONS)}"
        )

    # Read file content
    content = await file.read()

    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="File too large. Maximum size is 50 MB."
        )

    if len(content) == 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="File is empty."
        )

    # Compute content hash for deduplication
    content_hash = hashlib.sha256(content).hexdigest()

    supabase = get_supabase_client()

    # Check for exact duplicate (same content already active)
    existing = supabase.table("documents").select("id, filename, status").eq(
        "user_id", current_user.id
    ).eq("content_hash", content_hash).in_(
        "status", ["pending", "processing", "completed"]
    ).limit(1).execute()

    if existing.data:
        match = existing.data[0]
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f'Duplicate content: this file is identical to "{match["filename"]}" which is already processed.'
        )

    # Auto-replace: if same filename exists with different content, delete old version
    same_name = supabase.table("documents").select("id, storage_path").eq(
        "user_id", current_user.id
    ).eq("filename", filename).eq("status", "completed").execute()

    for old_doc in (same_name.data or []):
        try:
            supabase.storage.from_("documents").remove([old_doc["storage_path"]])
        except Exception:
            pass
        supabase.table("documents").delete().eq("id", old_doc["id"]).execute()

    # Determine content type from extension
    ext_to_content_type = {
        ".txt": "text/plain",
        ".md": "text/markdown",
        ".pdf": "application/pdf",
        ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ".doc": "application/msword",
        ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        ".xls": "application/vnd.ms-excel",
        ".html": "text/html",
        ".csv": "text/csv",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".webp": "image/webp",
        ".gif": "image/gif",
    }
    content_type = ext_to_content_type.get(ext, file.content_type or "text/plain")

    # Upload to Supabase Storage
    file_id = str(uuid.uuid4())
    storage_path = f"{current_user.id}/{file_id}{ext}"

    supabase.storage.from_("documents").upload(
        path=storage_path,
        file=content,
        file_options={"content-type": content_type},
    )

    # Create document record
    doc_record = {
        "user_id": current_user.id,
        "filename": filename,
        "file_type": content_type,
        "file_size": len(content),
        "storage_path": storage_path,
        "status": "pending",
        "content_hash": content_hash,
    }

    result = supabase.table("documents").insert(doc_record).execute()

    if not result.data:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to create document record"
        )

    document = result.data[0]

    # Trigger background processing
    background_tasks.add_task(process_document, document["id"], current_user.id)

    return document


@router.get("")
async def list_documents(current_user: User = Depends(get_approved_user)):
    """List all documents for the current user."""
    supabase = get_supabase_client()
    result = supabase.table("documents").select("*").eq(
        "user_id", current_user.id
    ).order("created_at", desc=True).execute()

    return result.data


@router.get("/chunks/{chunk_id}/image-url")
async def get_chunk_image_url(
    chunk_id: str,
    current_user: User = Depends(get_approved_user),
):
    """Return a short-lived signed URL for a retrieved image chunk's source image.

    The service-role client bypasses RLS, so the explicit user_id filter below is
    the access check. The signed URL is short-lived and resolved fresh each call.
    """
    supabase = get_supabase_client()
    result = supabase.table("chunks").select("metadata").eq(
        "id", chunk_id
    ).eq("user_id", current_user.id).maybe_single().execute()

    if not result or not result.data:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Chunk not found")

    image_path = (result.data.get("metadata") or {}).get("image_path")
    if not image_path:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No image for this chunk")

    try:
        signed = supabase.storage.from_("documents").create_signed_url(image_path, 300)
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))

    url = None
    if isinstance(signed, dict):
        url = signed.get("signedURL") or signed.get("signedUrl") or signed.get("signed_url")
    if not url:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Could not create signed URL",
        )
    return {"url": url}


@router.delete("/{document_id}")
async def delete_document(
    document_id: str,
    current_user: User = Depends(get_approved_user),
):
    """Delete a document and its storage file (chunks cascade via FK)."""
    supabase = get_supabase_client()

    # Get document (RLS ensures user owns it)
    result = supabase.table("documents").select("*").eq(
        "id", document_id
    ).eq("user_id", current_user.id).single().execute()

    if not result.data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Document not found"
        )

    doc = result.data

    # Delete from storage
    try:
        supabase.storage.from_("documents").remove([doc["storage_path"]])
    except Exception:
        pass  # Storage file may already be gone

    # Delete document record (chunks cascade)
    supabase.table("documents").delete().eq("id", document_id).execute()

    return {"status": "deleted"}
