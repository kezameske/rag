-- Phase 1: restore a vector index for fast similarity search.
--
-- 20260123000006_flexible_embedding_dimensions.sql dropped idx_chunks_embedding
-- and made `embedding` a dimensionless `vector` (to allow configurable embedding
-- dimensions). With no index, every vector search is a SEQUENTIAL SCAN over all
-- of a user's chunks. This migration standardizes the deployment on 1536-dim
-- embeddings (the default text-embedding-3-small dimension) and adds an HNSW
-- index, which cosine-distance queries (<=>) will use.
--
-- PRECONDITION — every existing chunks.embedding must already be 1536-dim.
-- Verify BEFORE applying:
--     SELECT DISTINCT vector_dims(embedding) AS dims, count(*)
--     FROM chunks GROUP BY 1;
--   -> must return only 1536 (or no rows). If you use a different embedding
--      dimension, change every 1536 below to match and keep it consistent with
--      global_settings.embedding_dimensions.
--
-- If embeddings of mixed dimensions exist, the ALTER will fail; re-embed those
-- documents on a single model first.

ALTER TABLE chunks
  ALTER COLUMN embedding TYPE vector(1536)
  USING embedding::vector(1536);

CREATE INDEX IF NOT EXISTS idx_chunks_embedding
  ON chunks USING hnsw (embedding vector_cosine_ops);
