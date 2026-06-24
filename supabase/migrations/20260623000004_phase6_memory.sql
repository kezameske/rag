-- Phase 6: cross-thread memory with personal/work scoping.

-- Per-thread scope drives which memories are recalled during, and tagged onto
-- memories extracted from, that conversation.
ALTER TABLE threads ADD COLUMN IF NOT EXISTS scope text NOT NULL DEFAULT 'personal'
  CHECK (scope IN ('personal', 'work', 'shared'));

-- Durable, user-scoped memories (facts / preferences) with their own embeddings.
CREATE TABLE IF NOT EXISTS user_memories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  scope text NOT NULL DEFAULT 'personal' CHECK (scope IN ('personal', 'work', 'shared')),
  kind text,
  content text NOT NULL,
  embedding vector(1536),
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_memories_user ON user_memories(user_id);
CREATE INDEX IF NOT EXISTS idx_user_memories_embedding
  ON user_memories USING hnsw (embedding vector_cosine_ops);

ALTER TABLE user_memories ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "users_own_memories" ON user_memories;
CREATE POLICY "users_own_memories" ON user_memories FOR ALL USING (auth.uid() = user_id);

-- Similarity search over a user's memories, filtered to a set of scopes.
CREATE OR REPLACE FUNCTION match_memories(
  query_embedding vector,
  match_count int,
  p_user_id uuid,
  p_scopes text[]
) RETURNS TABLE (id uuid, scope text, kind text, content text, similarity float)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  SELECT m.id, m.scope, m.kind, m.content,
         1 - (m.embedding <=> query_embedding) AS similarity
  FROM user_memories m
  WHERE m.user_id = p_user_id
    AND (p_scopes IS NULL OR m.scope = ANY(p_scopes))
  ORDER BY m.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;
