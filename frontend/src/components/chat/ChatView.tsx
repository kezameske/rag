import { useState, useEffect, useRef } from 'react'
import { Send, Square, ChevronDown, ChevronRight, Search, Paperclip, X } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Button } from '@/components/ui/button'
import { getMessages, sendMessage, updateThread, updateThreadScope, getThread, getChunkImageUrl } from '@/lib/api'
import type { Message, Source, MessageContentPart } from '@/types'

interface ChatViewProps {
  threadId: string
  onThreadTitleUpdate?: (threadId: string, title: string) => void
  initialMessage?: string
}

interface SubAgentState {
  active: boolean
  thinking: string
  result: string
  collapsed: boolean
}

const SUPABASE_ORIGIN = (() => {
  try {
    return new URL(import.meta.env.VITE_SUPABASE_URL).origin
  } catch {
    return ''
  }
})()

// Only render images we trust (our Supabase storage signed URLs or data URLs).
// Anything else (e.g. an LLM-emitted tracking pixel) renders as a plain link.
function SafeImg({ src, alt }: { src?: string; alt?: string }) {
  if (!src) return null
  const trusted = src.startsWith('data:image/') || (!!SUPABASE_ORIGIN && src.startsWith(SUPABASE_ORIGIN))
  if (!trusted) {
    return (
      <a href={src} target="_blank" rel="noopener noreferrer nofollow" className="text-primary underline">
        {alt || src}
      </a>
    )
  }
  return (
    <img
      src={src}
      alt={alt || ''}
      loading="lazy"
      referrerPolicy="no-referrer"
      className="max-h-72 rounded-lg border border-border"
    />
  )
}

// Resolves a retrieved image chunk to a short-lived signed URL and renders it.
function ChunkImage({ chunkId, filename }: { chunkId: string; filename: string }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let active = true
    getChunkImageUrl(chunkId)
      .then((u) => { if (active) setUrl(u) })
      .catch(() => {})
    return () => { active = false }
  }, [chunkId])
  if (!url) return null
  return <SafeImg src={url} alt={filename} />
}

// Citations row shown under an assistant answer: source chips + image thumbnails.
function Citations({ sources }: { sources?: Source[] | null }) {
  if (!sources || sources.length === 0) return null
  const images = sources.filter((s) => s.has_image && s.chunk_id)
  const seen = new Set<string>()
  const docs = sources.filter((s) => {
    const key = s.document_id || s.filename
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  return (
    <div className="ml-11 mt-3 space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {docs.map((s, i) => (
          <span
            key={`${s.document_id || s.filename}-${i}`}
            className="inline-flex items-center gap-1 rounded-md border border-border bg-secondary px-2 py-0.5 text-xs text-muted-foreground"
            title={s.snippet}
          >
            {s.content_type === 'image' ? '🖼' : '📄'} {s.filename}
            {typeof s.page_number === 'number' ? ` · p.${s.page_number + 1}` : ''}
          </span>
        ))}
      </div>
      {images.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {images.map((s) => (
            <ChunkImage key={s.chunk_id} chunkId={s.chunk_id} filename={s.filename} />
          ))}
        </div>
      )}
    </div>
  )
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

function textOf(content: string | MessageContentPart[]): string {
  if (typeof content === 'string') return content
  return content
    .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
    .map((p) => p.text)
    .join('\n')
}

function imagesOf(content: string | MessageContentPart[]): string[] {
  if (typeof content === 'string') return []
  return content
    .filter((p): p is { type: 'image_url'; image_url: { url: string } } => p.type === 'image_url')
    .map((p) => p.image_url.url)
}

// Renders a user message: attached image thumbnails + text.
function UserContent({ content }: { content: string | MessageContentPart[] }) {
  const text = textOf(content)
  const images = imagesOf(content)
  return (
    <div className="space-y-2">
      {images.length > 0 && (
        <div className="flex flex-wrap justify-end gap-2">
          {images.map((url, i) => (
            <SafeImg key={i} src={url} alt="attachment" />
          ))}
        </div>
      )}
      {text && <p className="whitespace-pre-wrap">{text}</p>}
    </div>
  )
}

