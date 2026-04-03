import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import {
  CreateProjectModal,
  ErrorToast,
  getErrorMessage,
  navigateToRoute,
  useHashRoute,
} from "@/components/portal/shared"
import {
  fetchArtifacts,
  fetchDashboard,
  fetchDashboardHistory,
  fetchProject,
  fetchProjects,
  fetchStats,
  fetchTimeline,
  initDB,
} from "@/lib/api"
import type { DashboardData, Project, Stats } from "@/lib/api"
import { DashboardPage } from "@/pages/DashboardPage"
import { AGENT_ID_TO_MM, MM_TO_AGENT_ID, type BotSummary } from "@/pages/DashboardPage"
import { BotDetailPage } from "@/pages/BotDetailPage"
import { ProjectDetailPage } from "@/pages/ProjectDetailPage"
import { APProjectDetailPage } from "@/pages/APProjectDetailPage"

const EMPTY_DASHBOARD: DashboardData = {
  summary: {},
  production_sites: [],
  dev_servers: [],
  containers: [],
  cron_jobs: [],
  agents: [],
  servers: [],
  updated_at: null,
}

function App() {
  const route = useHashRoute()

  // Dashboard state
  const [dashboard, setDashboard] = useState<DashboardData>(EMPTY_DASHBOARD)
  const [dashboardLoading, setDashboardLoading] = useState(true)
  const [dashboardRefreshing, setDashboardRefreshing] = useState(false)
  const [dashboardHistory, setDashboardHistory] = useState<string[]>([])
  const [dashboardBotPoints, setDashboardBotPoints] = useState<string[]>([])
  const [dashboardServerPoints, setDashboardServerPoints] = useState<string[]>([])
  const [dashboardHistorySummaries, setDashboardHistorySummaries] = useState<{ time: string; bots: number | null; srvs: number | null }[]>([])
  const [dashboardAsOf, setDashboardAsOf] = useState<string | null>(null)

  // Projects state
  const [stats, setStats] = useState<Stats>({ total: 0, active: 0, completed: 0, tasks: 0, tasksDone: 0 })
  const [projects, setProjects] = useState<Project[]>([])
  const [overviewLoading, setOverviewLoading] = useState(true)
  const [detailProject, setDetailProject] = useState<Project | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const detailRequestId = useRef(0)

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

  // --- Dashboard loading ---
  const loadDashboard = useCallback(async (mode: "initial" | "refresh" = "initial", at?: string | null) => {
    if (mode === "initial") setDashboardLoading(true)
    else setDashboardRefreshing(true)
    try {
      const [data, history] = await Promise.all([
        fetchDashboard(at ?? undefined),
        fetchDashboardHistory(),
      ])
      setDashboard(data)
      setDashboardHistory(history.points ?? [])
      setDashboardBotPoints(history.botPoints ?? [])
      setDashboardServerPoints(history.serverPoints ?? [])
      setDashboardHistorySummaries(history.summaries ?? [])
    } catch (error) {
      showError(error)
    } finally {
      if (mode === "initial") setDashboardLoading(false)
      else setDashboardRefreshing(false)
    }
  }, [showError])

  // --- Projects loading ---
  const loadOverview = useCallback(async () => {
    setOverviewLoading(true)
    try {
      const [nextStats, summaryList] = await Promise.all([fetchStats(), fetchProjects()])
      const detailedProjects = await Promise.all(summaryList.map((project) => fetchProject(project.slug)))
      const mergedProjects = detailedProjects.map((project) => {
        const summary = summaryList.find((item) => item.id === project.id)
        return { ...summary, ...project }
      })
      setStats(nextStats)
      setProjects(mergedProjects)
    } catch (error) {
      showError(error)
    } finally {
      setOverviewLoading(false)
    }
  }, [showError])

  const loadProjectDetail = useCallback(async (slug: string) => {
    const requestId = ++detailRequestId.current
    setDetailLoading(true)
    setDetailProject(null)
    try {
      const project = await fetchProject(slug)
      const [artifacts, timeline] = await Promise.all([
        fetchArtifacts(project.id),
        fetchTimeline(project.id),
      ])
      if (requestId !== detailRequestId.current) return null
      const mergedProject = { ...project, artifacts, timeline }
      setDetailProject(mergedProject)
      return mergedProject
    } catch (error) {
      if (requestId === detailRequestId.current) setDetailProject(null)
      showError(error)
      return null
    } finally {
      if (requestId === detailRequestId.current) setDetailLoading(false)
    }
  }, [showError])

  const refreshProject = useCallback(async (slug: string) => {
    await Promise.all([loadOverview(), loadProjectDetail(slug)])
  }, [loadOverview, loadProjectDetail])

  // Init DB + load overview
  useEffect(() => {
    void (async () => {
      try {
        await initDB()
        await loadOverview()
      } catch (error) {
        showError(error)
      }
    })()
  }, [loadOverview, showError])

  // Auto-refresh when Pipeline completes (SSE → custom event)
  useEffect(() => {
    const handler = () => {
      void loadOverview()
      void loadDashboard("refresh")
    }
    window.addEventListener('portal:digest-done', handler)
    return () => window.removeEventListener('portal:digest-done', handler)
  }, [loadOverview, loadDashboard])

  // Load dashboard data on mount + auto-refresh
  useEffect(() => {
    void loadDashboard("initial", dashboardAsOf)
  }, [dashboardAsOf, loadDashboard])

  useEffect(() => {
    if (dashboardAsOf) return
    const timer = window.setInterval(() => {
      void loadDashboard("refresh")
    }, 60_000)
    return () => window.clearInterval(timer)
  }, [dashboardAsOf, loadDashboard])

  // Route-based detail loading
  useEffect(() => {
    if (route.page !== "home" && route.page !== "projects") {
      window.scrollTo({ top: 0, behavior: "auto" })
    }
    if (route.page === "project") {
      void loadProjectDetail(route.slug)
      return
    }
    detailRequestId.current += 1
    setDetailLoading(false)
    setDetailProject(null)
  }, [loadProjectDetail, route])

  const recentNotes = useMemo(() => (
    projects
      .flatMap((project) => (project.notes || []).map((note) => ({
        ...note,
        projectName: project.name,
      })))
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, 5)
  ), [projects])

  return (
    <div className="dark min-h-screen bg-[#09090b] text-zinc-100 selection:bg-emerald-500/30">
      <div className="pointer-events-none fixed inset-x-0 top-0 h-[420px] bg-[radial-gradient(circle_at_top,rgba(16,185,129,0.14),transparent_46%),radial-gradient(circle_at_78%_12%,rgba(14,165,233,0.1),transparent_24%)]" />
      <div className="relative">
        {/* Dashboard — keep mounted but hidden when on bot/ap-project detail to preserve state */}
        <div className={route.page === "bot" || route.page === "ap-project" ? "hidden" : undefined}>
          {(route.page === "home" || route.page === "projects" || route.page === "bot" || route.page === "ap-project") && (
            <DashboardPage
              dashboard={dashboard}
              loading={dashboardLoading}
              refreshing={dashboardRefreshing}
              historyPoints={dashboardHistory}
              historyBotPoints={dashboardBotPoints}
              historyServerPoints={dashboardServerPoints}
              historySummaries={dashboardHistorySummaries}
              selectedAsOf={dashboardAsOf}
              onSelectAsOf={setDashboardAsOf}
              stats={stats}
              projects={projects}
              recentNotes={recentNotes}
              projectsLoading={overviewLoading}
              onCreateProject={() => setShowCreate(true)}
              onOpenProject={(slug) => navigateToRoute({ page: "project", slug })}
              onOpenBot={(agentId, date) => navigateToRoute({ page: "bot", agentId, date })}
              onOpenAPProject={(id) => navigateToRoute({ page: "ap-project", id })}
            />
          )}
        </div>
        {route.page === "bot" && (
          <BotDetailPage
            agent={dashboard.agents?.find(a => a.id === route.agentId) ?? dashboard.agents?.find(a => a.id === MM_TO_AGENT_ID[route.agentId]) ?? null}
            agentId={MM_TO_AGENT_ID[route.agentId] ?? route.agentId}
            onBack={() => navigateToRoute({ page: "home" })}
            mmUsername={AGENT_ID_TO_MM[route.agentId] ?? route.agentId}
            initialDate={route.date}
            onOpenProject={(id) => navigateToRoute({ page: "ap-project", id })}
          />
        )}
        {route.page === "project" && (
          <ProjectDetailPage
            project={detailProject}
            loading={detailLoading}
            onBack={() => navigateToRoute({ page: "home" })}
            onRefresh={refreshProject}
            onError={showError}
          />
        )}
        {route.page === "ap-project" && (
          <APProjectDetailPage
            projectId={route.id}
            onBack={() => navigateToRoute({ page: "home" })}
            onOpenBot={(agentId) => navigateToRoute({ page: "bot", agentId })}
          />
        )}
      </div>

      {showCreate && (
        <CreateProjectModal
          onClose={() => setShowCreate(false)}
          onCreated={async () => {
            setShowCreate(false)
            await loadOverview()
          }}
          onError={showError}
        />
      )}

      <ErrorToast message={errorMessage} onClose={() => setErrorMessage(null)} />
    </div>
  )
}

export default App
