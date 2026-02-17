import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { LogOut, Settings } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Button } from '@/components/ui/button'

interface UserMenuProps {
  email: string
  onSignOut: () => void
  isAdmin?: boolean
}

function getInitials(email: string): string {
  const name = email.split('@')[0]
  const parts = name.split(/[._-]/)
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase()
  }
  return name.slice(0, 2).toUpperCase()
}

function getDisplayName(email: string): string {
  const name = email.split('@')[0]
  return name
    .split(/[._-]/)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

export function UserMenu({ email, onSignOut, isAdmin = false }: UserMenuProps) {
  const [popoverOpen, setPopoverOpen] = useState(false)
  const navigate = useNavigate()

  const initials = getInitials(email)
  const displayName = getDisplayName(email)

  function handleOpenSettings() {
    setPopoverOpen(false)
    navigate('/settings')
  }

  return (
    <>
      <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
        <PopoverTrigger asChild>
          <button
            className="flex w-full items-center gap-3 rounded-lg p-2 text-left transition-all"
            style={{ color: 'hsl(var(--sidebar-fg))' }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'hsl(var(--sidebar-hover))'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent'
            }}
          >
            <div
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[13px] font-semibold"
              style={{
                background: 'hsl(var(--primary) / 0.15)',
                color: 'hsl(var(--primary))',
              }}
            >
              {initials}
            </div>
            <div className="min-w-0 flex-1">
              <p
                className="truncate text-[13px] font-medium"
                style={{ color: 'hsl(var(--sidebar-fg-bright))' }}
              >
                {displayName}
              </p>
              <p
                className="truncate text-[11px]"
                style={{ color: 'hsl(var(--sidebar-muted))' }}
              >
                {email}
              </p>
            </div>
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-56 p-2" align="start" side="top">
          {isAdmin && (
            <Button
              variant="ghost"
              className="w-full justify-start gap-2"
              onClick={handleOpenSettings}
            >
              <Settings className="h-4 w-4" />
              Settings
            </Button>
          )}
          <Button
            variant="ghost"
            className="w-full justify-start gap-2"
            onClick={onSignOut}
          >
            <LogOut className="h-4 w-4" />
            Log out
          </Button>
        </PopoverContent>
      </Popover>
    </>
  )
}
