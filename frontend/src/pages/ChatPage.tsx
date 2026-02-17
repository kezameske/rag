import { useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Send, FileText, MessageCircle } from 'lucide-react'
import { ThreadList, ThreadListRef } from '@/components/chat/ThreadList'
import { ChatView } from '@/components/chat/ChatView'
import { UserMenu } from '@/components/UserMenu'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/hooks/useAuth'
import { createThread } from '@/lib/api'

export function ChatPage() {
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null)
  const [initialMessage, setInitialMessage] = useState<string | undefined>(undefined)
  const [welcomeInput, setWelcomeInput] = useState('')
  const [creating, setCreating] = useState(false)
  const { signOut, user, isAdmin } = useAuth()
  const threadListRef = useRef<ThreadListRef>(null)
  const navigate = useNavigate()

  const handleThreadTitleUpdate = (threadId: string, title: string) => {
    threadListRef.current?.updateThreadTitle(threadId, title)
  }

  const handleSelectThread = (threadId: string) => {
    setSelectedThreadId(threadId)
    setInitialMessage(undefined)
  }

  const handleWelcomeSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!welcomeInput.trim() || creating) return

    const message = welcomeInput.trim()
    setCreating(true)
    try {
      const newThread = await createThread()
      threadListRef.current?.addThread(newThread)
      setInitialMessage(message)
      setSelectedThreadId(newThread.id)
      setWelcomeInput('')
    } catch (error) {
      console.error('Failed to create thread:', error)
    } finally {
      setCreating(false)
    }
  }

  const handleSignOut = async () => {
    try {
      await signOut()
    } catch (error) {
      console.error('Failed to sign out:', error)
    }
  }

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar */}
      <div
        className="sidebar-texture flex w-72 flex-col"
        style={{ background: 'hsl(var(--sidebar-bg))' }}
      >
        {/* Sidebar Header */}
        <div className="px-5 pt-5 pb-4">
          <img
            src="/jungholee_logo.png"
            alt="jungholee.com"
            className="h-8 rounded"
          />
        </div>

        {/* Navigation */}
        <nav className="px-3 pb-3">
          <div className="flex gap-1 rounded-lg p-1" style={{ background: 'hsl(var(--sidebar-hover))' }}>
            <button
              className="flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] font-medium transition-all"
              style={{
                background: 'hsl(var(--sidebar-active))',
                color: 'hsl(var(--sidebar-fg-bright))',
                boxShadow: '0 1px 2px rgb(0 0 0 / 0.2)',
              }}
            >
              <MessageCircle className="h-3.5 w-3.5" />
              Chat
            </button>
            <button
              onClick={() => navigate('/documents')}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] font-medium transition-all hover:opacity-80"
              style={{ color: 'hsl(var(--sidebar-fg))' }}
            >
              <FileText className="h-3.5 w-3.5" />
              Documents
            </button>
          </div>
        </nav>

        {/* Divider */}
        <div className="mx-4 mb-1" style={{ borderTop: '1px solid hsl(var(--sidebar-border))' }} />

        {/* Thread List */}
        <ThreadList
          ref={threadListRef}
          selectedThreadId={selectedThreadId}
          onSelectThread={handleSelectThread}
        />

        {/* User Menu */}
        <div
          className="mt-auto px-3 py-3"
          style={{ borderTop: '1px solid hsl(var(--sidebar-border))' }}
        >
          {user?.email && (
            <UserMenu email={user.email} onSignOut={handleSignOut} isAdmin={isAdmin} />
          )}
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 bg-background">
        {selectedThreadId ? (
          <ChatView
            threadId={selectedThreadId}
            onThreadTitleUpdate={handleThreadTitleUpdate}
            initialMessage={initialMessage}
          />
        ) : (
          /* Welcome Screen */
          <div className="flex h-full flex-col items-center justify-center px-4">
            <div className="mb-12 text-center">
              <h1
                className="font-display text-5xl leading-tight tracking-tight"
                style={{ color: 'hsl(var(--foreground))' }}
              >
                What can I help
                <br />
                <span className="italic" style={{ color: 'hsl(var(--primary))' }}>
                  you with?
                </span>
              </h1>
              <p className="mt-4 text-[15px] text-muted-foreground">
                Ask questions about your documents or start a conversation.
              </p>
            </div>

            <form onSubmit={handleWelcomeSubmit} className="w-full max-w-xl">
              <div className="chat-input-container flex items-center gap-2 rounded-2xl px-5 py-3">
                <input
                  value={welcomeInput}
                  onChange={(e) => setWelcomeInput(e.target.value)}
                  placeholder="Ask anything..."
                  disabled={creating}
                  className="flex-1 bg-transparent text-[15px] placeholder:text-muted-foreground/60 focus:outline-none"
                />
                <Button
                  type="submit"
                  size="icon"
                  className="h-9 w-9 shrink-0 rounded-xl transition-all hover:scale-105"
                  disabled={!welcomeInput.trim() || creating}
                  style={{
                    background: welcomeInput.trim() ? 'hsl(var(--primary))' : 'hsl(var(--muted))',
                    color: welcomeInput.trim() ? 'white' : 'hsl(var(--muted-foreground))',
                  }}
                >
                  <Send className="h-4 w-4" />
                </Button>
              </div>
            </form>

            {/* Subtle hint cards */}
            <div className="mt-10 flex gap-3">
              {['Summarize a document', 'Find specific details', 'Compare sections'].map((hint) => (
                <button
                  key={hint}
                  onClick={() => setWelcomeInput(hint)}
                  className="rounded-xl border border-border/60 px-4 py-2.5 text-[13px] text-muted-foreground transition-all hover:border-primary/30 hover:text-foreground hover:shadow-sm"
                >
                  {hint}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
