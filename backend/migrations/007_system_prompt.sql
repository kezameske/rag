-- Add system_prompt column to global_settings table
ALTER TABLE global_settings ADD COLUMN IF NOT EXISTS system_prompt TEXT;
