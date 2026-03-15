import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import {
  CreateProjectModal,
  ErrorToast,
  getErrorMessage,
  navigateToRoute,
  useHashRoute,
} from "@/components/portal/shared"
import { fetchArtifacts, fetchProject, fetchProjects, fetchStats, fetchTimeline, initDB } from "@/lib/api"
import type { Project, Stats } from "@/lib/api"
import { HomePage } from "@/pages/HomePage"
import { ProjectDetailPage } from "@/pages/ProjectDetailPage"

function App() {
  const route = useHashRoute()
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
      if (requestId === detailRequestId.current) {
        setDetailProject(null)
      }
      showError(error)
      return null
    } finally {
      if (requestId === detailRequestId.current) {
        setDetailLoading(false)
      }
    }
  }, [showError])

  const refreshProject = useCallback(async (slug: string) => {
    await Promise.all([loadOverview(), loadProjectDetail(slug)])
  }, [loadOverview, loadProjectDetail])

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

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "auto" })
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
        {route.page === "home" ? (
          <HomePage
            stats={stats}
            projects={projects}
            recentNotes={recentNotes}
            loading={overviewLoading}
            onCreateProject={() => setShowCreate(true)}
            onOpenProject={(slug) => navigateToRoute({ page: "project", slug })}
          />
        ) : (
          <ProjectDetailPage
            project={detailProject}
            loading={detailLoading}
            onBack={() => navigateToRoute({ page: "home" })}
            onRefresh={refreshProject}
            onError={showError}
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
