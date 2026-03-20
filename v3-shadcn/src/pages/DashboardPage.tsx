import { useMemo, useState } from "react"
import {
  AlertTriangle,
  Box,
  ChevronDown,
  ChevronRight,
  Clock,
  Cpu,
  ExternalLink,
  FlaskConical,
  Globe,
  HardDrive,
  History,
  MapPin,
  MessageSquare,
  Monitor,
  Plus,
  RefreshCw,
  Server,
  Shield,
  Timer,
  Workflow,
  X,
} from "lucide-react"

import { UserMenu } from "@/components/auth/UserMenu"
import { CommandBar } from "@/components/portal/CommandBar"
import type { CommandTarget } from "@/components/portal/CommandBar"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import {
  StatCard,
  StatusBadge,
  formatDateTime as sharedFormatDateTime,
  getProjectProgress,
} from "@/components/portal/shared"
import type {
  CronJob,
  DashboardAgent,
  DashboardData,
  Project,
  ServerSnapshot,
  Stats,
} from "@/lib/api"
import { STAGES } from "@/lib/constants"
import { cn } from "@/lib/utils"

/* ═══════════════════ Types ═══════════════════ */

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
  historyPoints: string[]
  historyBotPoints?: string[]
  historyServerPoints?: string[]
  selectedAsOf: string | null
  onSelectAsOf: (value: string | null) => void
  stats: Stats
  projects: Project[]
  recentNotes: RecentNotePreview[]
  projectsLoading: boolean
  onCreateProject: () => void
  onOpenProject: (slug: string) => void
}

type TabId = "bots" | "servers" | "projects"

/* ═══════════════════ Main Page ═══════════════════ */

export function DashboardPage({
  dashboard, loading, refreshing, historyPoints, historyBotPoints, historyServerPoints, selectedAsOf, onSelectAsOf,
  stats, projects, recentNotes, projectsLoading,
  onCreateProject, onOpenProject,
}: DashboardPageProps) {
  const [activeTab, setActiveTab] = useState<TabId>("bots")
  const [selectedTargets, setSelectedTargets] = useState<CommandTarget[]>([])

  const summary = dashboard.summary ?? {}
  const lastUpdated = dashboard.updated_at ?? summary.timestamp ?? null
  const asOf = dashboard.as_of ?? lastUpdated ?? null
  const servers = dashboard.servers ?? []
  const agents = dashboard.agents ?? []
  const serverOnlineCount = servers.filter((s) => s.ssh_reachable).length

  const handleToggleTarget = (target: CommandTarget) => {
    setSelectedTargets(prev => {
      const exists = prev.some(t => t.id === target.id)
      if (exists) return prev.filter(t => t.id !== target.id)
      return [...prev, target]
    })
  }

  return (
    <main className="flex min-h-screen w-full flex-col px-4 py-5 pb-32 sm:px-6 sm:py-6 lg:px-8 lg:py-8">
      {/* Header */}
      <header className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-50 sm:text-3xl">Research Fleet Portal</h1>
          <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-zinc-500">
            <span>最近更新：{fmtDateTime(lastUpdated)}</span>
            {refreshing && (
              <span className="inline-flex items-center gap-1 text-emerald-300">
                <RefreshCw className="h-3 w-3 animate-spin" />
                刷新中
              </span>
            )}
          </div>
        </div>
        <UserMenu />
      </header>

      {/* Tab Bar + Inline Time Machine */}
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <TabButton active={activeTab === "bots"} onClick={() => setActiveTab("bots")} icon={Workflow} label="Bot Fleet" count={agents.length} />
        <TabButton active={activeTab === "servers"} onClick={() => setActiveTab("servers")} icon={Server} label="Server Fleet" count={`${serverOnlineCount}/${servers.length}`} />
        <TabButton active={activeTab === "projects"} onClick={() => setActiveTab("projects")} icon={FlaskConical} label="Projects" count={projects.length} />

        {/* Spacer */}
        <div className="flex-1" />

        {/* Inline Time Machine */}
        <InlineTimeMachine
          points={historyPoints}
          value={selectedAsOf}
          latestLabel={asOf}
          onChange={onSelectAsOf}
        />
      </div>

      {/* Tab Content */}
      <div className="min-h-[400px]">
        {activeTab === "bots" && (
          <BotFleetTab
            dashboard={dashboard}
            loading={loading}
            selectedTargets={selectedTargets}
            onToggleTarget={handleToggleTarget}
          />
        )}
        {activeTab === "servers" && (
          <ServerFleetTab
            servers={servers}
            loading={loading}
            selectedTargets={selectedTargets}
            onToggleTarget={handleToggleTarget}
          />
        )}
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
      </div>

      {/* Command Bar */}
      <CommandBar
        targets={selectedTargets}
        onClearTarget={(id) => {
          if (id) setSelectedTargets(prev => prev.filter(t => t.id !== id))
          else setSelectedTargets([])
        }}
      />
    </main>
  )
}

