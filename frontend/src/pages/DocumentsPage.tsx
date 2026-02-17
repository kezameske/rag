import { useAuth } from '@/hooks/useAuth'
import { useRealtimeDocuments } from '@/hooks/useRealtimeDocuments'
import { DocumentUpload } from '@/components/documents/DocumentUpload'
import { DocumentList } from '@/components/documents/DocumentList'
import { UserMenu } from '@/components/UserMenu'
import { useNavigate } from 'react-router-dom'
import { FileText, MessageCircle } from 'lucide-react'

export function DocumentsPage() {
  const { user, signOut, isAdmin } = useAuth()
  const { documents, loading, refetch } = useRealtimeDocuments(user?.id)
  const navigate = useNavigate()

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
              onClick={() => navigate('/')}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] font-medium transition-all hover:opacity-80"
              style={{ color: 'hsl(var(--sidebar-fg))' }}
            >
              <MessageCircle className="h-3.5 w-3.5" />
              Chat
            </button>
            <button
              className="flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] font-medium transition-all"
              style={{
                background: 'hsl(var(--sidebar-active))',
                color: 'hsl(var(--sidebar-fg-bright))',
                boxShadow: '0 1px 2px rgb(0 0 0 / 0.2)',
              }}
            >
              <FileText className="h-3.5 w-3.5" />
              Documents
            </button>
          </div>
        </nav>

        {/* Divider */}
        <div className="mx-4 mb-1" style={{ borderTop: '1px solid hsl(var(--sidebar-border))' }} />

        <div className="flex-1" />

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
      <div className="flex-1 overflow-auto bg-background">
        <div className="max-w-3xl mx-auto px-8 py-10 space-y-8">
          <div>
            <h1 className="font-display text-3xl tracking-tight">
              Documents
            </h1>
            <p className="text-[15px] text-muted-foreground mt-2">
              Upload documents to use as context in your chats.
            </p>
          </div>

          <DocumentUpload onUploadComplete={refetch} />
          <DocumentList documents={documents} loading={loading} />
        </div>
      </div>
    </div>
  )
}
