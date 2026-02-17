import { useState, useEffect, useRef } from 'react'
import { Send, Square, ChevronDown, ChevronRight, Search } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Button } from '@/components/ui/button'
import { getMessages, sendMessage, updateThread } from '@/lib/api'
import type { Message } from '@/types'

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

export function ChatView({ threadId, onThreadTitleUpdate, initialMessage }: ChatViewProps) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [waiting, setWaiting] = useState(false)
  const [streamingContent, setStreamingContent] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [subAgent, setSubAgent] = useState<SubAgentState>({
    active: false, thinking: '', result: '', collapsed: false,
  })
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const abortControllerRef = useRef<AbortController | null>(null)
  const initialMessageSentRef = useRef(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

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

  const doSend = async (userMessage: string) => {
    if (!userMessage.trim() || sending) return

    const isFirstMessage = messages.length === 0
    setSending(true)
    setWaiting(true)
    setStreamingContent('')
    setError(null)
    setSubAgent({ active: false, thinking: '', result: '', collapsed: false })

    abortControllerRef.current = new AbortController()

    const tempUserMessage: Message = {
      id: `temp-${Date.now()}`,
      thread_id: threadId,
      user_id: '',
      role: 'user',
      content: userMessage,
      created_at: new Date().toISOString(),
    }
    setMessages(prev => [...prev, tempUserMessage])

    if (isFirstMessage && onThreadTitleUpdate) {
      const title = userMessage.length > 50
        ? userMessage.substring(0, 47) + '...'
        : userMessage
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
        content: userMessage,
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
    if (!input.trim() || sending) return
    const userMessage = input.trim()
    setInput('')
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
    await doSend(userMessage)
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
          created_at: new Date().toISOString(),
        } as Message,
      ])
      setStreamingContent('')
      setSubAgent({ active: false, thinking: '', result: '', collapsed: false })
    }
  }, [sending, streamingContent, threadId])

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
                        <p className="whitespace-pre-wrap">{message.content}</p>
                      </div>
                    </div>
                  ) : (
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
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {message.content}
                        </ReactMarkdown>
                      </div>
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
                  <div className="prose prose-neutral dark:prose-invert max-w-none text-[15px] leading-relaxed prose-p:my-2 prose-headings:mt-4 prose-headings:mb-2 prose-pre:bg-secondary prose-pre:border prose-pre:border-border prose-code:text-primary prose-code:font-medium">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {streamingContent}
                    </ReactMarkdown>
                  </div>
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
              className="chat-input-container flex items-end gap-3 rounded-2xl px-5 py-4 cursor-text"
              onClick={() => textareaRef.current?.focus()}
            >
              <textarea
                ref={textareaRef}
                value={input}
                onChange={handleTextareaInput}
                onKeyDown={handleKeyDown}
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
                  disabled={!input.trim()}
                  style={{
                    background: input.trim() ? 'hsl(var(--primary))' : 'hsl(var(--muted))',
                    color: input.trim() ? 'white' : 'hsl(var(--muted-foreground))',
                  }}
                >
                  <Send className="h-4 w-4" />
                </Button>
              )}
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}
