import { useCallback, useEffect, useState } from "react"

import { getErrorMessage, navigateToRoute, useHashRoute } from "@/components/portal/shared"
import { fetchDashboard } from "@/lib/api"
import type { DashboardData } from "@/lib/api"
import { HomePage } from "@/pages/HomePage"

const EMPTY_DASHBOARD: DashboardData = {
  summary: {},
  production_sites: [],
  dev_servers: [],
  containers: [],
  cron_jobs: [],
  agents: [],
  updated_at: null,
}

function App() {
  const route = useHashRoute()
  const [dashboard, setDashboard] = useState<DashboardData>(EMPTY_DASHBOARD)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const showError = useCallback((error: unknown) => {
    setErrorMessage(getErrorMessage(error))
  }, [])

  useEffect(() => {
    document.documentElement.classList.add("dark")
  }, [])

  useEffect(() => {
    if (!errorMessage) return
    const timer = window.setTimeout(() => setErrorMessage(null), 4500)
    return () => window.clearTimeout(timer)
  }, [errorMessage])

  const loadDashboard = useCallback(async (mode: "initial" | "refresh" = "initial") => {
    if (mode === "initial") {
      setLoading(true)
    } else {
      setRefreshing(true)
    }

    try {
      const data = await fetchDashboard()
      setDashboard(data)
    } catch (error) {
      showError(error)
    } finally {
      if (mode === "initial") {
        setLoading(false)
      } else {
        setRefreshing(false)
      }
    }
  }, [showError])

  useEffect(() => {
    void loadDashboard("initial")
  }, [loadDashboard])

  useEffect(() => {
    const timer = window.setInterval(() => {
      void loadDashboard("refresh")
    }, 60_000)

    return () => window.clearInterval(timer)
  }, [loadDashboard])

  return (
    <div className="dark min-h-screen bg-[#09090b] text-zinc-100 selection:bg-emerald-500/30">
      <div className="pointer-events-none fixed inset-x-0 top-0 h-[420px] bg-[radial-gradient(circle_at_top,rgba(16,185,129,0.14),transparent_46%),radial-gradient(circle_at_78%_12%,rgba(14,165,233,0.1),transparent_24%)]" />
      <div className="relative">
        <HomePage
          dashboard={dashboard}
          loading={loading}
          refreshing={refreshing}
          onBackToProjects={() => {
            if (route.page === "project") {
              navigateToRoute({ page: "home" })
              return
            }
            window.location.hash = '#/projects'
          }}
        />
      </div>

      {errorMessage && (
        <div className="fixed right-4 bottom-4 z-50 rounded-xl border border-rose-500/30 bg-[#18181b] px-4 py-3 text-sm text-rose-200 shadow-lg">
          {errorMessage}
        </div>
      )}
    </div>
  )
}

export default App