/* ═══════════════════ Inline Time Machine ═══════════════════ */

function InlineTimeMachine({ points, value, latestLabel, onChange }: {
  points: string[]
  value: string | null
  latestLabel: string | null
  onChange: (v: string | null) => void
}) {
  const canTravel = points.length > 1
  const currentIndex = value ? Math.max(points.findIndex((p) => p === value), 0) : 0
  const displayTime = value ? fmtDateTime(value) : fmtDateTime(latestLabel)

  return (
    <div className="flex items-center gap-3 rounded-lg border border-zinc-800/60 bg-[#111113] px-3 py-1.5">
      <History className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
      <span className="font-mono text-xs text-zinc-300 whitespace-nowrap">{displayTime}</span>
      <input
        type="range"
        min={0}
        max={Math.max(points.length - 1, 0)}
        step={1}
        value={Math.min(currentIndex, Math.max(points.length - 1, 0))}
        disabled={!canTravel}
        onChange={(e) => {
          const i = Number(e.target.value)
          onChange(i === 0 ? null : points[i] ?? null)
        }}
        className="tm-slider w-24 sm:w-32 disabled:opacity-40"
      />
      {value && (
        <button onClick={() => onChange(null)} className="text-[10px] text-emerald-400 hover:text-emerald-300 whitespace-nowrap">
          最新
        </button>
      )}
    </div>
  )
}

/* ═══════════════════ Tab Button ═══════════════════ */

function TabButton({ active, onClick, icon: Icon, label, count }: {
  active: boolean; onClick: () => void; icon: React.ElementType; label: string; count: number | string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition",
        active ? "bg-zinc-800 text-zinc-100" : "text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200"
      )}
    >
      <Icon className={cn("h-4 w-4", active ? "text-emerald-400" : "text-zinc-500")} />
      {label}
      <span className={cn("ml-0.5 rounded-md px-1.5 py-0.5 text-xs", active ? "bg-zinc-700 text-zinc-300" : "bg-zinc-800/50 text-zinc-500")}>
        {count}
      </span>
    </button>
  )
}

/* ═══════════════════ Bot Fleet Tab ═══════════════════ */

