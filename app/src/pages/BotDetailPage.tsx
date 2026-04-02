import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  ArrowLeft,
  Briefcase,
  CheckCircle2,
  Clock,
  FileText,
  Filter,
  Loader2,
  Package,
  ScrollText,
  XCircle,
} from "lucide-react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"

import {
  fetchDailyActivities,
  fetchDailyReports,
  fetchDailyTimeline,
  fetchAPProjects,
  type APProject,
  type DailyActivity,
  type DailyTimelineEvent,
  type DailyReport,
  type DashboardAgent,
} from "@/lib/api"
import { cn } from "@/lib/utils"
import type { BotSummary } from "@/pages/DashboardPage"

/* ─── Constants ─── */
const PAGE_SIZE = 40

const ACTION_CFG: Record<string, { icon: string; label: string; color: string }> = {
  completed:          { icon: "✅", label: "完成",   color: "text-emerald-400" },
  in_progress:        { icon: "⏳", label: "进行中", color: "text-amber-400" },
  dropped:            { icon: "❌", label: "已放弃", color: "text-rose-400" },
  promise_no_result:  { icon: "⚠️", label: "未交付", color: "text-amber-400" },
  no_response:        { icon: "🔇", label: "未响应", color: "text-zinc-500" },
  request:            { icon: "📨", label: "请求",   color: "text-sky-400" },
  response:           { icon: "💬", label: "回复",   color: "text-sky-400" },
}

const STATUS_FILTERS = [
  { key: "all",         label: "全部",   icon: null },
  { key: "completed",   label: "完成",   icon: "✅" },
  { key: "in_progress", label: "进行中", icon: "⏳" },
  { key: "dropped",     label: "放弃",   icon: "❌" },
]

/* ─── Smart deliverable display ─── */
function DeliverableItem({ value, className }: { value: string; className?: string }) {
  const trimmed = value.trim()
  if (/^https?:\/\//.test(trimmed)) {
    return (
      <a
        href={trimmed}
        target="_blank"
        rel="noopener noreferrer"
        className={cn(
          "inline-flex items-center gap-1 rounded bg-sky-500/10 border border-sky-500/20 px-1.5 py-0.5 text-[10px] text-sky-300 font-mono hover:bg-sky-500/20 transition-colors cursor-pointer",
          className
        )}
      >
        🔗 {trimmed.length > 60 ? trimmed.slice(0, 57) + "…" : trimmed}
      </a>
    )
  }
  if (/^\//.test(trimmed)) {
    return (
      <span className={cn(
        "inline-flex items-center gap-1 rounded bg-violet-500/10 border border-violet-500/20 px-1.5 py-0.5 text-[10px] text-violet-300 font-mono",
        className
      )}>
        📁 {trimmed}
      </span>
    )
  }
  return (
    <span className={cn(
      "inline-flex items-center gap-1 rounded bg-emerald-500/10 border border-emerald-500/20 px-1.5 py-0.5 text-[10px] text-emerald-300 font-mono",
      className
    )}>
      📄 {trimmed}
    </span>
  )
}

/* ─── Helper: unique deliverables from activities ─── */
function extractDeliverables(activities: DailyActivity[]): string[] {
  const set = new Set<string>()
  for (const a of activities) {
    if (a.detail?.deliverables) {
      for (const d of a.detail.deliverables) {
        if (d.trim()) set.add(d.trim())
      }
    }
  }
  return [...set]
}

