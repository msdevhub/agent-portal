import { useHandleSignInCallback } from '@logto/react'

export function Callback() {
  const { isLoading } = useHandleSignInCallback(() => {
    // After sign-in, redirect to the app root (hash router home)
    window.location.replace('/')
  })

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#09090b] text-zinc-400">
        <p>登录中...</p>
      </div>
    )
  }

  return null
}