function BotFleetTab({ dashboard, loading, selectedTargets, onToggleTarget }: {
  dashboard: DashboardData; loading: boolean; selectedTargets: CommandTarget[]; onToggleTarget: (t: CommandTarget) => void
}) {
  const agents = dashboard.agents ?? []
  return (
    <div className="space-y-3">
      {loading && agents.length === 0 ? <EmptyRow text="加载中..." /> : agents.length === 0 ? <EmptyRow text="暂无 Agent 数据" /> : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {agents.map((agent) => (
            <BotCard
              key={agent.id}
              agent={agent}
              selected={selectedTargets.some(t => t.id === agent.id)}
              onToggle={() => onToggleTarget({ id: agent.id, name: agent.name ?? agent.id, emoji: "🤖", user_id: agent.mm_user_id!, kind: "bot" })}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function BotCard({ agent, selected, onToggle }: { agent: DashboardAgent; selected: boolean; onToggle: () => void }) {
  const [cronOpen, setCronOpen] = useState(false)
  const prod = agent.production
  const dev = agent.dev
  const container = agent.container
  const crons = agent.crons
  const canMessage = !!agent.mm_user_id

  return (
    <div className={cn(
      "group relative flex flex-col gap-2.5 rounded-xl border bg-[#111113] p-3.5 transition-all hover:border-zinc-700",
      selected ? "border-emerald-500/50 bg-emerald-500/5 ring-1 ring-emerald-500/20" : "border-zinc-800/80"
    )}>
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <div className={cn(
            "flex h-8 w-8 items-center justify-center rounded-lg border",
            selected ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" : "border-zinc-800 bg-[#18181b] text-zinc-400"
          )}>
            <Workflow className="h-4 w-4" />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-semibold text-zinc-100">{agent.name}</span>
              {agent.role === "coordination" && (
                <Badge variant="outline" className="border-zinc-700 bg-zinc-800/50 px-1 py-0 text-[10px] text-zinc-400">协调</Badge>
              )}
            </div>
            <div className="text-[11px] text-zinc-500">@{agent.id}</div>
          </div>
        </div>
        {canMessage && (
          <button onClick={(e) => { e.stopPropagation(); onToggle() }} className={cn(
            "rounded-lg p-1.5 transition",
            selected ? "bg-emerald-500 text-white" : "text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
          )}>
            {selected ? <X className="h-3.5 w-3.5" /> : <MessageSquare className="h-3.5 w-3.5" />}
          </button>
        )}
      </div>

      {/* Status Grid */}
      <div className="grid grid-cols-2 gap-1.5 text-xs">
        {/* Production */}
        <EnvCell icon={Globe} label="生产" status={prod} />
        {/* Dev */}
        <EnvCell icon={Monitor} label="开发" status={dev} />
        {/* Container */}
        {container && (
          <div className="col-span-2 flex items-center gap-1.5 rounded-md bg-[#18181b] px-2 py-1.5">
            <Box className="h-3 w-3 text-zinc-500" />
            <span className="text-[10px] text-zinc-500">容器</span>
            <span className={cn("ml-auto text-[10px] font-medium", container.status === "running" ? "text-emerald-400" : "text-rose-400")}>
              {container.status}
            </span>
          </div>
        )}
      </div>

      {/* Cron Jobs - Clickable */}
      {crons && crons.total > 0 && (
        <div className="rounded-md border border-zinc-800/50 bg-[#18181b]">
          <button
            onClick={() => setCronOpen(!cronOpen)}
            className="flex w-full items-center gap-2 px-2 py-1.5 text-xs transition hover:bg-zinc-800/50"
          >
            <Timer className="h-3 w-3 text-zinc-500" />
            <span className="text-zinc-400">Cron</span>
            <span className={cn("ml-auto font-medium", crons.error > 0 ? "text-rose-400" : "text-emerald-400")}>
              {crons.ok} ok / {crons.error} err
            </span>
            <ChevronDown className={cn("h-3 w-3 text-zinc-500 transition-transform", cronOpen && "rotate-180")} />
          </button>
          {cronOpen && (
            <div className="border-t border-zinc-800/50 px-2 py-1.5 space-y-1">
              {crons.jobs?.map((job: CronJob) => (
                <div key={job.name} className="flex items-center justify-between text-[10px]">
                  <span className="text-zinc-400 truncate mr-2">{job.name}</span>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className="text-zinc-600">{job.schedule}</span>
                    <span className={cn("rounded px-1 py-0.5 font-medium",
                      job.last_status === "ok" ? "bg-emerald-500/10 text-emerald-400" : "bg-rose-500/10 text-rose-400"
                    )}>
                      {job.last_status}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function EnvCell({ icon: Icon, label, status }: {
  icon: React.ElementType; label: string; status: { url?: string; status?: number } | null | undefined
}) {
  return (
    <div className="flex items-center gap-1.5 rounded-md bg-[#18181b] px-2 py-1.5">
      <Icon className="h-3 w-3 text-zinc-500" />
      <span className="text-[10px] text-zinc-500">{label}</span>
      {status ? (
        <a
          href={status.url}
          target="_blank"
          rel="noreferrer"
          className={cn("ml-auto text-[10px] font-medium hover:underline",
            status.status === 200 ? "text-emerald-400" : "text-rose-400"
          )}
        >
          {status.status === 200 ? "正常" : "异常"} ({status.status})
        </a>
      ) : (
        <span className="ml-auto text-[10px] text-zinc-600">无</span>
      )}
    </div>
  )
}

/* ═══════════════════ Server Fleet Tab ═══════════════════ */

function classifyServers(servers: ServerSnapshot[]) {
  const domestic: ServerSnapshot[] = []
  const global: ServerSnapshot[] = []
  for (const s of servers) {
    const isChina = (s.cloud || "").toLowerCase().includes("china") || (s.region || "").toLowerCase().includes("china")
    if (isChina) domestic.push(s)
    else global.push(s)
  }
  // Sort: unreachable first in each group
  const sortFn = (a: ServerSnapshot, b: ServerSnapshot) => {
    if (a.ssh_reachable === b.ssh_reachable) return a.name.localeCompare(b.name)
    return a.ssh_reachable ? 1 : -1
  }
  domestic.sort(sortFn)
  global.sort(sortFn)
  return { domestic, global }
}

function ServerFleetTab({ servers, loading, selectedTargets, onToggleTarget }: {
  servers: ServerSnapshot[]; loading: boolean; selectedTargets: CommandTarget[]; onToggleTarget: (t: CommandTarget) => void
}) {
  const { domestic, global } = useMemo(() => classifyServers(servers), [servers])
  return (
    <div className="space-y-6">
      {loading && servers.length === 0 ? <EmptyRow text="加载中..." /> : servers.length === 0 ? <EmptyRow text="暂无服务器数据" /> : (
        <>
          {domestic.length > 0 && <ServerGroup label="国内区域" flag="🇨🇳" servers={domestic} selectedTargets={selectedTargets} onToggleTarget={onToggleTarget} />}
          {global.length > 0 && <ServerGroup label="全球区域" flag="🌍" servers={global} selectedTargets={selectedTargets} onToggleTarget={onToggleTarget} />}
        </>
      )}
    </div>
  )
}

function ServerGroup({ label, flag, servers, selectedTargets, onToggleTarget }: {
  label: string; flag: string; servers: ServerSnapshot[]; selectedTargets: CommandTarget[]; onToggleTarget: (t: CommandTarget) => void
}) {
  return (
    <section className="space-y-2.5">
      <h3 className="flex items-center gap-2 px-0.5 text-sm font-medium text-zinc-400">
        <span>{flag}</span> {label}
        <span className="rounded-full bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-500">{servers.length}</span>
      </h3>
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
        {servers.map((server) => (
          <ServerCard
            key={server.id}
            server={server}
            selected={selectedTargets.some(t => t.id === `server:${server.id}`)}
            onToggle={() => onToggleTarget({ id: `server:${server.id}`, name: server.name, emoji: "🖥️", user_id: "server-proxy-ottor", kind: "server" })}
          />
        ))}
      </div>
    </section>
  )
}

function ServerCard({ server, selected, onToggle }: { server: ServerSnapshot; selected: boolean; onToggle: () => void }) {
  const [expanded, setExpanded] = useState(false)
  const isOC = (server.tags ?? []).includes("openclaw") || server.services.some(s => s.name.toLowerCase().includes("openclaw"))
  const alerts = server.alerts ?? []
  const hasAlerts = alerts.length > 0

  // Sort: errors first
  const sortedSvc = [...(server.services ?? [])].sort((a, b) => {
    if (a.status === b.status) return 0
    return a.status === "running" ? 1 : -1
  })

  const memPct = server.memory_total_mb ? Math.round((server.memory_used_mb / server.memory_total_mb) * 100) : 0
  const diskPct = server.disk_usage_pct ?? 0

  return (
    <div className={cn(
      "relative flex flex-col overflow-hidden rounded-xl border bg-[#111113] transition-all hover:border-zinc-700",
      selected ? "border-emerald-500/50 bg-emerald-500/5 ring-1 ring-emerald-500/20" : "border-zinc-800/80",
      hasAlerts && !selected && "border-rose-500/40 bg-rose-500/5"
    )}>
      {/* OpenClaw watermark */}
      {isOC && <div className="pointer-events-none absolute -right-4 -top-4 rotate-12 opacity-[0.04]"><Shield className="h-28 w-28 text-emerald-500" /></div>}

      {/* Collapsed row */}
      <div className="flex items-center gap-2.5 p-3 cursor-pointer" onClick={() => setExpanded(!expanded)}>
        <div className={cn(
          "relative flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border",
          hasAlerts ? "border-rose-500/30 bg-rose-500/10 text-rose-400" : isOC ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400" : "border-zinc-800 bg-[#18181b] text-zinc-400"
        )}>
          {isOC ? <Shield className="h-4 w-4" /> : <Server className="h-4 w-4" />}
          {!server.ssh_reachable && <span className="absolute -bottom-0.5 -right-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full border border-[#111113] bg-rose-500 text-[8px] font-bold text-white">!</span>}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-sm font-medium text-zinc-100">{server.name}</span>
            <span className="shrink-0 text-[10px] text-zinc-500">{fmtUptime(server.uptime_seconds)}</span>
          </div>
          {/* One-line service tags */}
          <div className="mt-1 flex h-[18px] items-center gap-1 overflow-hidden">
            {sortedSvc.map((svc) => <SvcTag key={svc.name} name={svc.name} status={svc.status} />)}
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <ChevronDown className={cn("h-3.5 w-3.5 text-zinc-500 transition-transform", expanded && "rotate-180")} />
          <button onClick={(e) => { e.stopPropagation(); onToggle() }} className={cn(
            "flex h-5 w-5 items-center justify-center rounded transition",
            selected ? "bg-emerald-500 text-white" : "border border-zinc-700 bg-zinc-800/50 text-zinc-500 hover:bg-zinc-700"
          )}>
            {selected && <Chk className="h-3 w-3" />}
          </button>
        </div>
      </div>

      {/* Expanded */}
      {expanded && (
        <div className="border-t border-zinc-800/60 bg-[#0c0c0e]/50 px-3 py-2.5 space-y-2.5">
          {/* Info row */}
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-zinc-500">
            <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" />{server.region || "—"}</span>
            <span className="inline-flex items-center gap-1"><Globe className="h-3 w-3" />{server.cloud || "—"}</span>
            <span className="inline-flex items-center gap-1"><HardDrive className="h-3 w-3" />{server.ip}</span>
          </div>

          {/* Memory & Disk bars */}
          <div className="grid grid-cols-2 gap-2">
            <MiniBar icon={Cpu} label="内存" value={memPct} detail={`${server.memory_used_mb ?? 0}/${server.memory_total_mb ?? 0} MB`} />
            <MiniBar icon={HardDrive} label="磁盘" value={diskPct} detail={`${server.disk_used_gb ?? 0}/${server.disk_total_gb ?? 0} GB`} />
          </div>

          {/* Alerts */}
          {hasAlerts && (
            <div className="space-y-1 rounded-md bg-rose-500/10 p-2">
              {alerts.map((a, i) => (
                <div key={i} className="flex items-start gap-1.5 text-[10px] text-rose-300">
                  <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                  <span>{a.message}</span>
                </div>
              ))}
            </div>
          )}

          {/* Action */}
          <div className="flex justify-end">
            <button onClick={(e) => { e.stopPropagation(); onToggle() }} className="flex items-center gap-1 text-[10px] text-emerald-400 hover:text-emerald-300">
              <MessageSquare className="h-3 w-3" />{selected ? "取消选中" : "发起对话"}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function MiniBar({ icon: Icon, label, value, detail }: { icon: React.ElementType; label: string; value: number; detail: string }) {
  const tone = value > 85 ? "rose" : value > 60 ? "amber" : "emerald"
  const barColor = tone === "rose" ? "bg-rose-500" : tone === "amber" ? "bg-amber-500" : "bg-emerald-500"
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[10px]">
        <span className="inline-flex items-center gap-1 text-zinc-500"><Icon className="h-3 w-3" />{label}</span>
        <span className="text-zinc-400">{value}%</span>
      </div>
      <div className="h-1 w-full rounded-full bg-zinc-800">
        <div className={cn("h-full rounded-full transition-all", barColor)} style={{ width: `${Math.min(value, 100)}%` }} />
      </div>
      <div className="text-[9px] text-zinc-600">{detail}</div>
    </div>
  )
}

function SvcTag({ name, status }: { name: string; status: string }) {
  const ok = status === "running"
  return (
    <span className={cn(
      "shrink-0 rounded px-1 py-0.5 text-[9px] font-medium border leading-none",
      ok ? "border-emerald-500/20 bg-emerald-500/5 text-emerald-400/80" : "border-rose-500/20 bg-rose-500/5 text-rose-400/80"
    )}>{name}</span>
  )
}

function Chk({ className }: { className?: string }) {
  return <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className={className}><path d="M20 6 9 17l-5-5" /></svg>
}

/* ═══════════════════ Projects Tab ═══════════════════ */

function ProjectsTab({ stats, projects, recentNotes, loading, onCreateProject, onOpenProject }: {
  stats: Stats; projects: Project[]; recentNotes: RecentNotePreview[]; loading: boolean; onCreateProject: () => void; onOpenProject: (slug: string) => void
}) {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        <StatCard label="Total" value={stats.total} tone="zinc" />
        <StatCard label="Active" value={stats.active} tone="emerald" />
        <StatCard label="Done" value={stats.completed} tone="cyan" />
        <StatCard label="Tasks" value={`${stats.tasksDone}/${stats.tasks}`} tone="amber" />
      </div>
      <div className="flex flex-col gap-5 xl:flex-row">
        <div className="flex-1 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-zinc-100">全部项目</h3>
            <button onClick={onCreateProject} className="inline-flex items-center gap-1 rounded-lg border border-zinc-700 bg-[#18181b] px-2.5 py-1 text-xs font-medium text-zinc-300 hover:border-emerald-500/40 hover:text-emerald-300">
              <Plus className="h-3 w-3" />新建
            </button>
          </div>
          {loading && projects.length === 0 ? <EmptyRow text="加载中..." /> : projects.length === 0 ? <EmptyRow text="暂无项目" /> : (
            <div className="space-y-2.5">
              {projects.map((p) => <ProjectCard key={p.id} project={p} onClick={() => onOpenProject(p.slug)} />)}
            </div>
          )}
        </div>
        <div className="xl:w-72 shrink-0">
          <Card className="border-zinc-800/80 bg-[#111113] shadow-none">
            <CardHeader className="pb-2 pt-4 px-4"><CardTitle className="text-xs font-medium text-zinc-400">最近笔记</CardTitle></CardHeader>
            <CardContent className="px-0 pb-1">
              {recentNotes.length === 0 ? <div className="px-4 pb-3 text-xs text-zinc-500">暂无笔记</div> : (
                <div className="divide-y divide-zinc-800/40">
                  {recentNotes.map((n) => (
                    <div key={n.id} className="px-4 py-2.5 hover:bg-zinc-800/20">
                      <p className="line-clamp-2 text-[11px] leading-4 text-zinc-300">{n.content}</p>
                      <div className="mt-1 flex items-center justify-between text-[9px] text-zinc-500">
                        <span>{n.projectName}</span>
                        <span>{sharedFormatDateTime(n.created_at, "date")}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}

function ProjectCard({ project, onClick }: { project: Project; onClick: () => void }) {
  const stage = STAGES.find((s) => s.id === project.stage) || STAGES[0]
  const progress = getProjectProgress(project)
  return (
    <div onClick={onClick} className="group flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-zinc-800/80 bg-[#18181b] p-3.5 transition hover:border-zinc-700">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-semibold text-zinc-100 group-hover:text-emerald-300 transition-colors">{project.name}</span>
          <StatusBadge status={project.status} />
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-[11px] text-zinc-500">
          <span>{stage.icon} {stage.label}</span>
          <span>·</span>
          <span>{project.task_count ?? 0} 任务</span>
        </div>
      </div>
      <div className="w-12 shrink-0 text-right text-sm font-medium text-zinc-300">{progress}%</div>
    </div>
  )
}

/* ═══════════════════ Shared ═══════════════════ */

function EmptyRow({ text }: { text: string }) {
  return <div className="rounded-xl border border-dashed border-zinc-800/80 bg-[#111113] px-4 py-6 text-center text-sm text-zinc-500">{text}</div>
}

function fmtDateTime(v?: string | null) {
  if (!v) return "—"
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return "—"
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(d)
}

function fmtUptime(sec?: number) {
  const s = Math.max(0, Math.floor(sec ?? 0))
  const d = Math.floor(s / 86400)
  if (d > 0) return `${d}d`
  const h = Math.floor((s % 86400) / 3600)
  if (h > 0) return `${h}h`
  return `${Math.floor((s % 3600) / 60)}m`
}
