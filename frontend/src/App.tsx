import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './hooks/useAuth'
import { AuthForm } from './components/auth/AuthForm'
import { PendingApproval } from './components/auth/PendingApproval'
import { ChatPage } from './pages/ChatPage'
import { DocumentsPage } from './pages/DocumentsPage'
import { SettingsPage } from './pages/SettingsPage'
import { UsersPage } from './pages/UsersPage'

function App() {
  const { user, loading, isApproved, signOut } = useAuth()

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    )
  }

  // Authenticated but not approved
  if (user && !isApproved) {
    return <PendingApproval onSignOut={signOut} />
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="/"
          element={user ? <ChatPage /> : <Navigate to="/auth" replace />}
        />
        <Route
          path="/documents"
          element={user ? <DocumentsPage /> : <Navigate to="/auth" replace />}
        />
        <Route
          path="/settings"
          element={user ? <SettingsPage /> : <Navigate to="/auth" replace />}
        />
        <Route
          path="/users"
          element={user ? <UsersPage /> : <Navigate to="/auth" replace />}
        />
        <Route
          path="/auth"
          element={user ? <Navigate to="/" replace /> : <AuthForm />}
        />
      </Routes>
    </BrowserRouter>
  )
}

export default App
