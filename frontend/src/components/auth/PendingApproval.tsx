import { LogOut, Clock } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface PendingApprovalProps {
  onSignOut: () => void
}

export function PendingApproval({ onSignOut }: PendingApprovalProps) {
  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-md text-center space-y-6">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/30">
          <Clock className="h-8 w-8 text-amber-600 dark:text-amber-400" />
        </div>
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">Account Pending Approval</h1>
          <p className="text-muted-foreground">
            Your account has been created but requires admin approval before you can access the app. Please check back later.
          </p>
        </div>
        <Button variant="outline" onClick={onSignOut} className="gap-2">
          <LogOut className="h-4 w-4" />
          Sign Out
        </Button>
      </div>
    </div>
  )
}
