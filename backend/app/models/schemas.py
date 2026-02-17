from pydantic import BaseModel
from datetime import datetime


class ThreadCreate(BaseModel):
    title: str | None = "New Chat"


class ThreadResponse(BaseModel):
    id: str
    user_id: str
    title: str
    created_at: datetime
    updated_at: datetime


class ThreadUpdate(BaseModel):
    title: str


class MessageCreate(BaseModel):
    content: str


class MessageResponse(BaseModel):
    id: str
    thread_id: str
    user_id: str
    role: str
    content: str
    tool_calls: list | None = None
    created_at: datetime


class DocumentResponse(BaseModel):
    id: str
    user_id: str
    filename: str
    file_type: str
    file_size: int
    storage_path: str
    status: str
    error_message: str | None = None
    content_hash: str | None = None
    chunk_count: int = 0
    extracted_metadata: dict | None = None
    metadata_status: str | None = None
    created_at: datetime
    updated_at: datetime
