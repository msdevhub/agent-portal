import { useMemo, useState } from "react"
import { Activity, Bot, ExternalLink, FlaskConical, Monitor, Plus, RefreshCw, Server, Timer } from "lucide-react"

import { UserMenu } from "@/components/auth/UserMenu"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import {
  CompactStatsBar,
  MobileDisclosure,
  SectionHeading,
  StatCard,
  StatusBadge,
  formatDateTime as sharedFormatDateTime,
  getProjectProgress,
  truncateInlineText,
} from "@/components/portal/shared"
import type {
  DashboardAgent,
  DashboardData,
  Project,
  ServerAlert,
  ServerService,
  ServerSnapshot,
  Stats,
} from "@/lib/api"
import { STAGES } from "@/lib/constants"
import { cn } from "@/lib/utils"

interface RecentNotePreview {
  id: string
  content: string
  created_at: string
  projectName: string
}

interface DashboardPageProps {
  dashboard: DashboardData
  loading: boolean
  refreshing: boolean
  // Projects tab data
  stats: Stats
  projects: Project[]
  recentNotes: RecentNotePreview[]
  projectsLoading: boolean
  onCreateProject: () => void
  onOpenProject: (slug: string) => void
}

type TabId = "bots" | "servers" | "projects"

export function DashboardPage({
  dashboard, loading, refreshing,
  stats, projects, recentNotes, projectsLoading,
  onCreateProject, onOpenProject,
}: DashboardPageProps) {
  const [activeTab, setActiveTab] = useState<TabId>("bots")
  const summary = dashboard.summary ?? {}
  const lastUpdated = dashboard.updated_at ?? summary.timestamp ?? null
  const servers = dashboard.servers ?? []
  const agents = dashboard.agents ?? []
  const cronJobs = dashboard.cron_jobs ?? []
  const productionSites = dashboard.production_sites ?? []
  const containers = dashboard.containers ?? []

  const serverOnlineCount = servers.filter((s) => s.ssh_reachable).length

  return (
    <main className="flex min-h-screen w-full flex-col gap-5 px-4 py-5 sm:gap-8 sm:px-6 sm:py-8 lg:px-8 lg:py-10">
      {/* Header */}
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-50 sm:text-4xl">Agent Portal</h1>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-zinc-500 sm:text-sm">
            <span>最近更新：{formatDateTime(lastUpdated)}</span>
            {refreshing && (
              <span className="inline-flex items-center gap-1 text-emerald-300">
                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                刷新中
              </span>
            )}
          </div>
        </div>
        <UserMenu />
      </header>

      {/* Tab Bar */}
      <div className="flex flex-wrap gap-2">
        <TabButton active={activeTab === "bots"} onClick={() => setActiveTab("bots")} icon={Bot} label="🤖 Bot Fleet" count={agents.length} />
        <TabButton active={activeTab === "servers"} onClick={() => setActiveTab("servers")} icon={Monitor} label="🖥️ Server Fleet" count={`${serverOnlineCount}/${servers.length}`} />
        <TabButton active={activeTab === "projects"} onClick={() => setActiveTab("projects")} icon={FlaskConical} label="📋 项目列表" count={projects.length} />
      </div>

      {/* Tab Content */}
      {activeTab === "bots" && <BotFleetTab dashboard={dashboard} loading={loading} />}
      {activeTab === "servers" && <ServerFleetTab servers={servers} loading={loading} />}
      {activeTab === "projects" && (
        <ProjectsTab
          stats={stats}
          projects={projects}
          recentNotes={recentNotes}
          loading={projectsLoading}
          onCreateProject={onCreateProject}
          onOpenProject={onOpenProject}
        />
      )}
    </main>
  )
}

/* ═══════════════════ Tab Button ═══════════════════ */

