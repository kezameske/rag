-- Module 4: Metadata Extraction
-- Add extracted_metadata and metadata_status columns to documents table

ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS extracted_metadata JSONB,
  ADD COLUMN IF NOT EXISTS metadata_status TEXT DEFAULT 'pending';

-- Update match_chunks RPC to accept optional metadata filter
CREATE OR REPLACE FUNCTION match_chunks(
  query_embedding vector,
  match_threshold float,
  match_count int,
  p_user_id uuid,
  p_metadata_filter jsonb DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  document_id uuid,
  content text,
  metadata jsonb,
  similarity float
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    c.id,
    c.document_id,
    c.content,
    c.metadata,
    1 - (c.embedding <=> query_embedding) AS similarity
  FROM chunks c
  JOIN documents d ON d.id = c.document_id
  WHERE c.user_id = p_user_id
    AND 1 - (c.embedding <=> query_embedding) > match_threshold
    AND (p_metadata_filter IS NULL OR d.extracted_metadata @> p_metadata_filter)
  ORDER BY c.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;
