import './index.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { LogtoProvider, type LogtoConfig } from '@logto/react'
import App from './App'
import { Callback } from './components/auth/Callback'
import { ProtectedRoute } from './components/auth/ProtectedRoute'

const logtoConfig: LogtoConfig = {
  endpoint: 'https://logto.dr.restry.cn',
  appId: 'wqzrwjesyo5medejdnfu6',
}

function Root() {
  // Handle /callback path for Logto sign-in redirect
  if (window.location.pathname === '/callback') {
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
    <LogtoProvider config={logtoConfig}>
      <Root />
    </LogtoProvider>
  </StrictMode>,
)