/* ─── Infinite scroll hook ─── */
function useInfiniteLoad<T>(
  fetcher: (limit: number, offset: number) => Promise<T[]>,
  pageSize: number,
) {
  const [items, setItems] = useState<T[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const offsetRef = useRef(0)
  const sentinelRef = useRef<HTMLDivElement>(null)

  const loadInitial = useCallback(async () => {
    setLoading(true)
    offsetRef.current = 0
    try {
      const data = await fetcher(pageSize, 0)
      setItems(data)
      setHasMore(data.length >= pageSize)
      offsetRef.current = data.length
    } catch {
      setItems([])
      setHasMore(false)
    } finally {
      setLoading(false)
    }
  }, [fetcher, pageSize])

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore) return
    setLoadingMore(true)
    try {
      const data = await fetcher(pageSize, offsetRef.current)
      setItems(prev => [...prev, ...data])
      setHasMore(data.length >= pageSize)
      offsetRef.current += data.length
    } catch {
      setHasMore(false)
    } finally {
      setLoadingMore(false)
    }
  }, [fetcher, pageSize, loadingMore, hasMore])

  // IntersectionObserver on sentinel
  useEffect(() => {
    const el = sentinelRef.current
    if (!el) return
    const obs = new IntersectionObserver(
      entries => { if (entries[0]?.isIntersecting) loadMore() },
      { rootMargin: "200px" }
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [loadMore])

  useEffect(() => { void loadInitial() }, [loadInitial])

  return { items, loading, loadingMore, hasMore, sentinelRef }
}

/* ═══════════════════ BotDetailPage ═══════════════════ */

interface BotDetailPageProps {
  agent: DashboardAgent | null
  agentId: string
  botSummary?: BotSummary
  onBack: () => void
  mmUsername: string
  isVirtual?: boolean
  virtualEmoji?: string
  initialDate?: string
  onOpenProject?: (projectId: string) => void
}

export function BotDetailPage({ agent, agentId, botSummary, onBack, mmUsername, isVirtual, virtualEmoji, initialDate, onOpenProject }: BotDetailPageProps) {
  const [reports, setReports] = useState<DailyReport[]>([])
  const [reportsLoading, setReportsLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState("all")
  const [activeSection, setActiveSection] = useState<string>("tasks")
  const [botProjects, setBotProjects] = useState<APProject[]>([])
  const [projectsLoading, setProjectsLoading] = useState(true)

  const agentName = agent?.name ?? mmUsername
  const emoji = virtualEmoji ?? agent?.emoji ?? "🤖"

  // Infinite-scroll loaders (no date filter — all activities across all days)
  const actFetcher = useCallback(
    (limit: number, offset: number) => fetchDailyActivities(agentId, undefined, limit, offset),
    [agentId]
  )
  const tlFetcher = useCallback(
    (limit: number, offset: number) => fetchDailyTimeline(agentId, undefined, limit, offset),
    [agentId]
  )

  const {
    items: activities,
    loading: activitiesLoading,
    loadingMore: activitiesLoadingMore,
    hasMore: activitiesHasMore,
    sentinelRef: activitiesSentinel,
  } = useInfiniteLoad(actFetcher, PAGE_SIZE)

  const {
    items: timelineEvents,
    loading: timelineLoading,
    loadingMore: timelineLoadingMore,
    hasMore: timelineHasMore,
    sentinelRef: timelineSentinel,
  } = useInfiniteLoad(tlFetcher, PAGE_SIZE)

  // Load reports
  useEffect(() => {
    setReportsLoading(true)
    fetchDailyReports(10, 0, agentId)
      .then(r => setReports(r ?? []))
      .catch(() => setReports([]))
      .finally(() => setReportsLoading(false))
  }, [agentId])

  // Load projects
  useEffect(() => {
    setProjectsLoading(true)
    fetchAPProjects({ bot: agentId })
      .then(p => setBotProjects(p ?? []))
      .catch(() => setBotProjects([]))
      .finally(() => setProjectsLoading(false))
  }, [agentId])

  // Derived
  const filteredActivities = useMemo(() => {
    return statusFilter === "all" ? activities : activities.filter(a => a.action === statusFilter)
  }, [activities, statusFilter])

  const deliverables = useMemo(() => extractDeliverables(activities), [activities])

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const a of activities) {
      counts[a.action] = (counts[a.action] ?? 0) + 1
    }
    return counts
  }, [activities])

  if (!agent && !agentId) return null

  const sections = [
    { key: "tasks", label: "任务列表", icon: CheckCircle2, count: activities.length },
    { key: "deliverables", label: "产出列表", icon: Package, count: deliverables.length },
    { key: "projects", label: "参与项目", icon: Briefcase, count: botProjects.length },
    { key: "timeline", label: "时间线", icon: Clock, count: timelineEvents.length },
    { key: "reports", label: "日报摘要", icon: ScrollText, count: reports.length },
  ]

  return (
    <main className="flex min-h-screen w-full flex-col px-4 py-5 pb-32 pb-safe-lg sm:px-6 sm:py-6 lg:px-8 lg:py-8">
      {/* ── Header ── */}
      <header className="mb-5">
        <button
          onClick={onBack}
          className="mb-3 inline-flex items-center gap-1.5 text-sm text-zinc-400 hover:text-zinc-200 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          返回
        </button>
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-zinc-800 bg-[#18181b] text-2xl">
            {emoji}
          </div>
          <div>
            <h1 className="text-xl font-semibold text-zinc-100 sm:text-2xl">{agentName}</h1>
            <div className="flex items-center gap-3 mt-0.5 text-xs text-zinc-500">
              <span>@{mmUsername}</span>
              {botSummary && (
                <>
                  <span className="text-sky-400">{botSummary.messages} msg</span>
                  {botSummary.things > 0 && <span className="text-emerald-400">📋{botSummary.things} 事项</span>}
                </>
              )}
            </div>
            {botSummary?.one_liner && (
              <p className="mt-1 text-sm text-zinc-400">{botSummary.one_liner}</p>
            )}
          </div>
        </div>
      </header>

      {/* ── Section Nav (no date selector) ── */}
      <div className="mb-4 flex gap-1 overflow-x-auto border-b border-zinc-800/60 pb-px">
        {sections.map(s => (
          <button
            key={s.key}
            onClick={() => setActiveSection(s.key)}
            className={cn(
              "flex items-center gap-1.5 rounded-t-lg px-3 py-2 text-xs font-medium transition-colors whitespace-nowrap",
              activeSection === s.key
                ? "bg-zinc-800/60 text-zinc-100 border-b-2 border-emerald-500"
                : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/30"
            )}
          >
            <s.icon className="h-3.5 w-3.5" />
            {s.label}
            <span className={cn(
              "ml-1 rounded-full px-1.5 py-0.5 text-[10px] tabular-nums",
              activeSection === s.key ? "bg-emerald-500/20 text-emerald-300" : "bg-zinc-800 text-zinc-500"
            )}>
              {s.count}
            </span>
          </button>
        ))}
      </div>

      {/* ── Loading ── */}
      {activitiesLoading && (activeSection === "tasks" || activeSection === "deliverables") && (
        <div className="flex items-center justify-center py-12 text-zinc-500">
          <Loader2 className="h-5 w-5 animate-spin mr-2" />
          加载中...
        </div>
      )}

      {/* ── Section: Tasks ── */}
      {activeSection === "tasks" && !activitiesLoading && (
        <div className="space-y-3">
          {/* Status filter */}
          <div className="flex gap-1.5 flex-wrap">
            {STATUS_FILTERS.map(f => (
              <button
                key={f.key}
                onClick={() => setStatusFilter(f.key)}
                className={cn(
                  "rounded-full px-2.5 py-1 text-[11px] font-medium border transition-colors",
                  statusFilter === f.key
                    ? "bg-zinc-700 text-zinc-200 border-zinc-600"
                    : "bg-transparent text-zinc-500 border-zinc-800 hover:border-zinc-700"
                )}
              >
                {f.icon && <span className="mr-1">{f.icon}</span>}
                {f.label}
                {f.key !== "all" && statusCounts[f.key] ? (
                  <span className="ml-1 text-[10px] opacity-60">{statusCounts[f.key]}</span>
                ) : null}
              </button>
            ))}
          </div>

          {filteredActivities.length === 0 ? (
            <div className="rounded-xl border border-zinc-800/60 bg-[#111113] px-4 py-8 text-center text-xs text-zinc-500">
              <Filter className="h-5 w-5 mx-auto mb-2 opacity-50" />
              暂无{statusFilter === "all" ? "" : STATUS_FILTERS.find(f => f.key === statusFilter)?.label}任务
            </div>
          ) : (
            <div className="space-y-1.5">
              {filteredActivities.map(act => {
                const cfg = ACTION_CFG[act.action] ?? { icon: "•", label: act.action, color: "text-zinc-400" }
                const hasDeliverables = act.detail?.deliverables && act.detail.deliverables.length > 0
                return (
                  <div
                    key={act.id}
                    className={cn(
                      "rounded-lg border bg-[#111113] px-3 py-2.5 transition-colors",
                      hasDeliverables ? "border-emerald-500/15 bg-emerald-500/[0.02]" : "border-zinc-800/60"
                    )}
                  >
                    <div className="flex items-start gap-2">
                      <span className="text-sm mt-0.5 shrink-0">{cfg.icon}</span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          {act.date && (
                            <span className="text-[10px] font-mono text-zinc-600 tabular-nums">{act.date}</span>
                          )}
                          {act.time && (
                            <span className="text-[10px] font-mono text-zinc-500 tabular-nums">{act.time}</span>
                          )}
                          <span className={cn("text-[10px] font-semibold uppercase", cfg.color)}>{cfg.label}</span>
                        </div>
                        <div className="text-xs text-zinc-200 mt-0.5 leading-relaxed">{act.content}</div>
                        {hasDeliverables && (
                          <div className="flex flex-wrap gap-1 mt-1.5">
                            {act.detail!.deliverables!.map((d, i) => (
                              <DeliverableItem key={i} value={d} />
                            ))}
                          </div>
                        )}
                        {act.detail?.references && act.detail.references.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1">
                            {act.detail.references.map((r, i) => (
                              <code key={i} className="rounded bg-zinc-800/60 px-1.5 py-0.5 text-[9px] text-zinc-400 font-mono">
                                {r}
                              </code>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
              {/* Scroll sentinel */}
              <div ref={activitiesSentinel} className="h-1" />
              {activitiesLoadingMore && (
                <div className="flex items-center justify-center py-4 text-zinc-500 text-xs">
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  加载更多...
                </div>
              )}
              {!activitiesHasMore && activities.length > PAGE_SIZE && (
                <div className="text-center py-3 text-[11px] text-zinc-600">已加载全部</div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Section: Deliverables ── */}
      {activeSection === "deliverables" && !activitiesLoading && (
        <div className="space-y-2">
          {deliverables.length === 0 ? (
            <div className="rounded-xl border border-zinc-800/60 bg-[#111113] px-4 py-8 text-center text-xs text-zinc-500">
              <Package className="h-5 w-5 mx-auto mb-2 opacity-50" />
              暂无产出
            </div>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {deliverables.map((d, i) => {
                const isUrl = /^https?:\/\//.test(d.trim())
                const isPath = /^\//.test(d.trim())
                return (
                  <div
                    key={i}
                    className={cn(
                      "flex items-center gap-2.5 rounded-lg border px-3 py-2.5",
                      isUrl ? "border-sky-500/15 bg-sky-500/[0.03]" :
                      isPath ? "border-violet-500/15 bg-violet-500/[0.03]" :
                      "border-emerald-500/15 bg-emerald-500/[0.03]"
                    )}
                  >
                    <Package className={cn("h-4 w-4 shrink-0", isUrl ? "text-sky-400" : isPath ? "text-violet-400" : "text-emerald-400")} />
                    {isUrl ? (
                      <a href={d.trim()} target="_blank" rel="noopener noreferrer" className="text-xs text-sky-300 font-medium hover:underline truncate">
                        {d.trim()}
                      </a>
                    ) : isPath ? (
                      <code className="text-xs text-violet-300 font-mono truncate">{d.trim()}</code>
                    ) : (
                      <span className="text-xs text-zinc-200 font-medium">{d}</span>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Section: Projects ── */}
      {activeSection === "projects" && (
        <div className="space-y-2">
          {projectsLoading ? (
            <div className="flex items-center justify-center py-12 text-zinc-500">
              <Loader2 className="h-5 w-5 animate-spin mr-2" />
              加载中...
            </div>
          ) : botProjects.length === 0 ? (
            <div className="rounded-xl border border-zinc-800/60 bg-[#111113] px-4 py-8 text-center text-xs text-zinc-500">
              <Briefcase className="h-5 w-5 mx-auto mb-2 opacity-50" />
              暂无关联项目
            </div>
          ) : (
            <div className="space-y-2">
              {botProjects.map(proj => {
                const STATUS_COLORS: Record<string, string> = {
                  active: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
                  blocked: "bg-rose-500/15 text-rose-300 border-rose-500/30",
                  discovering: "bg-sky-500/15 text-sky-300 border-sky-500/30",
                  dormant: "bg-zinc-500/15 text-zinc-400 border-zinc-600/30",
                  done: "bg-violet-500/15 text-violet-300 border-violet-500/30",
                }
                const STATUS_LABELS: Record<string, string> = {
                  active: "活跃", blocked: "受阻", discovering: "探索中", dormant: "休眠", done: "完成",
                }
                const isPrimary = proj.primary_bot === agentId
                return (
                  <button
                    key={proj.id}
                    onClick={() => onOpenProject?.(proj.id)}
                    className="w-full text-left rounded-xl border border-zinc-800/60 bg-[#111113] px-4 py-3 hover:border-zinc-700 hover:bg-zinc-800/30 transition-colors group"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium text-zinc-100 group-hover:text-white transition-colors">
                            {proj.emoji ?? "📂"} {proj.name}
                          </span>
                          {isPrimary && (
                            <span className="rounded-full bg-amber-500/15 border border-amber-500/30 px-1.5 py-0.5 text-[10px] text-amber-300 font-medium">
                              主负责
                            </span>
                          )}
                        </div>
                        {proj.description && (
                          <p className="mt-1 text-xs text-zinc-500 line-clamp-2">{proj.description}</p>
                        )}
                        <div className="mt-2 flex items-center gap-3 flex-wrap text-[10px] text-zinc-500">
                          {proj.milestones.length > 0 && (
                            <span>🏁 {proj.milestones.length} 里程碑</span>
                          )}
                          {proj.deliverables.length > 0 && (
                            <span>📦 {proj.deliverables.length} 产出</span>
                          )}
                          {proj.involved_bots.length > 0 && (
                            <span>🤖 {proj.involved_bots.length} bots</span>
                          )}
                          {proj.last_active && (
                            <span>📅 {proj.last_active}</span>
                          )}
                        </div>
                      </div>
                      <span className={cn(
                        "shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium",
                        STATUS_COLORS[proj.status] ?? "bg-zinc-800 text-zinc-400 border-zinc-700"
                      )}>
                        {STATUS_LABELS[proj.status] ?? proj.status}
                      </span>
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Section: Timeline ── */}
      {activeSection === "timeline" && !timelineLoading && (
        <div className="rounded-xl border border-zinc-800/60 bg-[#111113] overflow-hidden">
          {timelineEvents.length === 0 ? (
            <div className="px-4 py-8 text-center text-xs text-zinc-500">
              <Clock className="h-5 w-5 mx-auto mb-2 opacity-50" />
              暂无事件
            </div>
          ) : (
            <div className="px-4 py-3 space-y-0">
              {timelineEvents.map((evt, i) => {
                const cfg = ACTION_CFG[evt.action] ?? { icon: "•", label: evt.action, color: "text-zinc-400" }
                const isLast = i === timelineEvents.length - 1
                const hasDeliverables = Array.isArray(evt.deliverables) && evt.deliverables.length > 0
                return (
                  <div key={evt.id} className="relative pl-7 pb-3">
                    {!isLast && (
                      <div className="absolute left-[11px] top-5 bottom-0 w-px bg-zinc-700/40" />
                    )}
                    <div className={cn(
                      "absolute left-[5px] top-[7px] h-3.5 w-3.5 rounded-full border-2",
                      evt.action === "completed"
                        ? "border-emerald-500 bg-emerald-500/30"
                        : evt.action === "in_progress"
                        ? "border-amber-500 bg-amber-500/30"
                        : evt.action === "dropped"
                        ? "border-rose-500 bg-rose-500/30"
                        : "border-zinc-600 bg-zinc-800"
                    )} />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        {evt.date && (
                          <span className="text-[10px] font-mono text-zinc-600 tabular-nums">{evt.date}</span>
                        )}
                        <span className="text-[10px] font-mono text-zinc-500 tabular-nums">{evt.time ?? "--:--"}</span>
                        <span className="text-sm">{cfg.icon}</span>
                        <span className={cn("text-[10px] font-medium uppercase", cfg.color)}>{cfg.label}</span>
                        {evt.who && (
                          <span className="text-[10px] text-zinc-500">by {evt.who}</span>
                        )}
                      </div>
                      <div className="text-xs text-zinc-200 mt-0.5 leading-relaxed">{evt.content}</div>
                      {hasDeliverables && (
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          {evt.deliverables.map((d, di) => (
                            <DeliverableItem key={di} value={d} />
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
              {/* Scroll sentinel */}
              <div ref={timelineSentinel} className="h-1" />
              {timelineLoadingMore && (
                <div className="flex items-center justify-center py-4 text-zinc-500 text-xs">
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  加载更多...
                </div>
              )}
              {!timelineHasMore && timelineEvents.length > PAGE_SIZE && (
                <div className="text-center py-3 text-[11px] text-zinc-600">已加载全部</div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Section: Daily Reports ── */}
      {activeSection === "reports" && (
        <div className="space-y-2">
          {reportsLoading ? (
            <div className="flex items-center justify-center py-12 text-zinc-500">
              <Loader2 className="h-5 w-5 animate-spin mr-2" />
              加载中...
            </div>
          ) : reports.length === 0 ? (
            <div className="rounded-xl border border-zinc-800/60 bg-[#111113] px-4 py-8 text-center text-xs text-zinc-500">
              <FileText className="h-5 w-5 mx-auto mb-2 opacity-50" />
              暂无日报
            </div>
          ) : (
            reports.map(report => (
              <ReportAccordion key={report.id} report={report} />
            ))
          )}
        </div>
      )}
    </main>
  )
}

/* ─── Report Accordion ─── */
function ReportAccordion({ report }: { report: DailyReport }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="rounded-xl border border-zinc-800/60 bg-[#111113] overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between px-4 py-3 hover:bg-zinc-800/30 transition-colors"
      >
        <div className="flex items-center gap-2">
          <ScrollText className="h-4 w-4 text-zinc-500" />
          <span className="text-sm font-medium text-zinc-200">{report.date}</span>
        </div>
        <span className="text-[10px] text-zinc-500">{open ? "收起" : "展开"}</span>
      </button>
      {open && (
        <div className="border-t border-zinc-800/40 px-4 py-3">
          <div className="prose prose-invert prose-sm max-w-none text-sm prose-headings:mb-2 prose-headings:text-zinc-100 prose-headings:text-sm prose-p:my-2 prose-p:text-zinc-300 prose-p:leading-6 prose-a:text-cyan-300 prose-strong:text-zinc-100 prose-code:rounded prose-code:bg-zinc-800/50 prose-code:px-1 prose-code:py-0.5 prose-code:text-emerald-300 prose-pre:border prose-pre:border-zinc-800/60 prose-pre:bg-[#09090b] prose-pre:p-3 prose-li:my-0.5 prose-li:text-zinc-300 prose-th:text-zinc-200 prose-td:text-zinc-300 prose-hr:border-zinc-800 [&_*]:break-words [&_ul]:my-2 [&_ol]:my-2 [&_li>p]:my-0.5">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{report.content}</ReactMarkdown>
          </div>
        </div>
      )}
    </div>
  )
}
