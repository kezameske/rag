export interface Thread {
  id: string
  user_id: string
  title: string
  scope?: string
  created_at: string
  updated_at: string
}

export type MessageContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }

export interface Message {
  id: string
  thread_id: string
  user_id: string
  role: 'user' | 'assistant'
  content: string | MessageContentPart[]
  tool_calls?: ToolCall[] | null
  sources?: Source[] | null
  created_at: string
}

export interface ToolCall {
  name: string
  arguments: string
  result?: string
}

export interface Source {
  chunk_id: string
  document_id: string | null
  filename: string
  content_type: 'text' | 'image'
  page_number: number | null
  has_image: boolean
  snippet: string
}

export interface DocumentMetadata {
  title: string
  summary: string
  keywords: string[]
  document_type: string
  language: string
}

export interface Document {
  id: string
  user_id: string
  filename: string
  file_type: string
  file_size: number
  storage_path: string
  status: 'pending' | 'processing' | 'completed' | 'failed'
  error_message: string | null
  content_hash: string | null
  chunk_count: number
  has_images?: boolean
  extracted_metadata: DocumentMetadata | null
  metadata_status: string | null
  created_at: string
  updated_at: string
}
