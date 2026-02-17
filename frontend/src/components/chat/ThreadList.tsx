import { useState, useEffect, forwardRef, useImperativeHandle } from 'react'
import { Plus, Trash2, MessageSquare } from 'lucide-react'
import { listThreads, createThread, deleteThread } from '@/lib/api'
import type { Thread } from '@/types'

interface ThreadListProps {
  selectedThreadId: string | null
  onSelectThread: (threadId: string) => void
}

export interface ThreadListRef {
  updateThreadTitle: (threadId: string, title: string) => void
  addThread: (thread: Thread) => void
}

export const ThreadList = forwardRef<ThreadListRef, ThreadListProps>(
  function ThreadList({ selectedThreadId, onSelectThread }, ref) {
  const [threads, setThreads] = useState<Thread[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)

  useImperativeHandle(ref, () => ({
    updateThreadTitle: (threadId: string, title: string) => {
      setThreads(prev => prev.map(t =>
        t.id === threadId ? { ...t, title } : t
      ))
    },
    addThread: (thread: Thread) => {
      setThreads(prev => [thread, ...prev])
    }
  }))

  const loadThreads = async () => {
    try {
      const data = await listThreads()
      setThreads(data)
    } catch (error) {
      console.error('Failed to load threads:', error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadThreads()
  }, [])

  const handleCreateThread = async () => {
    setCreating(true)
    try {
      const newThread = await createThread()
      setThreads(prev => [newThread, ...prev])
      onSelectThread(newThread.id)
    } catch (error) {
      console.error('Failed to create thread:', error)
    } finally {
      setCreating(false)
    }
  }

  const handleDeleteThread = async (e: React.MouseEvent, threadId: string) => {
    e.stopPropagation()
    try {
      await deleteThread(threadId)
      setThreads(prev => prev.filter(t => t.id !== threadId))
      if (selectedThreadId === threadId) {
        onSelectThread('')
      }
    } catch (error) {
      console.error('Failed to delete thread:', error)
    }
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex gap-1.5">
          <span className="thinking-dot" />
          <span className="thinking-dot" />
          <span className="thinking-dot" />
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      {/* New Chat button */}
      <div className="px-3 pb-3">
        <button
          onClick={handleCreateThread}
          disabled={creating}
          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-[13px] font-medium transition-all"
          style={{
            color: 'hsl(var(--sidebar-fg-bright))',
            border: '1px dashed hsl(var(--sidebar-border))',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'hsl(var(--sidebar-hover))'
            e.currentTarget.style.borderStyle = 'solid'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent'
            e.currentTarget.style.borderStyle = 'dashed'
          }}
        >
          <Plus className="h-4 w-4" style={{ color: 'hsl(var(--sidebar-fg))' }} />
          {creating ? 'Creating...' : 'New conversation'}
        </button>
      </div>

      {/* Thread list */}
      <div className="sidebar-scroll flex-1 overflow-y-auto px-3">
        {threads.length === 0 ? (
          <div className="px-3 py-6 text-center text-[13px]" style={{ color: 'hsl(var(--sidebar-muted))' }}>
            No conversations yet.
            <br />
            Start a new chat!
          </div>
        ) : (
          <div className="space-y-0.5">
            {threads.map(thread => {
              const isSelected = selectedThreadId === thread.id
              return (
                <div
                  key={thread.id}
                  onClick={() => onSelectThread(thread.id)}
                  className="group flex cursor-pointer items-center justify-between rounded-lg px-3 py-2 transition-all"
                  style={{
                    background: isSelected ? 'hsl(var(--sidebar-active))' : 'transparent',
                  }}
                  onMouseEnter={(e) => {
                    if (!isSelected) e.currentTarget.style.background = 'hsl(var(--sidebar-hover))'
                  }}
                  onMouseLeave={(e) => {
                    if (!isSelected) e.currentTarget.style.background = 'transparent'
                  }}
                >
                  <div className="flex min-w-0 items-center gap-2.5">
                    <MessageSquare
                      className="h-3.5 w-3.5 shrink-0"
                      style={{
                        color: isSelected ? 'hsl(var(--primary))' : 'hsl(var(--sidebar-muted))',
                      }}
                    />
                    <span
                      className="truncate text-[13px]"
                      style={{
                        color: isSelected
                          ? 'hsl(var(--sidebar-fg-bright))'
                          : 'hsl(var(--sidebar-fg))',
                        fontWeight: isSelected ? 500 : 400,
                      }}
                    >
                      {thread.title}
                    </span>
                  </div>
                  <button
                    className="ml-2 shrink-0 rounded-md p-1 opacity-0 transition-all group-hover:opacity-100 hover:!opacity-100"
                    onClick={(e) => handleDeleteThread(e, thread.id)}
                    style={{ color: 'hsl(var(--sidebar-muted))' }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.color = 'hsl(var(--destructive))'
                      e.currentTarget.style.background = 'hsl(var(--destructive) / 0.1)'
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.color = 'hsl(var(--sidebar-muted))'
                      e.currentTarget.style.background = 'transparent'
                    }}
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
})