export function ChatView({ threadId, onThreadTitleUpdate, initialMessage }: ChatViewProps) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [waiting, setWaiting] = useState(false)
  const [streamingContent, setStreamingContent] = useState('')
  const [streamingSources, setStreamingSources] = useState<Source[]>([])
  const [attachedImages, setAttachedImages] = useState<string[]>([])
  const [scope, setScope] = useState<string>('personal')
  const [error, setError] = useState<string | null>(null)
  const [subAgent, setSubAgent] = useState<SubAgentState>({
    active: false, thinking: '', result: '', collapsed: false,
  })
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const abortControllerRef = useRef<AbortController | null>(null)
  const initialMessageSentRef = useRef(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages, streamingContent, subAgent.thinking])

  useEffect(() => {
    let cancelled = false
    initialMessageSentRef.current = false

    const loadMessages = async () => {
      setLoading(true)
      try {
        const data = await getMessages(threadId)
        if (!cancelled) {
          setMessages(data)
        }
      } catch (error) {
        if (!cancelled) {
          console.error('Failed to load messages:', error)
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    loadMessages()
    return () => { cancelled = true }
  }, [threadId])

  useEffect(() => {
    getThread(threadId)
      .then((t) => setScope(t.scope || 'personal'))
      .catch(() => {})
  }, [threadId])

  const doSend = async (content: string | MessageContentPart[]) => {
    const text = textOf(content)
    const hasImages = imagesOf(content).length > 0
    if ((!text.trim() && !hasImages) || sending) return

    const isFirstMessage = messages.length === 0
    setSending(true)
    setWaiting(true)
    setStreamingContent('')
    setStreamingSources([])
    setError(null)
    setSubAgent({ active: false, thinking: '', result: '', collapsed: false })

    abortControllerRef.current = new AbortController()

    const tempUserMessage: Message = {
      id: `temp-${Date.now()}`,
      thread_id: threadId,
      user_id: '',
      role: 'user',
      content,
      created_at: new Date().toISOString(),
    }
    setMessages(prev => [...prev, tempUserMessage])

    if (isFirstMessage && onThreadTitleUpdate) {
      const title = text.length > 50
        ? text.substring(0, 47) + '...'
        : (text || 'Image')
      try {
        await updateThread(threadId, title)
        onThreadTitleUpdate(threadId, title)
      } catch (error) {
        console.error('Failed to update thread title:', error)
      }
    }

    try {
      await sendMessage({
        threadId,
        content,
        onTextDelta: (text) => {
          setWaiting(false)
          setStreamingContent(prev => prev + text)
        },
        onDone: () => {
          setSending(false)
          setWaiting(false)
          abortControllerRef.current = null
        },
        onError: (err) => {
          console.error('Stream error:', err)
          setError(err)
          setSending(false)
          setWaiting(false)
          abortControllerRef.current = null
        },
        onSources: (sources) => {
          setStreamingSources(sources)
        },
        onSubAgentStart: () => {
          setWaiting(false)
          setSubAgent(prev => ({
            ...prev,
            active: true,
            thinking: `Analyzing document...`,
          }))
        },
        onSubAgentThinking: (content) => {
          setSubAgent(prev => ({
            ...prev,
            thinking: content,
          }))
        },
        onSubAgentResult: (content) => {
          setSubAgent(prev => ({
            ...prev,
            active: false,
            result: content,
          }))
        },
        signal: abortControllerRef.current.signal,
      })
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        setSending(false)
        setWaiting(false)
      } else {
        console.error('Failed to send message:', err)
        setError((err as Error).message || 'Failed to send message')
        setSending(false)
        setWaiting(false)
      }
      abortControllerRef.current = null
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const text = input.trim()
    if ((!text && attachedImages.length === 0) || sending) return
    const content: string | MessageContentPart[] = attachedImages.length > 0
      ? [
          ...(text ? [{ type: 'text', text } as MessageContentPart] : []),
          ...attachedImages.map((url) => ({ type: 'image_url', image_url: { url } }) as MessageContentPart),
        ]
      : text
    setInput('')
    setAttachedImages([])
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
    await doSend(content)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit(e)
    }
  }

  const handleTextareaInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value)
    const el = e.target
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 160) + 'px'
  }

  const addImageFiles = async (files: FileList | File[]) => {
    const imgs = Array.from(files).filter((f) => f.type.startsWith('image/'))
    for (const f of imgs) {
      try {
        const url = await fileToDataUrl(f)
        setAttachedImages((prev) => [...prev, url])
      } catch {
        // ignore unreadable file
      }
    }
  }

  const handlePaste = (e: React.ClipboardEvent) => {
    const files = Array.from(e.clipboardData.items)
      .filter((it) => it.kind === 'file' && it.type.startsWith('image/'))
      .map((it) => it.getAsFile())
      .filter((f): f is File => f !== null)
    if (files.length > 0) {
      e.preventDefault()
      addImageFiles(files)
    }
  }

  useEffect(() => {
    if (!loading && initialMessage && !initialMessageSentRef.current) {
      initialMessageSentRef.current = true
      doSend(initialMessage)
    }
  }, [loading, initialMessage])

  const handleStop = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
    }
  }

  const handleScopeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value
    setScope(value)
    updateThreadScope(threadId, value).catch((err) => console.error('Failed to set scope:', err))
  }

  useEffect(() => {
    if (!sending && streamingContent) {
      setMessages(prev => [
        ...prev,
        {
          id: `assistant-${Date.now()}`,
          thread_id: threadId,
          user_id: '',
          role: 'assistant',
          content: streamingContent,
          sources: streamingSources,
          created_at: new Date().toISOString(),
        } as Message,
      ])
      setStreamingContent('')
      setStreamingSources([])
      setSubAgent({ active: false, thinking: '', result: '', collapsed: false })
    }
  }, [sending, streamingContent, threadId, streamingSources])

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex items-center gap-3">
          <span className="thinking-dot" />
          <span className="thinking-dot" />
          <span className="thinking-dot" />
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      {/* Scope selector */}
      <div className="flex items-center justify-end gap-2 border-b border-border px-6 py-2">
        <span className="text-xs text-muted-foreground">Memory</span>
        <select
          value={scope}
          onChange={handleScopeChange}
          className="rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground focus:outline-none"
        >
          <option value="personal">Personal</option>
          <option value="work">Work</option>
          <option value="shared">Shared</option>
        </select>
      </div>

      {/* Messages area */}
      <div className="chat-scroll flex-1 overflow-y-auto">
        {messages.length === 0 && !streamingContent && !waiting && !error ? (
          <div className="flex h-full items-center justify-center">
            <div className="text-center">
              <p className="font-display text-3xl tracking-tight" style={{ color: 'hsl(var(--foreground))' }}>
                Start a <span className="italic" style={{ color: 'hsl(var(--primary))' }}>conversation</span>
              </p>
              <p className="mt-2 text-sm text-muted-foreground">
                Type a message below to begin.
              </p>
            </div>
          </div>
        ) : (
          <div className="mx-auto max-w-3xl px-6 py-10">
            <div className="space-y-8">
              {messages.map((message, i) => (
                <div
                  key={message.id}
                  className="message-animate"
                  style={{ animationDelay: `${Math.min(i * 0.05, 0.3)}s` }}
                >
                  {message.role === 'user' ? (
                    <div className="flex justify-end">
                      <div
                        className="max-w-[80%] rounded-2xl rounded-br-md px-5 py-3 text-[15px] leading-relaxed"
                        style={{
                          background: 'hsl(var(--user-bubble))',
                          color: 'hsl(var(--user-bubble-fg))',
                        }}
                      >
                        <UserContent content={message.content} />
                      </div>
                    </div>
                  ) : (
                    <div>
                      <div className="flex gap-4">
                        <div
                          className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
                          style={{ background: 'hsl(var(--primary) / 0.1)' }}
                        >
                          <svg
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="hsl(var(--primary))"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <path d="M12 2L2 7l10 5 10-5-10-5z" />
                            <path d="M2 17l10 5 10-5" />
                            <path d="M2 12l10 5 10-5" />
                          </svg>
                        </div>
                        <div className="prose prose-neutral dark:prose-invert max-w-none text-[15px] leading-relaxed prose-p:my-2 prose-headings:mt-4 prose-headings:mb-2 prose-pre:bg-secondary prose-pre:border prose-pre:border-border prose-code:text-primary prose-code:font-medium">
                          <ReactMarkdown components={{ img: SafeImg as any }} remarkPlugins={[remarkGfm]}>
                            {textOf(message.content)}
                          </ReactMarkdown>
                        </div>
                      </div>
                      <Citations sources={message.sources} />
                    </div>
                  )}
                </div>
              ))}

              {/* Thinking indicator */}
              {waiting && !streamingContent && !subAgent.active && (
                <div className="message-animate flex gap-4">
                  <div
                    className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
                    style={{ background: 'hsl(var(--primary) / 0.1)' }}
                  >
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="hsl(var(--primary))"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M12 2L2 7l10 5 10-5-10-5z" />
                      <path d="M2 17l10 5 10-5" />
                      <path d="M2 12l10 5 10-5" />
                    </svg>
                  </div>
                  <div className="flex items-center gap-2 pt-2">
                    <span className="thinking-dot" />
                    <span className="thinking-dot" />
                    <span className="thinking-dot" />
                  </div>
                </div>
              )}

              {/* Sub-agent panel */}
              {(subAgent.active || subAgent.result) && (
                <div className="message-animate ml-11">
                  <div
                    className="overflow-hidden rounded-xl border transition-all"
                    style={{
                      borderColor: 'hsl(var(--primary) / 0.2)',
                      background: 'hsl(var(--primary) / 0.04)',
                    }}
                  >
                    <button
                      onClick={() => setSubAgent(prev => ({ ...prev, collapsed: !prev.collapsed }))}
                      className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-[13px] font-medium transition-colors hover:opacity-80"
                      style={{ color: 'hsl(var(--primary))' }}
                    >
                      {subAgent.collapsed ? (
                        <ChevronRight className="h-3.5 w-3.5" />
                      ) : (
                        <ChevronDown className="h-3.5 w-3.5" />
                      )}
                      <Search className="h-3.5 w-3.5" />
                      Searching documents
                      {subAgent.active && (
                        <span className="ml-1.5 flex gap-1">
                          <span className="thinking-dot" style={{ width: 4, height: 4 }} />
                          <span className="thinking-dot" style={{ width: 4, height: 4 }} />
                          <span className="thinking-dot" style={{ width: 4, height: 4 }} />
                        </span>
                      )}
                    </button>
                    {!subAgent.collapsed && (
                      <div
                        className="border-t px-4 py-3 text-[13px]"
                        style={{
                          borderColor: 'hsl(var(--primary) / 0.1)',
                          color: 'hsl(var(--muted-foreground))',
                        }}
                      >
                        {subAgent.active && subAgent.thinking && (
                          <p className="italic">{subAgent.thinking}</p>
                        )}
                        {subAgent.result && (
                          <div className="prose prose-sm prose-neutral dark:prose-invert max-w-none">
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>
                              {subAgent.result}
                            </ReactMarkdown>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Streaming message */}
              {streamingContent && (
                <div className="message-animate">
                  <div className="flex gap-4">
                    <div
                      className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
                      style={{ background: 'hsl(var(--primary) / 0.1)' }}
                    >
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="hsl(var(--primary))"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M12 2L2 7l10 5 10-5-10-5z" />
                        <path d="M2 17l10 5 10-5" />
                        <path d="M2 12l10 5 10-5" />
                      </svg>
                    </div>
                    <div className="prose prose-neutral dark:prose-invert max-w-none text-[15px] leading-relaxed prose-p:my-2 prose-headings:mt-4 prose-headings:mb-2 prose-pre:bg-secondary prose-pre:border prose-pre:border-border prose-code:text-primary prose-code:font-medium">
                      <ReactMarkdown components={{ img: SafeImg as any }} remarkPlugins={[remarkGfm]}>
                        {streamingContent}
                      </ReactMarkdown>
                    </div>
                  </div>
                  <Citations sources={streamingSources} />
                </div>
              )}

              {/* Error message */}
              {error && (
                <div
                  className="message-animate rounded-xl px-4 py-3 text-[13px]"
                  style={{
                    background: 'hsl(var(--destructive) / 0.08)',
                    color: 'hsl(var(--destructive))',
                    border: '1px solid hsl(var(--destructive) / 0.15)',
                  }}
                >
                  {error}
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>
          </div>
        )}
      </div>

      {/* Input area */}
      <div className="px-6 pb-6 pt-2">
        <div className="mx-auto max-w-3xl">
          <form onSubmit={handleSubmit}>
            <div
              className="chat-input-container rounded-2xl px-5 py-4 cursor-text"
              onClick={() => textareaRef.current?.focus()}
            >
              {attachedImages.length > 0 && (
                <div className="mb-3 flex flex-wrap gap-2">
                  {attachedImages.map((url, i) => (
                    <div key={i} className="relative">
                      <img
                        src={url}
                        alt="attachment"
                        className="h-16 w-16 rounded-lg border border-border object-cover"
                      />
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          setAttachedImages((prev) => prev.filter((_, j) => j !== i))
                        }}
                        className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-destructive text-white"
                        title="Remove"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex items-end gap-3">
                <input
                  ref={imageInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files) {
                      addImageFiles(e.target.files)
                      e.target.value = ''
                    }
                  }}
                />
                <Button
                  type="button"
                  size="icon"
                  className="h-9 w-9 shrink-0 rounded-xl"
                  onClick={(e) => {
                    e.stopPropagation()
                    imageInputRef.current?.click()
                  }}
                  disabled={sending}
                  title="Attach image"
                  style={{ background: 'transparent', color: 'hsl(var(--muted-foreground))' }}
                >
                  <Paperclip className="h-4 w-4" />
                </Button>
                <textarea
                  ref={textareaRef}
                  value={input}
                  onChange={handleTextareaInput}
                  onKeyDown={handleKeyDown}
                  onPaste={handlePaste}
                  placeholder="Ask anything..."
                  disabled={sending}
                  rows={1}
                  className="flex-1 resize-none bg-transparent text-[15px] leading-relaxed placeholder:text-muted-foreground/60 focus:outline-none disabled:opacity-50"
                  style={{ minHeight: 28, maxHeight: 160 }}
                />
                {sending ? (
                  <Button
                    type="button"
                    size="icon"
                    className="h-9 w-9 shrink-0 rounded-xl transition-all hover:scale-105"
                    onClick={handleStop}
                    title="Stop generating"
                    style={{
                      background: 'hsl(var(--destructive))',
                      color: 'white',
                    }}
                  >
                    <Square className="h-3.5 w-3.5" />
                  </Button>
                ) : (
                  <Button
                    type="submit"
                    size="icon"
                    className="h-9 w-9 shrink-0 rounded-xl transition-all hover:scale-105"
                    disabled={!input.trim() && attachedImages.length === 0}
                    style={{
                      background: (input.trim() || attachedImages.length > 0) ? 'hsl(var(--primary))' : 'hsl(var(--muted))',
                      color: (input.trim() || attachedImages.length > 0) ? 'white' : 'hsl(var(--muted-foreground))',
                    }}
                  >
                    <Send className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}
