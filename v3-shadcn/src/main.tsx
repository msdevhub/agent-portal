import './index.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { Callback } from './components/auth/Callback'
import { ProtectedRoute } from './components/auth/ProtectedRoute'
import { AuthProvider, isLogtoEnabled } from './lib/auth'

function Root() {
  // Handle /callback path for Logto sign-in redirect (only in secure context)
  if (isLogtoEnabled && window.location.pathname === '/callback') {
    return <Callback />
  }

  return (
    <ProtectedRoute>
      <App />
    </ProtectedRoute>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <Root />
    </AuthProvider>
  </StrictMode>,
)
