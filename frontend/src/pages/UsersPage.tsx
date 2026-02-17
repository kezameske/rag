import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { FileText, MessageCircle, Users, Shield, Trash2, Check, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { UserMenu } from '@/components/UserMenu'
import { useAuth } from '@/hooks/useAuth'
import { listUsers, updateUser, deleteUser, type UserInfo } from '@/lib/api'

export function UsersPage() {
  const { user, signOut, isAdmin, loading: authLoading } = useAuth()
  const navigate = useNavigate()

  const [users, setUsers] = useState<UserInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)

  // Redirect non-admins
  useEffect(() => {
    if (!authLoading && !isAdmin) {
      navigate('/')
    }
  }, [authLoading, isAdmin, navigate])

  useEffect(() => {
    if (isAdmin) {
      loadUsers()
    }
  }, [isAdmin])

  async function loadUsers() {
    setLoading(true)
    setError(null)
    try {
      const data = await listUsers()
      setUsers(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load users')
    } finally {
      setLoading(false)
    }
  }

  async function handleToggleApproval(u: UserInfo) {
    try {
      await updateUser(u.id, { is_approved: !u.is_approved })
      setUsers(prev => prev.map(x => x.id === u.id ? { ...x, is_approved: !x.is_approved } : x))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update user')
    }
  }

  async function handleToggleAdmin(u: UserInfo) {
    try {
      await updateUser(u.id, { is_admin: !u.is_admin })
      setUsers(prev => prev.map(x => x.id === u.id ? { ...x, is_admin: !x.is_admin } : x))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update user')
    }
  }

  async function handleDelete(userId: string) {
    try {
      await deleteUser(userId)
      setUsers(prev => prev.filter(x => x.id !== userId))
      setDeleteConfirm(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete user')
    }
  }

  const handleSignOut = async () => {
    try {
      await signOut()
    } catch (error) {
      console.error('Failed to sign out:', error)
    }
  }

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
        <div className="max-w-3xl mx-auto px-8 py-10">
          <div className="flex items-center gap-3 mb-6">
            <Users className="h-7 w-7 text-primary" />
            <h1 className="font-display text-3xl tracking-tight">User Management</h1>
          </div>

          {error && (
            <div className="rounded-md bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive mb-4">
              {error}
            </div>
          )}

          {loading ? (
            <div className="flex items-center justify-center py-8">
              <div className="text-sm text-muted-foreground">Loading users...</div>
            </div>
          ) : (
            <div className="rounded-lg border">
              <table className="w-full">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Email</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-muted-foreground uppercase tracking-wider">Status</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-muted-foreground uppercase tracking-wider">Role</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => {
                    const isSelf = u.id === user?.id
                    return (
                      <tr key={u.id} className="border-b last:border-0">
                        <td className="px-4 py-3">
                          <div className="text-sm font-medium">{u.email}</div>
                          <div className="text-xs text-muted-foreground">
                            Joined {new Date(u.created_at).toLocaleDateString()}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-center">
                          {u.is_approved ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-green-100 dark:bg-green-900/30 px-2.5 py-0.5 text-xs font-medium text-green-700 dark:text-green-400">
                              <Check className="h-3 w-3" />
                              Approved
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 dark:bg-amber-900/30 px-2.5 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-400">
                              <X className="h-3 w-3" />
                              Pending
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-center">
                          {u.is_admin && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
                              <Shield className="h-3 w-3" />
                              Admin
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {deleteConfirm === u.id ? (
                            <div className="flex items-center justify-end gap-1">
                              <span className="text-xs text-muted-foreground mr-1">Delete?</span>
                              <Button
                                variant="destructive"
                                size="sm"
                                onClick={() => handleDelete(u.id)}
                                className="text-xs"
                              >
                                Yes
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setDeleteConfirm(null)}
                                className="text-xs"
                              >
                                No
                              </Button>
                            </div>
                          ) : (
                            <div className="flex items-center justify-end gap-1">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleToggleApproval(u)}
                                disabled={isSelf}
                                className="text-xs"
                              >
                                {u.is_approved ? 'Revoke' : 'Approve'}
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleToggleAdmin(u)}
                                disabled={isSelf}
                                className="text-xs"
                              >
                                {u.is_admin ? 'Remove Admin' : 'Make Admin'}
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setDeleteConfirm(u.id)}
                                disabled={isSelf}
                                className="text-xs text-destructive hover:text-destructive"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                  {users.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-4 py-8 text-center text-sm text-muted-foreground">
                        No users found.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
