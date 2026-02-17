-- Module 6: Hybrid Search & Reranking
-- Add full-text search column, backfill, trigger, index, and hybrid RPC

-- Add fts tsvector column
ALTER TABLE chunks ADD COLUMN IF NOT EXISTS fts tsvector;

-- Backfill existing chunks
UPDATE chunks SET fts = to_tsvector('english', content) WHERE fts IS NULL;

-- Create trigger to auto-populate fts on insert/update
CREATE OR REPLACE FUNCTION chunks_fts_trigger()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.fts := to_tsvector('english', NEW.content);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS chunks_fts_update ON chunks;
CREATE TRIGGER chunks_fts_update
  BEFORE INSERT OR UPDATE OF content ON chunks
  FOR EACH ROW
  EXECUTE FUNCTION chunks_fts_trigger();

-- Create GIN index for full-text search
CREATE INDEX IF NOT EXISTS idx_chunks_fts ON chunks USING GIN (fts);

-- Create hybrid search RPC combining vector + FTS with RRF
CREATE OR REPLACE FUNCTION match_chunks_hybrid(
  query_embedding vector,
  query_text text,
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
DECLARE
  k constant int := 60;  -- RRF constant
BEGIN
  RETURN QUERY
  WITH vector_results AS (
    SELECT
      c.id,
      c.document_id,
      c.content,
      c.metadata,
      1 - (c.embedding <=> query_embedding) AS sim,
      ROW_NUMBER() OVER (ORDER BY c.embedding <=> query_embedding) AS rank_v
    FROM chunks c
    JOIN documents d ON d.id = c.document_id
    WHERE c.user_id = p_user_id
      AND (p_metadata_filter IS NULL OR d.extracted_metadata @> p_metadata_filter)
    ORDER BY c.embedding <=> query_embedding
    LIMIT match_count * 3
  ),
  fts_results AS (
    SELECT
      c.id,
      c.document_id,
      c.content,
      c.metadata,
      ts_rank_cd(c.fts, plainto_tsquery('english', query_text)) AS fts_rank,
      ROW_NUMBER() OVER (ORDER BY ts_rank_cd(c.fts, plainto_tsquery('english', query_text)) DESC) AS rank_f
    FROM chunks c
    JOIN documents d ON d.id = c.document_id
    WHERE c.user_id = p_user_id
      AND c.fts @@ plainto_tsquery('english', query_text)
      AND (p_metadata_filter IS NULL OR d.extracted_metadata @> p_metadata_filter)
    ORDER BY fts_rank DESC
    LIMIT match_count * 3
  ),
  combined AS (
    SELECT
      COALESCE(v.id, f.id) AS id,
      COALESCE(v.document_id, f.document_id) AS document_id,
      COALESCE(v.content, f.content) AS content,
      COALESCE(v.metadata, f.metadata) AS metadata,
      COALESCE(v.sim, 0.0) AS sim,
      (COALESCE(1.0 / (k + v.rank_v), 0.0) + COALESCE(1.0 / (k + f.rank_f), 0.0)) AS rrf_score
    FROM vector_results v
    FULL OUTER JOIN fts_results f ON v.id = f.id
  )
  SELECT
    combined.id,
    combined.document_id,
    combined.content,
    combined.metadata,
    combined.rrf_score::float AS similarity
  FROM combined
  ORDER BY combined.rrf_score DESC
  LIMIT match_count;
END;
$$;
