import { useLogto } from '@logto/react'
import type { ReactNode } from 'react'

const REDIRECT_URI = (() => {
  const { origin } = window.location
  return `${origin}/callback`
})()

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading, signIn } = useLogto()

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#09090b] text-zinc-400">
        <p>加载中...</p>
      </div>
    )
  }

  if (!isAuthenticated) {
    // Auto-redirect to sign in
    void signIn(REDIRECT_URI)
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#09090b] text-zinc-400">
        <p>正在跳转到登录页面...</p>
      </div>
    )
  }

  return <>{children}</>
}
