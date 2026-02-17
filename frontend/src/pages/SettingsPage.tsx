import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Lock, Eye, EyeOff, FileText, MessageCircle, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { UserMenu } from '@/components/UserMenu'
import { useAuth } from '@/hooks/useAuth'
import { getSettings, updateSettings, type GlobalSettings, type GlobalSettingsUpdate } from '@/lib/api'

export function SettingsPage() {
  const { user, signOut, isAdmin, loading: authLoading } = useAuth()
  const navigate = useNavigate()

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hasChunks, setHasChunks] = useState(false)

  // Form state
  const [llmModel, setLlmModel] = useState('')
  const [llmBaseUrl, setLlmBaseUrl] = useState('')
  const [llmApiKey, setLlmApiKey] = useState('')
  const [embeddingModel, setEmbeddingModel] = useState('')
  const [embeddingBaseUrl, setEmbeddingBaseUrl] = useState('')
  const [embeddingApiKey, setEmbeddingApiKey] = useState('')
  const [embeddingDimensions, setEmbeddingDimensions] = useState('')
  const [systemPrompt, setSystemPrompt] = useState('')
  const [showLlmKey, setShowLlmKey] = useState(false)
  const [showEmbeddingKey, setShowEmbeddingKey] = useState(false)

  // Redirect non-admins to home (wait for loading to complete first)
  useEffect(() => {
    if (!authLoading && !isAdmin) {
      navigate('/')
    }
  }, [authLoading, isAdmin, navigate])

  useEffect(() => {
    if (isAdmin) {
      loadSettings()
    }
  }, [isAdmin])

  async function loadSettings() {
    setLoading(true)
    setError(null)
    try {
      const settings: GlobalSettings = await getSettings()
      setLlmModel(settings.llm_model || '')
      setLlmBaseUrl(settings.llm_base_url || '')
      setLlmApiKey(settings.llm_api_key || '')
      setEmbeddingModel(settings.embedding_model || '')
      setEmbeddingBaseUrl(settings.embedding_base_url || '')
      setEmbeddingApiKey(settings.embedding_api_key || '')
      setEmbeddingDimensions(settings.embedding_dimensions?.toString() || '')
      setSystemPrompt(settings.system_prompt || '')
      setHasChunks(settings.has_chunks)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load settings')
    } finally {
      setLoading(false)
    }
  }

  async function handleSave() {
    setSaving(true)
    setError(null)
    setSuccess(false)
    try {
      const update: GlobalSettingsUpdate = {
        llm_model: llmModel || null,
        llm_base_url: llmBaseUrl || null,
        llm_api_key: llmApiKey || null,
        embedding_model: embeddingModel || null,
        embedding_base_url: embeddingBaseUrl || null,
        embedding_api_key: embeddingApiKey || null,
        embedding_dimensions: embeddingDimensions ? parseInt(embeddingDimensions, 10) : null,
        system_prompt: systemPrompt || null,
      }
      await updateSettings(update)
      setSuccess(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save settings')
    } finally {
      setSaving(false)
    }
  }

  const handleSignOut = async () => {
    try {
      await signOut()
    } catch (error) {
      console.error('Failed to sign out:', error)
    }
  }

  // Show loading while auth is being checked
  if (authLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    )
  }

  if (!isAdmin) {
    return null
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
        <div className="max-w-lg mx-auto px-8 py-10">
          <h1 className="font-display text-3xl tracking-tight mb-6">Settings</h1>

          {loading ? (
            <div className="flex items-center justify-center py-8">
              <div className="text-sm text-muted-foreground">Loading settings...</div>
            </div>
          ) : (
            <form autoComplete="off" onSubmit={(e) => e.preventDefault()} className="space-y-6">
              {success && (
                <div className="rounded-md bg-green-500/10 border border-green-500/20 p-3 text-sm text-green-700 dark:text-green-400">
                  Settings saved successfully.
                </div>
              )}
              {error && (
                <div className="rounded-md bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive">
                  {error}
                </div>
              )}

              {/* System Prompt */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-medium text-foreground">System Prompt</h3>
                  {systemPrompt && (
                    <button
                      type="button"
                      onClick={() => setSystemPrompt('')}
                      className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <RotateCcw className="h-3 w-3" />
                      Reset to default
                    </button>
                  )}
                </div>
                <textarea
                  className="flex min-h-[120px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 resize-y"
                  placeholder="Leave empty to use the default system prompt. The default instructs the assistant to use document search tools, cite sources, and answer based on retrieved content."
                  value={systemPrompt}
                  onChange={(e) => setSystemPrompt(e.target.value)}
                  rows={6}
                />
              </div>

              {/* Divider */}
              <div className="border-t" />

              {/* LLM Configuration */}
              <div className="space-y-4">
                <h3 className="text-sm font-medium text-foreground">LLM Configuration</h3>
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <label className="text-xs text-muted-foreground">Model Name</label>
                    <Input
                      name="llm-model-field"
                      autoComplete="off"
                      placeholder="e.g., gpt-4o, anthropic/claude-3.5-sonnet"
                      value={llmModel}
                      onChange={(e) => setLlmModel(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs text-muted-foreground">Base URL</label>
                    <Input
                      name="llm-endpoint-field"
                      autoComplete="off"
                      placeholder="e.g., https://openrouter.ai/api/v1"
                      value={llmBaseUrl}
                      onChange={(e) => setLlmBaseUrl(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs text-muted-foreground">API Key</label>
                    <div className="relative">
                      <Input
                        name="llm-key-field"
                        type={showLlmKey ? 'text' : 'password'}
                        autoComplete="off"
                        placeholder="Enter API key"
                        value={llmApiKey}
                        onChange={(e) => setLlmApiKey(e.target.value)}
                        className="pr-10"
                      />
                      <button
                        type="button"
                        onClick={() => setShowLlmKey(!showLlmKey)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        tabIndex={-1}
                      >
                        {showLlmKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Divider */}
              <div className="border-t" />

              {/* Embedding Configuration */}
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-medium text-foreground">Embedding Configuration</h3>
                  {hasChunks && (
                    <div className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
                      <Lock className="h-3 w-3" />
                      <span>Locked (chunks exist)</span>
                    </div>
                  )}
                </div>
                {hasChunks && (
                  <p className="text-xs text-muted-foreground">
                    Embedding settings cannot be changed while document chunks exist in the system. Delete all documents first to change these settings.
                  </p>
                )}
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <label className="text-xs text-muted-foreground">Model Name</label>
                    <Input
                      name="emb-model-field"
                      autoComplete="off"
                      placeholder="e.g., text-embedding-3-small"
                      value={embeddingModel}
                      onChange={(e) => setEmbeddingModel(e.target.value)}
                      disabled={hasChunks}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs text-muted-foreground">Base URL</label>
                    <Input
                      name="emb-endpoint-field"
                      autoComplete="off"
                      placeholder="e.g., https://api.openai.com/v1"
                      value={embeddingBaseUrl}
                      onChange={(e) => setEmbeddingBaseUrl(e.target.value)}
                      disabled={hasChunks}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs text-muted-foreground">API Key</label>
                    <div className="relative">
                      <Input
                        name="emb-key-field"
                        type={showEmbeddingKey ? 'text' : 'password'}
                        autoComplete="off"
                        placeholder="Enter API key"
                        value={embeddingApiKey}
                        onChange={(e) => setEmbeddingApiKey(e.target.value)}
                        disabled={hasChunks}
                        className="pr-10"
                      />
                      <button
                        type="button"
                        onClick={() => setShowEmbeddingKey(!showEmbeddingKey)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground disabled:opacity-50"
                        tabIndex={-1}
                        disabled={hasChunks}
                      >
                        {showEmbeddingKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs text-muted-foreground">Dimensions</label>
                    <Input
                      name="emb-dims-field"
                      type="number"
                      autoComplete="off"
                      placeholder="e.g., 1536"
                      value={embeddingDimensions}
                      onChange={(e) => setEmbeddingDimensions(e.target.value)}
                      disabled={hasChunks}
                    />
                  </div>
                </div>
              </div>

              {/* Footer */}
              <div className="flex justify-end gap-3 pt-2">
                <Button type="button" variant="ghost" onClick={() => navigate(-1)} disabled={saving}>
                  Cancel
                </Button>
                <Button type="button" onClick={handleSave} disabled={saving}>
                  {saving ? 'Saving...' : 'Save'}
                </Button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
