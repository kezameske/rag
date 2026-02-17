-- Module 8: Sub-Agents
-- Add tool_calls column to messages table

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS tool_calls JSONB;