function TabButton({ active, onClick, icon: Icon, label, count }: {
  active: boolean
  onClick: () => void
  icon: React.ElementType
  label: string
  count: number | string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-2.5 rounded-xl border px-5 py-3 text-sm font-medium transition ${
        active
          ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
          : "border-zinc-800 bg-[#111113] text-zinc-400 hover:border-zinc-700 hover:text-zinc-200"
      }`}
    >
      <Icon className="h-4 w-4" />
      {label}
      <span className={`rounded-full px-2 py-0.5 text-xs ${active ? "bg-emerald-500/20 text-emerald-200" : "bg-zinc-800 text-zinc-500"}`}>
        {count}
      </span>
    </button>
  )
}

/* ═══════════════════ Bot Fleet Tab ═══════════════════ */

function BotFleetTab({ dashboard, loading }: { dashboard: DashboardData; loading: boolean }) {
  const summary = dashboard.summary ?? {}
  const agents = dashboard.agents ?? []

  const overviewCards = useMemo(() => [
    {
      title: "Agent 总数",
      icon: Bot,
      value: `${agents.length}`,
      accent: "text-violet-300",
    },
    {
      title: "生产站点",
      icon: Activity,
      value: `${summary.production?.up ?? 0}/${summary.production?.total ?? 0}`,
      accent: "text-emerald-300",
    },
    {
      title: "容器",
      icon: Server,
      value: `${summary.containers?.up ?? 0}/${summary.containers?.total ?? 0}`,
      accent: "text-cyan-300",
    },
    {
      title: "Cron Jobs",
      icon: Timer,
      value: `${summary.crons?.ok ?? 0} ok / ${summary.crons?.error ?? 0} err`,
      accent: "text-amber-300",
    },
  ], [agents.length, summary])

  return (
    <div className="space-y-6">
      {/* Mini overview */}
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {overviewCards.map((card) => {
          const Icon = card.icon
          return (
            <Card key={card.title} className="border-zinc-800/80 bg-[#18181b] shadow-none">
              <CardContent className="flex items-center justify-between gap-3 px-5 py-4">
                <div>
                  <p className="text-xs text-zinc-500">{card.title}</p>
                  <p className={`mt-1 text-xl font-semibold ${card.accent}`}>{card.value}</p>
                </div>
                <div className="rounded-2xl border border-zinc-800 bg-[#111113] p-2.5 text-zinc-400">
                  <Icon className="h-4 w-4" />
                </div>
              </CardContent>
            </Card>
          )
        })}
      </section>

      {/* Bot cards grid */}
      <section>
        {loading && agents.length === 0 ? (
          <EmptyRow text="加载中..." />
        ) : agents.length === 0 ? (
          <EmptyRow text="暂无 Agent 数据" />
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {agents.map((agent) => (
              <BotCard key={agent.id} agent={agent} />
            ))}
          </div>
        )}
      </section>

      {/* Cron Jobs table */}
      <Card className="border-zinc-800/80 bg-[#18181b] shadow-none">
        <CardHeader>
          <CardTitle className="text-zinc-50">Cron Jobs</CardTitle>
        </CardHeader>
        <CardContent>
          {(dashboard.cron_jobs ?? []).length === 0 ? (
            <EmptyRow text="暂无 Cron Jobs 数据" />
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-800 text-left text-xs text-zinc-500">
                    <th className="px-3 py-3 font-medium">名称</th>
                    <th className="px-3 py-3 font-medium">Agent</th>
                    <th className="px-3 py-3 font-medium">周期</th>
                    <th className="px-3 py-3 font-medium">状态</th>
                    <th className="px-3 py-3 font-medium">上次时间</th>
                    <th className="px-3 py-3 font-medium text-right">连续错误</th>
                  </tr>
                </thead>
                <tbody>
                  {(dashboard.cron_jobs ?? []).map((job) => (
                    <tr key={job.id} className="border-b border-zinc-900/80 text-zinc-300 last:border-0">
                      <td className="px-3 py-3 font-medium text-zinc-100">{job.name}</td>
                      <td className="px-3 py-3">{job.agent || "—"}</td>
                      <td className="px-3 py-3">{job.schedule || "—"}</td>
                      <td className="px-3 py-3"><StatusPill ok={job.lastStatus === "ok"}>{job.lastStatus || "—"}</StatusPill></td>
                      <td className="px-3 py-3 whitespace-nowrap">{formatDateTime(job.lastRun)}</td>
                      <td className="px-3 py-3 text-right">{job.consecutiveErrors ?? 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

/* ═══════════════════ Bot Card ═══════════════════ */

function BotCard({ agent }: { agent: DashboardAgent }) {
  const prod = agent.production
  const dev = agent.dev
  const container = agent.container
  const crons = agent.crons
  const tasks = agent.tasks

  return (
    <Card className="border-zinc-800/80 bg-[#111113] shadow-none">
      <CardContent className="space-y-3.5 p-5">
        {/* Header: emoji + name + role */}
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-zinc-800 bg-[#18181b] text-xl">
            {agent.emoji || "🤖"}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate text-base font-semibold text-zinc-50">{agent.name}</span>
              <Badge variant="outline" className="border-zinc-700 text-xs text-zinc-400">
                {agent.role === "coordination" ? "协调中心" : agent.project || "—"}
              </Badge>
            </div>
            <div className="mt-0.5 text-xs text-zinc-500">@{agent.id}</div>
          </div>
          {agent.github && (
            <a href={agent.github} target="_blank" rel="noreferrer" className="text-zinc-500 transition hover:text-zinc-300" title="GitHub">
              <ExternalLink className="h-4 w-4" />
            </a>
          )}
        </div>

        {/* Deployment status */}
        <div className="space-y-2 rounded-xl border border-zinc-800/60 bg-[#18181b]/50 px-3.5 py-3">
          <div className="text-xs font-medium text-zinc-500">部署状态</div>
          <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-sm">
            {prod ? (
              <span className="flex items-center gap-1.5">
                <DotIndicator ok={prod.status === 200} />
                <a href={prod.url} target="_blank" rel="noreferrer" className="text-zinc-300 hover:text-zinc-100">生产</a>
                <span className="text-xs text-zinc-500">{prod.status}</span>
              </span>
            ) : (
              <span className="flex items-center gap-1.5 text-zinc-600">
                <DotIndicator ok={false} dim />
                <span>无生产</span>
              </span>
            )}
            {dev ? (
              <span className="flex items-center gap-1.5">
                <DotIndicator ok={dev.status === 200} />
                <a href={dev.url} target="_blank" rel="noreferrer" className="text-zinc-300 hover:text-zinc-100">开发</a>
                <span className="text-xs text-zinc-500">{dev.status}</span>
              </span>
            ) : (
              <span className="flex items-center gap-1.5 text-zinc-600">
                <DotIndicator ok={false} dim />
                <span>无 Dev</span>
              </span>
            )}
            {container ? (
              <span className="flex items-center gap-1.5">
                <DotIndicator ok={container.running} />
                <span className="text-zinc-300">容器</span>
                <span className="text-xs text-zinc-500">{container.running ? "running" : "stopped"}</span>
              </span>
            ) : null}
          </div>
        </div>

        {/* Cron + Tasks row */}
        <div className="flex gap-3">
          {/* Cron mini */}
          {crons && crons.total > 0 && (
            <div className="flex-1 rounded-xl border border-zinc-800/60 bg-[#18181b]/50 px-3.5 py-2.5">
              <div className="text-xs font-medium text-zinc-500">Cron</div>
              <div className="mt-1 flex items-center gap-2 text-sm">
                <span className="text-emerald-300">{crons.ok} ok</span>
                {crons.error > 0 && <span className="text-rose-300">{crons.error} err</span>}
                <span className="text-zinc-600">/ {crons.total}</span>
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {crons.jobs.map((job) => (
                  <span
                    key={job.name}
                    className={`rounded-full px-2 py-0.5 text-xs ${
                      job.lastStatus === "ok"
                        ? "border border-emerald-500/20 bg-emerald-500/10 text-emerald-300"
                        : "border border-rose-500/20 bg-rose-500/10 text-rose-300"
                    }`}
                    title={`${job.name} · ${job.schedule}`}
                  >
                    {job.name.replace(/-(project-sync|healthcheck)/, "").replace(agent.id.split("-").pop() || "", "").replace(/^-/, "") || job.name}
                  </span>
                ))}
              </div>
            </div>
          )}
          {/* Tasks mini */}
          {tasks && (
            <div className="shrink-0 rounded-xl border border-zinc-800/60 bg-[#18181b]/50 px-3.5 py-2.5">
              <div className="text-xs font-medium text-zinc-500">任务</div>
              <div className="mt-1 text-sm">
                {tasks.pending > 0 ? (
                  <span className="text-amber-300">{tasks.pending} 待办</span>
                ) : (
                  <span className="text-emerald-300">✓ 全部完成</span>
                )}
              </div>
              <div className="mt-0.5 text-xs text-zinc-600">{tasks.done}/{tasks.total} done</div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

/* ═══════════════════ Server Fleet Tab ═══════════════════ */

function ServerFleetTab({ servers, loading }: { servers: ServerSnapshot[]; loading: boolean }) {
  const onlineCount = servers.filter((s) => s.ssh_reachable).length
  const totalAlerts = servers.reduce((sum, s) => sum + (s.alerts?.length ?? 0), 0)

  const overviewCards = useMemo(() => [
    { title: "服务器总数", value: `${servers.length}`, accent: "text-blue-300", icon: Monitor },
    { title: "SSH 可达", value: `${onlineCount}/${servers.length}`, accent: "text-emerald-300", icon: Server },
    { title: "告警", value: `${totalAlerts}`, accent: totalAlerts > 0 ? "text-rose-300" : "text-zinc-400", icon: Activity },
  ], [servers.length, onlineCount, totalAlerts])

  return (
    <div className="space-y-6">
      {/* Mini overview */}
      <section className="grid grid-cols-3 gap-3">
        {overviewCards.map((card) => {
          const Icon = card.icon
          return (
            <Card key={card.title} className="border-zinc-800/80 bg-[#18181b] shadow-none">
              <CardContent className="flex items-center justify-between gap-3 px-5 py-4">
                <div>
                  <p className="text-xs text-zinc-500">{card.title}</p>
                  <p className={`mt-1 text-xl font-semibold ${card.accent}`}>{card.value}</p>
                </div>
                <div className="rounded-2xl border border-zinc-800 bg-[#111113] p-2.5 text-zinc-400">
                  <Icon className="h-4 w-4" />
                </div>
              </CardContent>
            </Card>
          )
        })}
      </section>

      {/* Server cards */}
      {loading && servers.length === 0 ? (
        <EmptyRow text="加载中..." />
      ) : servers.length === 0 ? (
        <EmptyRow text="暂无服务器数据" />
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
          {servers.map((server) => (
            <ServerFleetCard key={server.id} server={server} />
          ))}
        </div>
      )}
    </div>
  )
}

/* ═══════════════════ Projects Tab ═══════════════════ */

function ProjectsTab({ stats, projects, recentNotes, loading, onCreateProject, onOpenProject }: {
  stats: Stats
  projects: Project[]
  recentNotes: RecentNotePreview[]
  loading: boolean
  onCreateProject: () => void
  onOpenProject: (slug: string) => void
}) {
  const stageSummary = STAGES
    .map((stage) => `${stage.icon}${projects.filter((p) => p.stage === stage.id).length}`)
    .join(" ")
  const pendingTasks = Math.max(stats.tasks - stats.tasksDone, 0)
  const latestNotePreview = recentNotes[0] ? truncateInlineText(recentNotes[0].content, 20) : "暂无笔记"

  return (
    <div className="mx-auto w-full max-w-7xl space-y-4 sm:space-y-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="hidden grid-cols-4 gap-3 sm:grid">
          <StatCard label="项目" value={stats.total} tone="zinc" />
          <StatCard label="进行中" value={stats.active} tone="emerald" />
          <StatCard label="已完成" value={stats.completed} tone="cyan" />
          <StatCard label="任务完成" value={`${stats.tasksDone}/${stats.tasks}`} tone="amber" />
        </div>
        <div className="sm:hidden">
          <CompactStatsBar stats={stats} />
        </div>
        <button
          type="button"
          onClick={onCreateProject}
          className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-xl border border-zinc-700 bg-[#111113] px-4 text-xs font-medium text-zinc-100 transition hover:border-emerald-400/40 hover:bg-[#17171b] hover:text-emerald-200 sm:h-11 sm:w-auto sm:text-sm"
        >
          <Plus className="h-4 w-4" />
          新建研究项目
        </button>
      </div>

      <div className="grid gap-4 sm:gap-8 xl:grid-cols-[minmax(0,1.45fr)_340px]">
        <section className="space-y-3 sm:space-y-5">
          {loading && projects.length === 0 ? (
            <Card className="border-zinc-800/80 bg-[#18181b] shadow-none">
              <CardContent className="px-5 py-12 text-center text-sm text-zinc-500">
                正在加载项目列表...
              </CardContent>
            </Card>
          ) : projects.length === 0 ? (
            <Card className="border-zinc-800/80 bg-[#18181b] shadow-none">
              <CardContent className="flex flex-col items-center px-5 py-16 text-center">
                <FlaskConical className="mb-4 h-10 w-10 text-zinc-700" />
                <p className="text-base text-zinc-200">还没有研究项目</p>
                <button
                  type="button"
                  onClick={onCreateProject}
                  className="mt-5 inline-flex h-10 items-center rounded-xl border border-zinc-700 bg-[#111113] px-4 text-sm font-medium text-zinc-100 transition hover:border-emerald-400/40 hover:bg-[#17171b] hover:text-emerald-200"
                >
                  创建第一个项目
                </button>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2 sm:space-y-4">
              {projects.map((project) => (
                <ProjectCard key={project.id} project={project} onClick={() => onOpenProject(project.slug)} />
              ))}
            </div>
          )}

          <div className="space-y-3 sm:hidden">
            <MobileDisclosure title="阶段概览" summary={stageSummary}>
              <StageOverviewList projects={projects} />
            </MobileDisclosure>
            <MobileDisclosure title="任务执行" summary={`${pendingTasks} 个待办`}>
              <TaskExecutionCard stats={stats} />
            </MobileDisclosure>
            <MobileDisclosure title="最近笔记" summary={latestNotePreview}>
              <RecentNotesCard notes={recentNotes} />
            </MobileDisclosure>
          </div>
        </section>

        <aside className="hidden space-y-6 sm:block">
          <StageOverviewList projects={projects} />
          <TaskExecutionCard stats={stats} />
          <RecentNotesCard notes={recentNotes} />
        </aside>
      </div>
    </div>
  )
}

function ProjectCard({ project, onClick }: { project: Project; onClick: () => void }) {
  const stageIndex = STAGES.findIndex((stage) => stage.id === project.stage)
  const stage = STAGES[stageIndex] || STAGES[0]
  const progress = getProjectProgress(project)

  return (
    <button type="button" onClick={onClick} className="block w-full text-left">
      <Card className="border-zinc-800/80 bg-[#18181b] shadow-none transition hover:border-zinc-700 hover:bg-[#1d1d21]">
        <CardContent className="px-4 py-3 sm:px-5 sm:py-4">
          <div className="flex min-h-[56px] flex-col justify-between gap-2 sm:min-h-[64px]">
            <div className="flex items-start justify-between gap-3">
              <h3 className="min-w-0 flex-1 truncate text-base font-semibold text-zinc-50 sm:text-lg">{project.name}</h3>
              <StatusBadge status={project.status} />
            </div>
            <div className="flex items-center gap-2 text-xs sm:gap-3 sm:text-sm">
              <span className="min-w-0 truncate font-medium text-zinc-300">{stage.icon} {stage.label}</span>
              <span className="text-zinc-600">·</span>
              <span className="shrink-0 font-semibold text-zinc-100">{progress}%</span>
              <Progress
                value={progress}
                className={cn(
                  "ml-auto h-1 w-16 bg-zinc-900 [&>div]:transition-all sm:h-2 sm:w-24",
                  project.status === "completed" ? "[&>div]:bg-cyan-500" :
                  project.status === "paused" ? "[&>div]:bg-amber-500" :
                  "[&>div]:bg-emerald-500"
                )}
              />
            </div>
          </div>
        </CardContent>
      </Card>
    </button>
  )
}

function StageOverviewList({ projects }: { projects: Project[] }) {
  return (
    <Card className="border-zinc-800/80 bg-[#18181b] shadow-none">
      <CardContent className="space-y-3 px-4 py-4 sm:space-y-4 sm:px-5 sm:py-5">
        {projects.length === 0 ? (
          <div className="text-sm text-zinc-500">暂无阶段数据。</div>
        ) : (
          projects.map((project) => {
            const stageIndex = STAGES.findIndex((stage) => stage.id === project.stage)
            const stage = STAGES[stageIndex] || STAGES[0]
            return (
              <div key={project.id} className="space-y-2">
                <div className="flex items-center justify-between gap-3 text-xs">
                  <span className="truncate text-zinc-400">{project.name}</span>
                  <span className="shrink-0 text-zinc-300">{stage.icon} {stage.label}</span>
                </div>
                <Progress
                  value={getProjectProgress(project)}
                  className={cn(
                    "h-1 bg-zinc-900 sm:h-2",
                    project.status === "completed" ? "[&>div]:bg-cyan-500" :
                    project.status === "paused" ? "[&>div]:bg-amber-500" :
                    "[&>div]:bg-emerald-500"
                  )}
                />
              </div>
            )
          })
        )}
      </CardContent>
    </Card>
  )
}

function TaskExecutionCard({ stats }: { stats: Stats }) {
  const progress = stats.tasks > 0 ? Math.round((stats.tasksDone / stats.tasks) * 100) : 0
  return (
    <Card className="border-zinc-800/80 bg-[#18181b] shadow-none">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm text-zinc-200">全局任务完成率</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 px-4 pb-4 sm:space-y-4 sm:px-5 sm:pb-5">
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-zinc-500">完成率</span>
            <span className="font-medium text-zinc-100">{progress}%</span>
          </div>
          <Progress value={progress} className="h-1 bg-zinc-900 [&>div]:bg-emerald-500 sm:h-2" />
        </div>
        <div className="grid grid-cols-3 gap-2 rounded-xl border border-zinc-800/80 bg-[#111113] p-3 sm:gap-3 sm:rounded-2xl sm:p-4">
          <MiniStat label="项目" value={stats.total} />
          <MiniStat label="进行中" value={stats.active} accentClassName="text-emerald-300" />
          <MiniStat label="已完成" value={stats.completed} accentClassName="text-cyan-300" />
        </div>
      </CardContent>
    </Card>
  )
}

function RecentNotesCard({ notes }: { notes: RecentNotePreview[] }) {
  return (
    <Card className="border-zinc-800/80 bg-[#18181b] shadow-none">
      <CardContent className="px-0 py-0">
        {notes.length === 0 ? (
          <div className="px-5 py-10 text-sm text-zinc-500">暂无笔记记录。</div>
        ) : (
          <div className="divide-y divide-zinc-800/70">
            {notes.map((note) => (
              <div key={note.id} className="px-4 py-3 sm:px-5 sm:py-4">
                <p className="line-clamp-2 text-sm leading-6 text-zinc-300 sm:line-clamp-none">{note.content}</p>
                <div className="mt-2 flex items-center gap-2 text-[11px] text-zinc-500">
                  <span>{note.projectName}</span>
                  <span>·</span>
                  <span>{sharedFormatDateTime(note.created_at, "date")}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function MiniStat({ label, value, accentClassName }: { label: string; value: string | number; accentClassName?: string }) {
  return (
    <div>
      <div className="text-[10px] tracking-[0.18em] text-zinc-500">{label}</div>
      <div className={cn("mt-1 text-lg font-semibold text-zinc-100", accentClassName)}>{value}</div>
    </div>
  )
}

/* ═══════════════════ Server Card ═══════════════════ */

function ServerFleetCard({ server }: { server: ServerSnapshot }) {
  const memoryPct = computeUsagePct(server.memory_used_mb, server.memory_total_mb)
  const diskPct = clampPercent(server.disk_usage_pct || computeUsagePct(server.disk_used_gb, server.disk_total_gb))
  const runningServices = (server.services ?? []).filter((service) => isServiceRunning(service)).length
  const stoppedServices = Math.max((server.services ?? []).length - runningServices, 0)

  return (
    <Card className={server.ssh_reachable ? "border-zinc-800/80 bg-[#111113] shadow-none" : "border-rose-500/60 bg-[#111113] shadow-none"}>
      <CardContent className="space-y-4 p-5">
        <div className="flex items-start justify-between gap-3 border-b border-zinc-800/80 pb-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-base font-semibold text-zinc-50">
              <span>🖥️</span>
              <span className="truncate">{server.name}</span>
            </div>
            <div className="mt-0.5 text-xs text-zinc-500">{server.role || "—"}</div>
          </div>
          <div className="shrink-0 text-right text-xs text-zinc-500">
            <div>{server.cloud || "—"} · {server.region || "—"}</div>
            <div className="mt-0.5">{server.os || "—"}</div>
          </div>
        </div>

        <div className="space-y-2.5">
          <MetricLine label="CPU" value={`${server.cpu_cores ?? 0} cores`} />
          <UsageBar label="内存" used={server.memory_used_mb} total={server.memory_total_mb} unit="MB" percent={memoryPct} />
          <UsageBar label="磁盘" used={server.disk_used_gb} total={server.disk_total_gb} unit="GB" percent={diskPct} />
          <MetricLine label="运行时间" value={formatUptime(server.uptime_seconds)} />
        </div>

        <div className="space-y-2 border-t border-zinc-800/80 pt-3">
          <div className="flex flex-wrap items-center gap-3 text-xs text-zinc-400">
            <span>服务: <span className="text-emerald-300">{runningServices} running</span> / <span className="text-rose-300">{stoppedServices} stopped</span></span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {(server.services ?? []).map((service) => <ServiceBadge key={`${server.id}-${service.name}`} service={service} />)}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-zinc-800/80 pt-3 text-xs">
          <span className="text-zinc-400">
            SSH: <span className={server.ssh_reachable ? "text-emerald-300" : "text-rose-300"}>{server.ssh_reachable ? "✅" : "❌"}</span>{" "}
            {server.ip}:{server.ssh_port}
          </span>
          <div className="flex flex-wrap gap-1.5">
            {(server.tags ?? []).map((tag) => (
              <Badge key={`${server.id}-${tag}`} variant="outline" className="border-zinc-700 bg-[#18181b] text-zinc-400 text-xs">
                {tag}
              </Badge>
            ))}
          </div>
        </div>

        {(server.alerts ?? []).length > 0 && <AlertsPanel alerts={server.alerts} />}
      </CardContent>
    </Card>
  )
}

/* ═══════════════════ Shared UI ═══════════════════ */

function DotIndicator({ ok, dim }: { ok: boolean; dim?: boolean }) {
  return (
    <span
      className={`inline-block h-2 w-2 rounded-full ${
        dim ? "bg-zinc-700" : ok ? "bg-emerald-400" : "bg-rose-400"
      }`}
    />
  )
}

function UsageBar({ label, used, total, unit, percent }: {
  label: string; used: number; total: number; unit: string; percent: number
}) {
  const color = getUsageBarColor(percent)
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-3 text-xs">
        <span className="text-zinc-400">{label}</span>
        <span className="text-zinc-500">{fmtNum(used)}/{fmtNum(total)} {unit} ({percent}%)</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-zinc-800">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${percent}%` }} />
      </div>
    </div>
  )
}

function MetricLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 text-xs">
      <span className="text-zinc-400">{label}</span>
      <span className="text-zinc-500">{value}</span>
    </div>
  )
}

function ServiceBadge({ service }: { service: ServerService }) {
  const running = isServiceRunning(service)
  return (
    <span className={`rounded-full border px-2 py-0.5 text-xs ${
      running ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" : "border-rose-500/30 bg-rose-500/10 text-rose-300"
    }`}>
      {service.name}
    </span>
  )
}

function AlertsPanel({ alerts }: { alerts: ServerAlert[] }) {
  return (
    <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-3">
      <div className="mb-1.5 text-xs font-medium text-rose-300">告警</div>
      <div className="space-y-1 text-xs text-rose-200">
        {alerts.map((alert, i) => (
          <div key={`${alert.level}-${i}`}>
            <span className="font-medium uppercase">{alert.level}</span> · {alert.message}
          </div>
        ))}
      </div>
    </div>
  )
}

function StatusPill({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <Badge
      variant="outline"
      className={ok ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" : "border-rose-500/30 bg-rose-500/10 text-rose-300"}
    >
      {children}
    </Badge>
  )
}

function EmptyRow({ text }: { text: string }) {
  return <div className="rounded-xl border border-dashed border-zinc-800/80 bg-[#111113] px-4 py-8 text-center text-sm text-zinc-500">{text}</div>
}

/* ═══════════════════ Utilities ═══════════════════ */

function formatDateTime(value?: string | null) {
  if (!value) return "—"
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return "—"
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(d)
}

function formatUptime(seconds?: number) {
  const s = Math.max(0, Math.floor(seconds ?? 0))
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60)
  if (d > 0) return `${d}天 ${h}小时`
  if (h > 0) return `${h}小时 ${m}分钟`
  return `${m}分钟`
}

function computeUsagePct(used?: number, total?: number) {
  if (!total || total <= 0) return 0
  return clampPercent(Math.round(((used ?? 0) / total) * 100))
}

function clampPercent(v?: number) { return Math.min(100, Math.max(0, Math.round(v ?? 0))) }

function getUsageBarColor(pct: number) {
  if (pct < 50) return "bg-emerald-500"
  if (pct <= 80) return "bg-amber-500"
  return "bg-rose-500"
}

function isServiceRunning(service: ServerService) { return String(service.status || "").toLowerCase() === "running" }

function fmtNum(v?: number) { return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 1 }).format(v ?? 0) }
