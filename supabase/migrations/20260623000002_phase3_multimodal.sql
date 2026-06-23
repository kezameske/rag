-- Phase 2/3: multimodal foundation
--
-- (Phase 2) messages.content -> jsonb so a message can hold either a plain string
-- OR an array of content parts (text + image) for vision chat. Existing text
-- rows convert to JSON strings; NOT NULL is preserved.
ALTER TABLE messages ALTER COLUMN content TYPE jsonb USING to_jsonb(content);

-- (Phase 3) flag documents that contain image content (uploaded images, or
-- captioned PDF pages). Image provenance per chunk lives in chunks.metadata
-- ({content_type, image_path, page_number}), so no chunks/RPC change is needed.
ALTER TABLE documents ADD COLUMN IF NOT EXISTS has_images boolean NOT NULL DEFAULT false;
