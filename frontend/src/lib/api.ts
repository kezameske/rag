import { supabase } from './supabase'
import type { Thread, Message, Document } from '@/types'

const API_URL = import.meta.env.VITE_API_URL

async function getAuthHeaders(): Promise<HeadersInit> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) {
    throw new Error('Not authenticated')
  }
  return {
    'Authorization': `Bearer ${session.access_token}`,
    'Content-Type': 'application/json',
  }
}

async function fetchApi<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const headers = await getAuthHeaders()
  const response = await fetch(`${API_URL}${endpoint}`, {
    ...options,
    headers: {
      ...headers,
      ...options.headers,
    },
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Request failed' }))
    throw new Error(error.detail || 'Request failed')
  }

  return response.json()
}

// Thread API
export async function listThreads(): Promise<Thread[]> {
  return fetchApi<Thread[]>('/threads')
}

export async function createThread(title?: string): Promise<Thread> {
  return fetchApi<Thread>('/threads', {
    method: 'POST',
    body: JSON.stringify({ title }),
  })
}

export async function getThread(threadId: string): Promise<Thread> {
  return fetchApi<Thread>(`/threads/${threadId}`)
}

export async function updateThread(threadId: string, title: string): Promise<Thread> {
  return fetchApi<Thread>(`/threads/${threadId}`, {
    method: 'PATCH',
    body: JSON.stringify({ title }),
  })
}

export async function deleteThread(threadId: string): Promise<void> {
  const headers = await getAuthHeaders()
  const response = await fetch(`${API_URL}/threads/${threadId}`, {
    method: 'DELETE',
    headers,
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Request failed' }))
    throw new Error(error.detail || 'Request failed')
  }
}

// Messages API
export async function getMessages(threadId: string): Promise<Message[]> {
  return fetchApi<Message[]>(`/threads/${threadId}/messages`)
}

export interface SendMessageOptions {
  threadId: string
  content: string
  onTextDelta: (text: string) => void
  onDone: () => void
  onError: (error: string) => void
  onSubAgentStart?: (data: { document_id: string; query: string }) => void
  onSubAgentThinking?: (content: string) => void
  onSubAgentResult?: (content: string) => void
  signal?: AbortSignal
}

export async function sendMessage(options: SendMessageOptions): Promise<void> {
  const {
    threadId, content, onTextDelta, onDone, onError,
    onSubAgentStart, onSubAgentThinking, onSubAgentResult,
    signal,
  } = options

  const { data: { session } } = await supabase.auth.getSession()
  if (!session) {
    throw new Error('Not authenticated')
  }

  const response = await fetch(`${API_URL}/threads/${threadId}/messages`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ content }),
    signal,
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Request failed' }))
    throw new Error(error.detail || 'Request failed')
  }

  const reader = response.body?.getReader()
  if (!reader) {
    throw new Error('No response body')
  }

  const decoder = new TextDecoder()
  let buffer = ''
  let currentEventType = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      const chunk = decoder.decode(value, { stream: true })
      console.log('[SSE] Chunk received:', chunk.length, 'bytes at', Date.now())
      buffer += chunk
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        if (line.startsWith('event: ')) {
          currentEventType = line.slice(7).trim()
          if (currentEventType === 'done') {
            onDone()
            currentEventType = ''
          }
          continue
        }
        if (line.startsWith('data: ')) {
          const data = line.slice(6)
          try {
            const parsed = JSON.parse(data)

            switch (currentEventType) {
              case 'text_delta':
                if (parsed.content) {
                  onTextDelta(parsed.content)
                }
                break
              case 'sub_agent_start':
                onSubAgentStart?.(parsed)
                break
              case 'sub_agent_thinking':
                onSubAgentThinking?.(parsed.content)
                break
              case 'sub_agent_result':
                onSubAgentResult?.(parsed.content)
                break
              case 'error':
                if (parsed.error) {
                  onError(parsed.error)
                }
                break
              default:
                // Legacy handling for events without explicit type tracking
                if (parsed.content) {
                  onTextDelta(parsed.content)
                }
                if (parsed.error) {
                  onError(parsed.error)
                }
                break
            }
          } catch {
            // Ignore parse errors
          }
          currentEventType = ''
        }
      }
    }
  } finally {
    reader.releaseLock()
  }
}

// Documents API
export async function uploadDocument(
  file: File,
  onProgress?: (percent: number) => void,
): Promise<Document> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) {
    throw new Error('Not authenticated')
  }

  const formData = new FormData()
  formData.append('file', file)

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()

    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(Math.round((e.loaded / e.total) * 100))
      }
    })

    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(JSON.parse(xhr.responseText))
      } else {
        try {
          const err = JSON.parse(xhr.responseText)
          reject(new Error(err.detail || 'Upload failed'))
        } catch {
          reject(new Error('Upload failed'))
        }
      }
    })

    xhr.addEventListener('error', () => reject(new Error('Upload failed')))

    xhr.open('POST', `${API_URL}/documents/upload`)
    xhr.setRequestHeader('Authorization', `Bearer ${session.access_token}`)
    xhr.send(formData)
  })
}

export async function listDocuments(): Promise<Document[]> {
  return fetchApi<Document[]>('/documents')
}

export async function deleteDocument(documentId: string): Promise<void> {
  const headers = await getAuthHeaders()
  const response = await fetch(`${API_URL}/documents/${documentId}`, {
    method: 'DELETE',
    headers,
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Delete failed' }))
    throw new Error(error.detail || 'Delete failed')
  }
}

// Settings API
export interface GlobalSettings {
  llm_model: string | null
  llm_base_url: string | null
  llm_api_key: string | null
  embedding_model: string | null
  embedding_base_url: string | null
  embedding_api_key: string | null
  embedding_dimensions: number | null
  system_prompt: string | null
  has_chunks: boolean
}

export interface GlobalSettingsUpdate {
  llm_model?: string | null
  llm_base_url?: string | null
  llm_api_key?: string | null
  embedding_model?: string | null
  embedding_base_url?: string | null
  embedding_api_key?: string | null
  embedding_dimensions?: number | null
  system_prompt?: string | null
}

export async function getSettings(): Promise<GlobalSettings> {
  return fetchApi<GlobalSettings>('/settings')
}

export async function updateSettings(settings: GlobalSettingsUpdate): Promise<GlobalSettings> {
  return fetchApi<GlobalSettings>('/settings', {
    method: 'PUT',
    body: JSON.stringify(settings),
  })
}

// Users API
export interface UserInfo {
  id: string
  email: string
  created_at: string
  is_admin: boolean
  is_approved: boolean
}

export interface UserUpdate {
  is_approved?: boolean
  is_admin?: boolean
}

export async function listUsers(): Promise<UserInfo[]> {
  return fetchApi<UserInfo[]>('/users')
}

export async function updateUser(userId: string, data: UserUpdate): Promise<void> {
  return fetchApi('/users/' + userId, {
    method: 'PATCH',
    body: JSON.stringify(data),
  })
}

export async function deleteUser(userId: string): Promise<void> {
  const headers = await getAuthHeaders()
  const response = await fetch(`${API_URL}/users/${userId}`, {
    method: 'DELETE',
    headers,
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Delete failed' }))
    throw new Error(error.detail || 'Delete failed')
  }
}
