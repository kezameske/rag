-- Phase 4: persist the citations (sources) used to answer an assistant message,
-- so the chat can re-render them (including image thumbnails) on reload.
ALTER TABLE messages ADD COLUMN IF NOT EXISTS sources jsonb;
