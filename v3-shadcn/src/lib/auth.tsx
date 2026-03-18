/**
 * Unified auth context.
 *
 * HTTPS (secure context)  → real Logto PKCE flow via LogtoProvider
 * HTTP  (insecure context) → mock "always-authenticated" so the UI
 *                            renders without Crypto.subtle errors.
 */
import { createContext, useContext, type ReactNode } from 'react'
import { LogtoProvider, useLogto } from '@logto/react'
import type { LogtoConfig, IdTokenClaims } from '@logto/react'

/* ── Public interface ──────────────────────────────────── */

export interface AuthContextValue {
  isAuthenticated: boolean
  isLoading: boolean
  signIn: (redirectUri: string) => Promise<void>
  signOut: (postLogoutRedirectUri?: string) => Promise<void>
  getIdTokenClaims: () => Promise<IdTokenClaims | undefined>
}

const AuthCtx = createContext<AuthContextValue | null>(null)

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthCtx)
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>')
  return ctx
}

/** Whether the real Logto flow is active (HTTPS). */
export const isLogtoEnabled: boolean = window.isSecureContext

/* ── Logto bridge (secure context) ─────────────────────── */

const logtoConfig: LogtoConfig = {
  endpoint: 'https://logto.dr.restry.cn',
  appId: 'wqzrwjesyo5medejdnfu6',
}

function LogtoBridge({ children }: { children: ReactNode }) {
  const logto = useLogto()
  const value: AuthContextValue = {
    isAuthenticated: logto.isAuthenticated,
    isLoading: logto.isLoading,
    signIn: logto.signIn,
    signOut: logto.signOut,
    getIdTokenClaims: logto.getIdTokenClaims,
  }
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>
}

/* ── Dev mock (insecure / HTTP) ────────────────────────── */

const DEV_CLAIMS = {
  sub: 'dev-user',
  name: 'Dev User',
  username: 'dev',
} as IdTokenClaims

const devMock: AuthContextValue = {
  isAuthenticated: true,
  isLoading: false,
  signIn: async () => {},
  signOut: async () => {
    window.location.replace('/')
  },
  getIdTokenClaims: async () => DEV_CLAIMS,
}

/* ── Unified provider ──────────────────────────────────── */

export function AuthProvider({ children }: { children: ReactNode }) {
  if (!isLogtoEnabled) {
    if (import.meta.env.DEV) {
      console.warn(
        '[Auth] Insecure context detected (HTTP) — Logto disabled, using dev mock auth.',
      )
    }
    return <AuthCtx.Provider value={devMock}>{children}</AuthCtx.Provider>
  }

  return (
    <LogtoProvider config={logtoConfig}>
      <LogtoBridge>{children}</LogtoBridge>
    </LogtoProvider>
  )
}
