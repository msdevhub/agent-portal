import { useMemo, useState } from "react"
import { Activity, Bot, ChevronDown, ExternalLink, FlaskConical, MessageSquare, Monitor, Plus, RefreshCw, Server, Timer } from "lucide-react"

import { UserMenu } from "@/components/auth/UserMenu"
import { CommandBar } from "@/components/portal/CommandBar"
import type { CommandTarget } from "@/components/portal/CommandBar"
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
  const [commandTarget, setCommandTarget] = useState<CommandTarget | null>(null)
  const summary = dashboard.summary ?? {}
  const lastUpdated = dashboard.updated_at ?? summary.timestamp ?? null
  const servers = dashboard.servers ?? []
  const agents = dashboard.agents ?? []
  const cronJobs = dashboard.cron_jobs ?? []
  const productionSites = dashboard.production_sites ?? []
  const containers = dashboard.containers ?? []

  const serverOnlineCount = servers.filter((s) => s.ssh_reachable).length

  return (
    <main className="flex min-h-screen w-full flex-col gap-5 px-4 py-5 pb-24 sm:gap-8 sm:px-6 sm:py-8 lg:px-8 lg:py-10">
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
      {activeTab === "bots" && <BotFleetTab dashboard={dashboard} loading={loading} onSelectTarget={setCommandTarget} />}
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

      {/* Command Bar */}
      <CommandBar target={commandTarget} onClearTarget={() => setCommandTarget(null)} />
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

function BotFleetTab({ dashboard, loading, onSelectTarget }: { dashboard: DashboardData; loading: boolean; onSelectTarget: (t: CommandTarget) => void }) {
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
              <BotCard key={agent.id} agent={agent} onSelectTarget={onSelectTarget} />
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

function BotCard({ agent, onSelectTarget }: { agent: DashboardAgent; onSelectTarget: (t: CommandTarget) => void }) {
  const prod = agent.production
  const dev = agent.dev
  const container = agent.container
  const crons = agent.crons
  const tasks = agent.tasks
  const canMessage = !!agent.mm_user_id

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
          <div className="flex items-center gap-1.5">
            {canMessage && (
              <button
                type="button"
                onClick={() =>
                  onSelectTarget({
                    name: agent.name ?? agent.id,
                    emoji: agent.emoji ?? "🤖",
                    user_id: agent.mm_user_id!,
                  })
                }
                className="rounded-lg border border-zinc-800 bg-[#18181b] p-2 text-zinc-500 transition hover:border-emerald-500/40 hover:bg-emerald-500/10 hover:text-emerald-300"
                title={`给 ${agent.name ?? agent.id} 发指令`}
              >
                <MessageSquare className="h-4 w-4" />
              </button>
            )}
            {agent.github && (
              <a href={agent.github} target="_blank" rel="noreferrer" className="text-zinc-500 transition hover:text-zinc-300" title="GitHub">
                <ExternalLink className="h-4 w-4" />
              </a>
            )}
          </div>
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

function classifyServers(servers: ServerSnapshot[]) {
  const alertServers: ServerSnapshot[] = []
  const unreachable: ServerSnapshot[] = []
  const coreServers: ServerSnapshot[] = []
  const proxyServers: ServerSnapshot[] = []
  const otherServers: ServerSnapshot[] = []

  for (const s of servers) {
    if ((s.alerts ?? []).length > 0) alertServers.push(s)
    else if (!s.ssh_reachable) unreachable.push(s)
    else if (s.name?.startsWith("proxy-")) proxyServers.push(s)
    else if (["claw-runtime", "mattermost-server", "dev-ubuntu-host", "PVE2"].includes(s.name)) coreServers.push(s)
    else otherServers.push(s)
  }
  return { alertServers, unreachable, coreServers, proxyServers, otherServers }
}

function ServerFleetTab({ servers, loading }: { servers: ServerSnapshot[]; loading: boolean }) {
  const [proxyExpanded, setProxyExpanded] = useState(false)
  const [unreachableExpanded, setUnreachableExpanded] = useState(false)
  const onlineCount = servers.filter((s) => s.ssh_reachable).length
  const totalAlerts = servers.reduce((sum, s) => sum + (s.alerts?.length ?? 0), 0)
  const { alertServers, unreachable, coreServers, proxyServers, otherServers } = useMemo(() => classifyServers(servers), [servers])

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

      {loading && servers.length === 0 ? (
        <EmptyRow text="加载中..." />
      ) : servers.length === 0 ? (
        <EmptyRow text="暂无服务器数据" />
      ) : (
        <div className="space-y-8">
          {/* Alert servers — always top, always visible */}
          {alertServers.length > 0 && (
            <ServerGroup title={`🚨 告警 (${alertServers.length})`} accent="text-rose-300">
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-3">
                {alertServers.map((s) => <ServerFleetCard key={s.id} server={s} mode="core" />)}
              </div>
            </ServerGroup>
          )}

          {/* Core servers — full-width when ≤2 */}
          {coreServers.length > 0 && (
            <ServerGroup title={`🏢 核心服务 (${coreServers.length})`} accent="text-blue-300">
              <div className={cn(
                "grid gap-3",
                coreServers.length === 1 ? "grid-cols-1" :
                coreServers.length === 2 ? "grid-cols-1 lg:grid-cols-2" :
                "grid-cols-1 lg:grid-cols-2 xl:grid-cols-3"
              )}>
                {coreServers.map((s) => <ServerFleetCard key={s.id} server={s} mode="core" />)}
              </div>
            </ServerGroup>
          )}

          {/* Other named servers */}
          {otherServers.length > 0 && (
            <ServerGroup title={`🖥️ 其他服务 (${otherServers.length})`} accent="text-zinc-300">
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-3">
                {otherServers.map((s) => <ServerFleetCard key={s.id} server={s} mode="core" />)}
              </div>
            </ServerGroup>
          )}

          {/* Proxy nodes — collapsed by default */}
          {proxyServers.length > 0 && (() => {
            const memPcts = proxyServers.map((p) => computeUsagePct(p.memory_used_mb, p.memory_total_mb))
            const avgMem = Math.round(memPcts.reduce((a, b) => a + b, 0) / memPcts.length)
            const maxMem = Math.max(...memPcts)
            const allHealthy = proxyServers.every((p) => p.ssh_reachable)
            return (
              <ServerGroup
                title={`🌐 代理节点 (${proxyServers.length})`}
                accent="text-zinc-400"
                collapsible
                expanded={proxyExpanded}
                onToggle={() => setProxyExpanded(!proxyExpanded)}
                summary={`${allHealthy ? "全部健康" : "⚠ 部分异常"} · 内存 ${avgMem}% 均 / ${maxMem}% 峰`}
              >
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {proxyServers.map((s) => <ServerFleetCard key={s.id} server={s} mode="compact" />)}
                </div>
              </ServerGroup>
            )
          })()}

          {/* Unreachable — collapsed by default */}
          {unreachable.length > 0 && (
            <ServerGroup
              title={`❌ 不可达 (${unreachable.length})`}
              accent="text-zinc-500"
              collapsible
              expanded={unreachableExpanded}
              onToggle={() => setUnreachableExpanded(!unreachableExpanded)}
              summary={`${unreachable.length} 台 SSH 不可达`}
            >
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {unreachable.map((s) => <ServerFleetCard key={s.id} server={s} mode="compact" />)}
              </div>
            </ServerGroup>
          )}
        </div>
      )}
    </div>
  )
}

function ServerGroup({ title, accent, children, collapsible, expanded, onToggle, summary }: {
  title: string; accent: string; children: React.ReactNode
  collapsible?: boolean; expanded?: boolean; onToggle?: () => void; summary?: string
}) {
  return (
    <section>
      {collapsible ? (
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          className="mb-3 flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition hover:bg-zinc-800/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60"
        >
          <h3 className={`text-sm font-semibold ${accent}`}>{title}</h3>
          {summary && <span className="text-xs text-zinc-500">{summary}</span>}
          <ChevronDown className={cn("ml-auto h-4 w-4 text-zinc-500 transition-transform", expanded && "rotate-180")} />
        </button>
      ) : (
        <h3 className={`mb-3 pl-2 text-sm font-semibold ${accent}`}>{title}</h3>
      )}
      {(!collapsible || expanded) && children}
    </section>
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

function ServerFleetCard({ server, mode = "core" }: { server: ServerSnapshot; mode?: "core" | "compact" }) {
  const [expanded, setExpanded] = useState(false)
  const memoryPct = computeUsagePct(server.memory_used_mb, server.memory_total_mb)
  const diskPct = clampPercent(server.disk_usage_pct || computeUsagePct(server.disk_used_gb, server.disk_total_gb))
  const services = server.services ?? []
  const alerts = server.alerts ?? []
  const tags = server.tags ?? []
  const runningServices = services.filter((s) => isServiceRunning(s)).length
  const stoppedServices = Math.max(services.length - runningServices, 0)
  const hasAlerts = alerts.length > 0
  const worstUsage = Math.max(memoryPct, diskPct)

  // Compact mode for proxy/unreachable: minimal single-line card
  if (mode === "compact") {
    return (
      <Card className="border-zinc-800/80 bg-[#111113] shadow-none">
        <CardContent className="p-0">
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            aria-expanded={expanded}
            className="flex w-full items-center gap-2 px-3 py-2 text-left transition hover:bg-zinc-800/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 focus-visible:ring-inset"
          >
            <DotIndicator ok={server.ssh_reachable} />
            <span className="min-w-0 flex-1 truncate text-xs font-medium text-zinc-200">{server.name}</span>
            <span className={cn("text-[10px] font-medium", worstUsage > 80 ? "text-rose-300" : worstUsage > 50 ? "text-amber-300" : "text-zinc-500")}>
              {worstUsage}%
            </span>
            <ChevronDown className={cn("h-3 w-3 shrink-0 text-zinc-600 transition-transform", expanded && "rotate-180")} />
          </button>
          {expanded && (
            <div className="space-y-2 border-t border-zinc-800/60 px-3 pb-3 pt-2">
              <UsageBar label="内存" used={server.memory_used_mb} total={server.memory_total_mb} unit="MB" percent={memoryPct} />
              <UsageBar label="磁盘" used={server.disk_used_gb} total={server.disk_total_gb} unit="GB" percent={diskPct} />
              <div className="text-[11px] text-zinc-500">
                SSH: <span className={server.ssh_reachable ? "text-emerald-300" : "text-rose-300"}>{server.ssh_reachable ? "✅" : "❌"}</span> {server.ip}:{server.ssh_port}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    )
  }

  // Core mode: full card with alerts surfaced
  return (
    <Card className={cn(
      "shadow-none transition-colors",
      hasAlerts ? "border-l-2 border-l-rose-500 border-t-zinc-800/80 border-r-zinc-800/80 border-b-zinc-800/80 bg-rose-500/5 shadow-[inset_2px_0_8px_-4px_rgba(244,63,94,0.3)]" :
      !server.ssh_reachable ? "border-rose-500/40 bg-[#111113]" :
      "border-zinc-800/80 bg-[#111113]"
    )}>
      <CardContent className="p-0">
        {/* Collapsed: always visible summary row */}
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          aria-expanded={expanded}
          className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-zinc-800/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 focus-visible:ring-inset"
        >
          <DotIndicator ok={server.ssh_reachable && !hasAlerts} />

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate text-sm font-semibold text-zinc-50">{server.name}</span>
              {hasAlerts && (
                <span
                  className="rounded bg-rose-500/20 px-1.5 py-0.5 text-[10px] font-medium text-rose-300"
                  title={alerts.map((a) => `[${a.level}] ${a.message}`).join("\n")}
                  aria-label={`告警: ${alerts.map((a) => a.message).join("; ")}`}
                >
                  ⚠ {summarizeAlert(alerts[0])}
                </span>
              )}
            </div>
            <div className="text-[11px] text-zinc-500">{server.role || server.cloud || "—"}</div>
          </div>

          {/* MEM/DISK mini bars */}
          <div className="hidden w-32 gap-1.5 sm:flex sm:flex-col">
            <MiniUsageBar label="MEM" percent={memoryPct} />
            <MiniUsageBar label="DISK" percent={diskPct} />
          </div>

          <div className="sm:hidden">
            <span className={cn("text-xs font-medium", worstUsage > 80 ? "text-rose-300" : worstUsage > 50 ? "text-amber-300" : "text-emerald-300")}>
              {worstUsage}%
            </span>
          </div>

          {/* Service count + SSH status */}
          <div className="hidden items-center gap-2 text-[11px] lg:flex">
            <span className="text-zinc-500"><span className="text-emerald-400">{runningServices}</span>/{services.length}</span>
            <span className={server.ssh_reachable ? "text-emerald-400" : "text-rose-400"}>{server.ssh_reachable ? "🟢" : "🔴"}</span>
          </div>

          <ChevronDown className={cn("h-4 w-4 shrink-0 text-zinc-500 transition-transform", expanded && "rotate-180")} />
        </button>

        {/* Core card: inline service badges when not expanded */}
        {!expanded && services.length > 0 && (
          <div className="flex flex-wrap gap-1 border-t border-zinc-800/40 px-4 py-2">
            {services.slice(0, 8).map((service) => <ServiceBadge key={`${server.id}-${service.name}-inline`} service={service} />)}
            {services.length > 8 && (
              <Badge variant="outline" className="border-zinc-700 bg-[#18181b] text-[10px] text-zinc-500">
                +{services.length - 8}
              </Badge>
            )}
          </div>
        )}

        {/* Expanded: full details */}
        {expanded && (
          <div className="space-y-4 border-t border-zinc-800/60 px-4 pb-4 pt-3">
            <div className="space-y-2.5">
              <MetricLine label="CPU" value={`${server.cpu_cores ?? 0} cores`} />
              <UsageBar label="内存" used={server.memory_used_mb} total={server.memory_total_mb} unit="MB" percent={memoryPct} />
              <UsageBar label="磁盘" used={server.disk_used_gb} total={server.disk_total_gb} unit="GB" percent={diskPct} />
              <MetricLine label="运行时间" value={formatUptime(server.uptime_seconds)} />
            </div>

            {services.length > 0 && (
              <div className="space-y-2 border-t border-zinc-800/60 pt-3">
                <div className="flex flex-wrap items-center gap-3 text-xs text-zinc-400">
                  <span>服务: <span className="text-emerald-300">{runningServices} running</span> / <span className="text-rose-300">{stoppedServices} stopped</span></span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {services.map((service) => <ServiceBadge key={`${server.id}-${service.name}`} service={service} />)}
                </div>
              </div>
            )}

            <div className="space-y-2 border-t border-zinc-800/60 pt-3 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-zinc-400">
                  SSH: <span className={server.ssh_reachable ? "text-emerald-300" : "text-rose-300"}>{server.ssh_reachable ? "✅" : "❌"}</span>{" "}
                  {server.ip}:{server.ssh_port}
                </span>
                <span className="text-zinc-600">{server.cloud || "—"} · {server.region || "—"}</span>
              </div>
              <div className="text-zinc-600">{server.os || "—"}</div>
              {tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {tags.map((tag) => (
                    <Badge key={`${server.id}-${tag}`} variant="outline" className="border-zinc-700 bg-[#18181b] text-xs text-zinc-400">
                      {tag}
                    </Badge>
                  ))}
                </div>
              )}
            </div>

            {hasAlerts && <AlertsPanel alerts={alerts} />}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function MiniUsageBar({ label, percent }: { label: string; percent: number }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="w-7 text-[9px] text-zinc-500">{label}</span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-800">
        <div className={`h-full rounded-full ${getUsageBarColor(percent)}`} style={{ width: `${percent}%` }} />
      </div>
      <span className={cn("w-7 text-right text-[9px]", percent > 80 ? "text-rose-300" : "text-zinc-500")}>{percent}%</span>
    </div>
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

function summarizeAlert(alert?: ServerAlert): string {
  if (!alert?.message) return "告警"
  const msg = alert.message
  // Detect common patterns and produce structured summaries
  if (/磁盘|disk/i.test(msg)) {
    const pct = msg.match(/(\d+)%/)
    return pct ? `磁盘 ${pct[1]}%` : "磁盘告警"
  }
  if (/内存|memory|mem/i.test(msg)) {
    const pct = msg.match(/(\d+)%/)
    return pct ? `内存 ${pct[1]}%` : "内存告警"
  }
  if (/restart|重启/i.test(msg)) return "容器重启中"
  if (/cpu/i.test(msg)) return "CPU 过载"
  if (/ssh|连接|connect/i.test(msg)) return "SSH 异常"
  // Fallback: first 20 chars
  return msg.length > 20 ? msg.slice(0, 20) + "…" : msg
}

function fmtNum(v?: number) { return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 1 }).format(v ?? 0) }
