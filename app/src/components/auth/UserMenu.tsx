import { useLogto } from '@logto/react'
import { useEffect, useState } from 'react'
import type { IdTokenClaims } from '@logto/react'
import { LogOut, User } from 'lucide-react'

export function UserMenu() {
  const { isAuthenticated, getIdTokenClaims, signOut } = useLogto()
  const [claims, setClaims] = useState<IdTokenClaims | null>(null)

  useEffect(() => {
    if (!isAuthenticated) {
      setClaims(null)
      return
    }
    void (async () => {
      const result = await getIdTokenClaims()
      if (result) setClaims(result)
    })()
  }, [isAuthenticated, getIdTokenClaims])

  if (!isAuthenticated || !claims) return null

  const displayName = claims.name || claims.username || claims.sub

  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-2 rounded-lg border border-zinc-800/80 bg-[#111113] px-3 py-1.5">
        <User className="h-3.5 w-3.5 text-zinc-400" />
        <span className="text-xs text-zinc-300">{displayName}</span>
      </div>
      <button
        type="button"
        onClick={() => void signOut(window.location.origin)}
        className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-zinc-800/80 bg-[#111113] px-2.5 text-xs text-zinc-400 transition hover:border-zinc-700 hover:text-zinc-200"
        title="登出"
      >
        <LogOut className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}
