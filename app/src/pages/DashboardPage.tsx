import { useEffect, useMemo, useState } from "react"
import {
  AlertTriangle,
  Box,
  ChevronDown,
  Cpu,
  FileText,
  FlaskConical,
  Globe,
  HardDrive,
  History,
  MapPin,
  MessageSquare,
  Monitor,
  RefreshCw,
  ScrollText,
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
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"

import { EmptyState } from "@/components/portal/shared"
import { fetchDailyReports, type CronJob, type DailyReport, type DashboardAgent, type DashboardData, type Project, type ServerSnapshot, type Stats } from "@/lib/api"
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
            onOpenProject={onOpenProject}
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

function BotFleetTab({ dashboard, loading, selectedTargets, onToggleTarget, onOpenProject }: {
  dashboard: DashboardData; loading: boolean; selectedTargets: CommandTarget[]; onToggleTarget: (t: CommandTarget) => void; onOpenProject: (slug: string) => void
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
              onOpenProject={onOpenProject}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function BotCard({ agent, selected, onToggle, onOpenProject }: { agent: DashboardAgent; selected: boolean; onToggle: () => void; onOpenProject: (slug: string) => void }) {
  const [expanded, setExpanded] = useState(false)
  const [cronOpen, setCronOpen] = useState(false)
  
  const prod = agent.production
  const dev = agent.dev
  const container = agent.container
  const crons = agent.crons
  const canMessage = !!agent.mm_user_id
  const tasks = agent.tasks
  const hasProject = !!agent.project

  return (
    <>
      <div className={cn(
        "group relative flex flex-col gap-2.5 rounded-xl border bg-[#111113] transition-all hover:border-zinc-700",
        selected ? "border-emerald-500/50 bg-emerald-500/5 ring-1 ring-emerald-500/20" : "border-zinc-800/80"
      )}>
        {/* Layer 1: Summary - Click to toggle expansion */}
        <div 
          className="flex items-start justify-between gap-2 p-3.5 cursor-pointer"
          onClick={() => setExpanded(!expanded)}
        >
          <div className="flex items-center gap-2.5">
            <div className={cn(
              "flex h-9 w-9 items-center justify-center rounded-lg border transition-colors",
              selected ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" : "border-zinc-800 bg-[#18181b] text-zinc-400 group-hover:border-zinc-700 group-hover:text-zinc-300"
            )}>
              <Workflow className="h-4.5 w-4.5" />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-semibold text-zinc-100">{agent.name}</span>
                {agent.role === "coordination" && (
                  <Badge variant="outline" className="border-zinc-700 bg-zinc-800/50 px-1 py-0 text-[10px] text-zinc-400">协调</Badge>
                )}
              </div>
              <div className="flex items-center gap-2 text-[11px] text-zinc-500">
                <span>@{agent.id}</span>
                {tasks && (
                  <>
                    <span>·</span>
                    <span className={cn(tasks.pending > 0 ? "text-amber-400" : "text-zinc-500")}>
                      {tasks.done}/{tasks.total} tasks
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
             {/* Env Status Icons (Collapsed) */}
             <div className="mr-1 flex items-center gap-2">
               {prod && (
                 <a
                   href={prod.url}
                   target="_blank"
                   rel="noreferrer"
                   onClick={(e) => e.stopPropagation()}
                   className={cn("flex h-8 w-8 items-center justify-center rounded-lg border bg-[#18181b] transition-all hover:scale-105 hover:bg-zinc-800",
                     prod.status === 200 ? "border-emerald-500/20 text-emerald-400" : "border-rose-500/20 text-rose-400"
                   )} 
                   title="Production Environment"
                 >
                   <Globe className="h-4 w-4" />
                 </a>
               )}
               {dev && (
                 <a
                   href={dev.url}
                   target="_blank"
                   rel="noreferrer"
                   onClick={(e) => e.stopPropagation()}
                   className={cn("flex h-8 w-8 items-center justify-center rounded-lg border bg-[#18181b] transition-all hover:scale-105 hover:bg-zinc-800",
                     dev.status === 200 ? "border-emerald-500/20 text-emerald-400" : "border-rose-500/20 text-rose-400"
                   )} 
                   title="Development Environment"
                 >
                   <Monitor className="h-4 w-4" />
                 </a>
               )}
             </div>

             <ChevronDown className={cn("h-4 w-4 text-zinc-500 transition-transform duration-200", expanded && "rotate-180")} />
             {canMessage && (
               <button onClick={(e) => { e.stopPropagation(); onToggle() }} className={cn(
                 "ml-1 rounded-lg p-1.5 transition",
                 selected ? "bg-emerald-500 text-white shadow-sm" : "text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
               )}>
                 {selected ? <X className="h-3.5 w-3.5" /> : <MessageSquare className="h-3.5 w-3.5" />}
               </button>
             )}
          </div>
        </div>

        {/* Layer 2: Expanded Details */}
        {expanded && (
          <div className="border-t border-zinc-800/50 bg-[#0c0c0e]/30 px-3.5 py-3 space-y-3 animate-in slide-in-from-top-1 duration-200">
            {/* Status Grid */}
            <div className="grid grid-cols-2 gap-2 text-xs">
              <EnvCell icon={Globe} label="生产" status={prod} />
              <EnvCell icon={Monitor} label="开发" status={dev} />
              {container && (
                <div className="col-span-2 flex items-center gap-2 rounded-md bg-[#18181b] px-2.5 py-2 border border-zinc-800/50">
                  <Box className="h-3.5 w-3.5 text-zinc-500" />
                  <span className="text-[11px] text-zinc-500">容器状态</span>
                  <div className="ml-auto flex items-center gap-1.5">
                    <span className={cn("h-1.5 w-1.5 rounded-full", container.status === "running" ? "bg-emerald-500" : "bg-rose-500")} />
                    <span className={cn("text-[11px] font-medium", container.status === "running" ? "text-emerald-400" : "text-rose-400")}>
                      {container.status}
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* Cron Jobs */}
            {crons && crons.total > 0 && (
              <div className="rounded-md border border-zinc-800/50 bg-[#18181b]">
                <button
                  onClick={() => setCronOpen(!cronOpen)}
                  className="flex w-full items-center gap-2 px-2.5 py-2 text-xs transition hover:bg-zinc-800/50"
                >
                  <Timer className="h-3.5 w-3.5 text-zinc-500" />
                  <span className="text-zinc-400">定时任务</span>
                  <span className={cn("ml-auto font-medium", crons.error > 0 ? "text-rose-400" : "text-emerald-400")}>
                    {crons.ok} ok / {crons.error} err
                  </span>
                  <ChevronDown className={cn("h-3 w-3 text-zinc-500 transition-transform", cronOpen && "rotate-180")} />
                </button>
                {cronOpen && (
                  <div className="border-t border-zinc-800/50 px-2.5 py-2 space-y-1.5">
                    {crons.jobs?.map((job: any) => (
                      <div key={job.name} className="flex items-center justify-between text-[10px]">
                        <span className="text-zinc-400 truncate mr-2 font-mono">{job.name}</span>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-zinc-600">{job.schedule}</span>
                          <span className={cn("rounded px-1.5 py-0.5 font-medium",
                            job.lastStatus === "ok" ? "bg-emerald-500/10 text-emerald-400" : "bg-rose-500/10 text-rose-400"
                          )}>
                            {job.lastStatus}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            
            {/* Project Progress Bar */}
            {tasks && (
              <div className="space-y-1.5 pt-1">
                <div className="flex items-center justify-between text-[10px]">
                  <span className="text-zinc-500">当前迭代进度</span>
                  <span className="text-zinc-400">{Math.round((tasks.done / tasks.total) * 100)}%</span>
                </div>
                <div className="h-1 w-full rounded-full bg-zinc-800 overflow-hidden">
                  <div 
                    className="h-full bg-emerald-500/80 transition-all duration-500 ease-out" 
                    style={{ width: `${(tasks.done / tasks.total) * 100}%` }} 
                  />
                </div>
              </div>
            )}

            <DailyReportsSection agentId={agent.id} />

            {/* Actions */}
            <div className="flex gap-2 pt-1">
               {hasProject ? (
                 <button 
                   onClick={() => agent.project && onOpenProject(agent.project)}
                   className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 py-1.5 text-xs font-medium text-zinc-200 transition-colors"
                 >
                   <FlaskConical className="h-3.5 w-3.5" />
                   详情
                 </button>
               ) : (
                 <div className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg border border-zinc-800 bg-transparent py-1.5 text-xs text-zinc-500 cursor-not-allowed">
                   <FlaskConical className="h-3.5 w-3.5" />
                   无项目
                 </div>
               )}
               
               {canMessage && (
                 <button 
                   onClick={(e) => { e.stopPropagation(); onToggle() }}
                   className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg border border-zinc-700 hover:bg-zinc-800 py-1.5 text-xs font-medium text-zinc-300 transition-colors"
                 >
                   <MessageSquare className="h-3.5 w-3.5" />
                   对话
                 </button>
               )}
            </div>
          </div>
        )}
      </div>

    </>
  )
}

function DailyReportsSection({ agentId }: { agentId: string }) {
  const [reports, setReports] = useState<DailyReport[]>([])
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [openReport, setOpenReport] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    const loadReports = async () => {
      setLoading(true)
      try {
        const nextReports = await fetchDailyReports(10, 0, agentId)
        if (cancelled) return
        const safeReports = nextReports ?? []
        setReports(safeReports)
        setOpenReport((current) => current ?? safeReports[0]?.date ?? null)
      } catch {
        if (!cancelled) {
          setReports([])
          setOpenReport(null)
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
          setLoaded(true)
        }
      }
    }

    void loadReports()

    return () => {
      cancelled = true
    }
  }, [agentId])

  const handleToggleReport = (date: string) => {
    setOpenReport((current) => (current === date ? null : date))
  }

  return (
    <div className="rounded-md border border-zinc-800/50 bg-[#18181b]">
      <div className="flex items-center justify-between gap-2 px-2.5 py-2 text-xs">
        <div className="inline-flex items-center gap-2 text-zinc-400">
          <ScrollText className="h-3.5 w-3.5 text-zinc-500" />
          <span>日报</span>
        </div>
        <span className="text-[10px] text-zinc-600">最近 10 条</span>
      </div>

      <div className="border-t border-zinc-800/50 px-2.5 py-2">
        {loading && !loaded ? (
          <div className="rounded-md bg-[#111113] px-3 py-4 text-xs text-zinc-500">加载中...</div>
        ) : reports.length === 0 ? (
          <EmptyState
            compact
            icon={<FileText className="h-4 w-4" />}
            title="暂无日报"
            message="这个 bot 还没有可展示的日报。"
          />
        ) : (
          <div className="space-y-1.5">
            {reports.map((report, index) => {
              const expanded = openReport === report.date
              const isLast = index === reports.length - 1

              return (
                <div key={report.id} className="relative pl-5">
                  {!isLast && (
                    <div className="absolute left-[7px] top-4 bottom-0 w-px bg-zinc-600/35" aria-hidden="true" />
                  )}

                  <button
                    type="button"
                    onClick={() => handleToggleReport(report.date)}
                    className="group relative flex w-full items-start justify-between gap-3 rounded-md px-0 py-1 text-left transition-colors hover:bg-zinc-900/20"
                  >
                    <span
                      className={cn(
                        "absolute left-[-20px] top-2.5 h-3 w-3 rounded-full border transition-colors",
                        expanded
                          ? "border-emerald-400/80 bg-emerald-400 shadow-[0_0_0_2px_rgba(16,185,129,0.12)]"
                          : "border-zinc-500/70 bg-[#18181b] group-hover:border-zinc-400/80"
                      )}
                      aria-hidden="true"
                    />

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 text-xs">
                        <span className="truncate text-xs font-medium text-zinc-300">{report.date}</span>
                        <span className="text-[10px] text-zinc-600">{expanded ? "收起" : "展开"}</span>
                      </div>
                    </div>
                  </button>

                  {expanded && (
                    <div className="pb-2 pt-1">
                      <div className="rounded-md border border-zinc-800/60 bg-[#111113] px-3 py-2.5">
                        <div className="prose prose-invert prose-sm max-w-none text-sm prose-headings:mb-2 prose-headings:text-zinc-100 prose-headings:text-sm prose-p:my-2 prose-p:text-zinc-300 prose-p:leading-6 prose-a:text-cyan-300 prose-strong:text-zinc-100 prose-code:rounded prose-code:bg-zinc-800/50 prose-code:px-1 prose-code:py-0.5 prose-code:text-emerald-300 prose-pre:border prose-pre:border-zinc-800/60 prose-pre:bg-[#09090b] prose-pre:p-3 prose-li:my-0.5 prose-li:text-zinc-300 prose-th:text-zinc-200 prose-td:text-zinc-300 prose-hr:border-zinc-800 [&_*]:break-words [&_ul]:my-2 [&_ol]:my-2 [&_li>p]:my-0.5">
                          <MarkdownBlock content={report.content} />
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function MarkdownBlock({ content }: { content: string }) {
  return <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
}

function EnvCell({ icon: Icon, label, status }: {
  icon: React.ElementType; label: string; status: { url?: string; status?: number } | null | undefined
}) {
  return (
    <div className="flex items-center gap-2 rounded-md bg-[#18181b] px-2.5 py-2 border border-zinc-800/50">
      <Icon className="h-3.5 w-3.5 text-zinc-500" />
      <span className="text-[11px] text-zinc-500">{label}</span>
      {status ? (
        <a
          href={status.url}
          target="_blank"
          rel="noreferrer"
          className={cn("ml-auto text-[11px] font-medium hover:underline",
            status.status === 200 ? "text-emerald-400" : "text-rose-400"
          )}
        >
          {status.status === 200 ? "正常" : "异常"}
        </a>
      ) : (
        <span className="ml-auto text-[11px] text-zinc-600">无</span>
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

function getLocalTimelineDotClassName(eventType: string) {
  switch (eventType) {
    case "stage_change": return "bg-emerald-400"
    case "status_change": return "bg-cyan-400"
    case "task_done": return "bg-emerald-400"
    case "artifact_added": return "bg-amber-400"
    case "note_added": return "bg-violet-400"
    case "workspace_sync": return "bg-sky-400"
    default: return "bg-zinc-500"
  }
}
