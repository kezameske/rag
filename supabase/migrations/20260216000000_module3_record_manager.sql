-- Module 3: Record Manager - Content hashing for deduplication

-- Add content_hash column for duplicate detection
ALTER TABLE documents ADD COLUMN content_hash TEXT;

-- Index for fast duplicate lookups per user
CREATE INDEX idx_documents_user_hash ON documents(user_id, content_hash);
