import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  AlertTriangle,
  Archive,
  ArchiveRestore,
  Bot,
  Box,
  CheckCircle2,
  ChevronDown,
  Clock,
  Cpu,
  FileText,
  FlaskConical,
  Globe,
  HardDrive,
  History,
  Lightbulb,
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
import { fetchDailyReports, fetchDailyInsights, type CronJob, type DailyReport, type DailyInsights, type DashboardAgent, type DashboardData, type Project, type ServerSnapshot, type Stats } from "@/lib/api"
import { cn } from "@/lib/utils"

/* ═══════════════════ Types ═══════════════════ */

/** Mapping: MM username (bot_summaries.bot) → Agent card ID (agents.id) */
const MM_TO_AGENT_ID: Record<string, string> = {
  researcher: "research",
  craftbot: "research-craft",
  portalbot: "research-portal",
  bibot: "research-bi",
  gatewaybot: "clawline-gateway",
  channelbot: "clawline-channel",
  webbot: "clawline-client-web",
}

/** Reverse mapping: agent ID → MM username */
const AGENT_ID_TO_MM: Record<string, string> = Object.fromEntries(
  Object.entries(MM_TO_AGENT_ID).map(([mm, id]) => [id, mm])
)

/** Bot summary data merged onto cards */
export interface BotSummary {
  bot: string
  emoji: string
  messages: number
  completed: number
  pending: number
  dropped: number
  one_liner?: string
}

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
  historySummaries?: { time: string; bots: number | null; srvs: number | null }[]
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
  dashboard, loading, refreshing, historyPoints, historyBotPoints, historyServerPoints, historySummaries, selectedAsOf, onSelectAsOf,
  stats, projects, recentNotes, projectsLoading,
  onCreateProject, onOpenProject,
}: DashboardPageProps) {
  const [activeTab, setActiveTab] = useState<TabId>("bots")
  const [selectedTargets, setSelectedTargets] = useState<CommandTarget[]>([])
  const [insights, setInsights] = useState<DailyInsights | null>(null)

  const summary = dashboard.summary ?? {}
  const lastUpdated = dashboard.updated_at ?? summary.timestamp ?? null
  const asOf = dashboard.as_of ?? lastUpdated ?? null
  const servers = dashboard.servers ?? []
  const agents = dashboard.agents ?? []
  const serverOnlineCount = servers.filter((s) => s.ssh_reachable).length

  // Fetch daily insights
  useEffect(() => {
    const date = selectedAsOf ? selectedAsOf.slice(0, 10) : undefined
    fetchDailyInsights(date).then(d => setInsights(d)).catch(() => {})
  }, [selectedAsOf])

  // Build bot_summaries lookup by agent ID
  const botSummaryMap = useMemo(() => {
    const map: Record<string, BotSummary> = {}
    if (!insights?.bot_summaries) return map
    for (const bs of insights.bot_summaries) {
      const agentId = MM_TO_AGENT_ID[bs.bot]
      if (agentId) map[agentId] = bs
      // Also index by the MM username itself (for virtual cards)
      map[`__mm__${bs.bot}`] = bs
    }
    return map
  }, [insights])

  const handleToggleTarget = (target: CommandTarget) => {
    setSelectedTargets(prev => {
      const exists = prev.some(t => t.id === target.id)
      if (exists) return prev.filter(t => t.id !== target.id)
      return [...prev, target]
    })
  }

  return (
    <main className="flex min-h-screen w-full flex-col px-4 py-5 pb-32 pb-safe-lg sm:px-6 sm:py-6 lg:px-8 lg:py-8">
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
          botPoints={historyBotPoints}
          serverPoints={historyServerPoints}
          historySummaries={historySummaries}
          value={selectedAsOf}
          latestLabel={asOf}
          onChange={onSelectAsOf}
          agents={agents}
          servers={servers}
        />
      </div>

      {/* Tab Content */}
      <div className="min-h-[400px]">
        {/* Daily Insights Card (above tab content) */}
        <DailyInsightsCard insights={insights} />

        {activeTab === "bots" && (
          <BotFleetTab
            dashboard={dashboard}
            loading={loading}
            selectedTargets={selectedTargets}
            onToggleTarget={handleToggleTarget}
            onOpenProject={onOpenProject}
            botSummaryMap={botSummaryMap}
            botSummaries={insights?.bot_summaries}
          />
        )}
        {activeTab === "servers" && (
          <ServerFleetTab
            servers={servers}
            loading={loading}
            selectedTargets={selectedTargets}
            onToggleTarget={handleToggleTarget}
            productionSites={dashboard.production_sites ?? []}
            devSites={dashboard.dev_servers ?? []}
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

function InlineTimeMachine({ points, botPoints, serverPoints, historySummaries, value, latestLabel, onChange, agents, servers }: {
  points: string[]
  botPoints?: string[]
  serverPoints?: string[]
  historySummaries?: { time: string; bots: number | null; srvs: number | null }[]
  value: string | null
  latestLabel: string | null
  onChange: (v: string | null) => void
  agents: DashboardAgent[]
  servers: ServerSnapshot[]
}) {
  const [mobileOpen, setMobileOpen] = useState(false)
  const canTravel = points.length > 1
  const currentIndex = value ? Math.max(points.findIndex((p) => p === value), 0) : 0
  const displayTime = value ? fmtDateTime(value) : fmtDateTime(latestLabel)

  // Use backend summaries if available, otherwise fallback to current counts
  const pointSummaries = useMemo(() => {
    if (historySummaries?.length) {
      // Build a map for fast lookup
      const map = new Map(historySummaries.map(s => [s.time, s]))
      return points.map(p => {
        const s = map.get(p)
        return { time: p, bots: s?.bots ?? null, srvs: s?.srvs ?? null }
      })
    }
    // Fallback: use current dashboard counts
    return points.map(p => ({ time: p, bots: agents.length, srvs: servers.length }))
  }, [points, historySummaries, agents.length, servers.length])

  return (
    <>
      {/* Desktop: original slider */}
      <div className="hidden sm:flex items-center gap-3 rounded-lg border border-zinc-800/60 bg-[#111113] px-3 py-1.5">
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

      {/* Mobile: tap to open picker */}
      <button
        type="button"
        onClick={() => canTravel && setMobileOpen(true)}
        className={cn(
          "sm:hidden flex items-center gap-2 rounded-lg border border-zinc-800/60 bg-[#111113] px-3 py-1.5",
          !canTravel && "opacity-50"
        )}
      >
        <History className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
        <span className="font-mono text-xs text-zinc-300 whitespace-nowrap">{displayTime}</span>
      </button>

      {mobileOpen && (
        <MobileTimePicker
          points={points}
          summaries={pointSummaries}
          selectedIndex={currentIndex}
          onSelect={(i) => {
            onChange(i === 0 ? null : points[i] ?? null)
            setMobileOpen(false)
          }}
          onClose={() => setMobileOpen(false)}
        />
      )}
    </>
  )
}

/* ═══════════════════ Mobile Time Picker (Wheel) ═══════════════════ */

function fmtCST(v: string) {
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return "—"
  const mm = String(d.getMonth() + 1).padStart(2, "0")
  const dd = String(d.getDate()).padStart(2, "0")
  const hh = String(d.getHours()).padStart(2, "0")
  const mi = String(d.getMinutes()).padStart(2, "0")
  return `${mm}/${dd} ${hh}:${mi} CST`
}

/**
 * Cross-platform haptic/audio tick feedback.
 * - Android: navigator.vibrate()
 * - iOS/all: Web Audio API short "tick" sound (mimics native picker feel)
 */
const _audioCtx: { current: AudioContext | null } = { current: null }
function haptic(style: "light" | "medium" = "light") {
  try {
    // Android vibration
    if ("vibrate" in navigator) {
      navigator.vibrate(style === "medium" ? 10 : 5)
    }
    // Audio tick — works on iOS Safari too
    if (!_audioCtx.current) {
      _audioCtx.current = new (window.AudioContext || (window as any).webkitAudioContext)()
    }
    const ctx = _audioCtx.current
    if (ctx.state === "suspended") ctx.resume()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.frequency.value = style === "medium" ? 800 : 1200
    gain.gain.value = style === "medium" ? 0.08 : 0.04
    const now = ctx.currentTime
    osc.start(now)
    osc.stop(now + (style === "medium" ? 0.008 : 0.004))
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.01)
  } catch { /* silent */ }
}

function MobileTimePicker({ points, summaries, selectedIndex, onSelect, onClose }: {
  points: string[]
  summaries: { time: string; bots?: number; srvs?: number }[]
  selectedIndex: number
  onSelect: (index: number) => void
  onClose: () => void
}) {
  const ITEM_H = 56
  const wrapRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const [activeIdx, setActiveIdx] = useState(selectedIndex)
  const [pad, setPad] = useState(0)
  const rafRef = useRef(0)
  const snapTimerRef = useRef<ReturnType<typeof setTimeout>>()
  const prevActiveRef = useRef(selectedIndex)

  // ── Measure container → padding ──
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    setPad(Math.floor(el.clientHeight / 2 - ITEM_H / 2))
  }, [])

  // ── Initial scroll ──
  useEffect(() => {
    const el = listRef.current
    if (!el || pad === 0) return
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        el.scrollTop = selectedIndex * ITEM_H
        setActiveIdx(selectedIndex)
      })
    })
  }, [selectedIndex, pad])

  // ── Scroll handler ──
  const onScroll = useCallback(() => {
    cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(() => {
      const el = listRef.current
      if (!el) return
      const idx = Math.round(el.scrollTop / ITEM_H)
      const clamped = Math.max(0, Math.min(points.length - 1, idx))

      if (clamped !== prevActiveRef.current) {
        prevActiveRef.current = clamped
        haptic("light")
      }
      setActiveIdx(clamped)

      // Debounced snap
      if (snapTimerRef.current) clearTimeout(snapTimerRef.current)
      snapTimerRef.current = setTimeout(() => {
        el.scrollTo({ top: clamped * ITEM_H, behavior: "smooth" })
      }, 100)
    })
  }, [points.length])

  // ── Lock body + block gestures ──
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = "hidden"
    const block = (e: Event) => e.preventDefault()
    document.addEventListener("gesturestart", block, { passive: false })
    document.addEventListener("gesturechange", block, { passive: false })
    return () => {
      document.body.style.overflow = prev
      document.removeEventListener("gesturestart", block)
      document.removeEventListener("gesturechange", block)
    }
  }, [])

  return (
    <div className="fixed inset-0 z-[60] sm:hidden" onClick={onClose} style={{ touchAction: "none" }}>
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-md" />

      {/* Panel */}
      <div
        className="absolute right-0 top-0 bottom-0 flex flex-col animate-in slide-in-from-right-4 duration-200"
        onClick={(e) => e.stopPropagation()}
        style={{ width: "min(78vw, 300px)" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between bg-[#111113] px-4 py-3" style={{ paddingTop: "max(12px, env(safe-area-inset-top))" }}>
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-500/10">
              <History className="h-3.5 w-3.5 text-emerald-400" />
            </div>
            <span className="text-sm font-semibold text-zinc-100">时光机</span>
          </div>
          <button onClick={onClose} className="rounded-full p-2 text-zinc-500 active:bg-zinc-800 active:text-zinc-200">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Divider */}
        <div className="h-px bg-gradient-to-r from-transparent via-zinc-700/50 to-transparent" />

        {/* Scroll area */}
        <div ref={wrapRef} className="relative flex-1 overflow-hidden bg-[#0a0a0c]">
          {/* Center highlight band */}
          {pad > 0 && (
            <div
              className="pointer-events-none absolute inset-x-0 z-10"
              style={{ top: pad, height: ITEM_H }}
            >
              <div className="mx-2.5 h-full rounded-2xl bg-emerald-500/[0.08] ring-1 ring-emerald-500/25" />
            </div>
          )}

          {/* Fade edges */}
          <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-20 bg-gradient-to-b from-[#0a0a0c] via-[#0a0a0c]/80 to-transparent" />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-20 bg-gradient-to-t from-[#0a0a0c] via-[#0a0a0c]/80 to-transparent" />

          <div
            ref={listRef}
            onScroll={onScroll}
            className="h-full overflow-y-auto overflow-x-hidden overscroll-y-contain"
            style={{ WebkitOverflowScrolling: "touch", touchAction: "pan-y" }}
          >
            <div style={{ height: pad }} />

            {points.map((pt, i) => {
              const dist = Math.abs(i - activeIdx)
              const isActive = dist === 0
              // No scale transform — use opacity + font weight only (eliminates spacing inconsistency)
              const opacity = isActive ? 1 : dist === 1 ? 0.55 : dist === 2 ? 0.3 : 0.18
              const s = summaries[i]
              const info = s
                ? [s.bots != null ? `${s.bots} bots` : null, s.srvs != null ? `${s.srvs} srv` : null].filter(Boolean).join(" · ")
                : ""

              return (
                <div
                  key={pt}
                  onClick={() => { haptic("medium"); onSelect(i) }}
                  style={{ height: ITEM_H, opacity, transition: "opacity .1s ease-out" }}
                  className="flex items-center"
                >
                  {/* Ruler tick (left edge) */}
                  <div className="flex items-center pl-3 pr-2">
                    <div className={cn(
                      "rounded-full transition-all",
                      isActive
                        ? "w-1.5 h-5 bg-emerald-400 shadow-[0_0_6px_rgba(16,185,129,0.4)]"
                        : dist === 1
                          ? "w-1 h-3.5 bg-zinc-500"
                          : "w-0.5 h-2.5 bg-zinc-700"
                    )} />
                  </div>

                  {/* Time + info */}
                  <div className="flex-1 min-w-0 pr-4">
                    <div className={cn(
                      "font-mono tabular-nums tracking-tight",
                      isActive ? "text-[15px] text-emerald-300 font-bold" : "text-[13px] text-zinc-400 font-medium",
                    )}>
                      {fmtCST(pt)}
                    </div>
                    {info && (
                      <div className={cn(
                        "text-[10px] mt-0.5 font-medium",
                        isActive ? "text-zinc-400" : "text-zinc-600",
                      )}>
                        {info}
                      </div>
                    )}
                  </div>
                </div>
              )
            })}

            <div style={{ height: pad }} />
          </div>
        </div>

        {/* Divider */}
        <div className="h-px bg-gradient-to-r from-transparent via-zinc-700/50 to-transparent" />

        {/* Footer */}
        <div className="bg-[#111113] px-3 py-3 flex gap-2" style={{ paddingBottom: "max(12px, env(safe-area-inset-bottom))" }}>
          <button
            onClick={() => { haptic("medium"); onSelect(0) }}
            className="flex-1 rounded-xl border border-zinc-700/80 bg-[#18181b] py-2.5 text-xs font-medium text-zinc-300 active:bg-zinc-700 transition-colors"
          >
            回到最新
          </button>
          <button
            onClick={() => { haptic("medium"); onSelect(activeIdx) }}
            className="flex-1 rounded-xl bg-emerald-600 py-2.5 text-xs font-bold text-white shadow-lg shadow-emerald-900/30 active:bg-emerald-500 transition-colors"
          >
            确认选择
          </button>
        </div>
      </div>
    </div>
  )
}

/* ═══════════════════ Tab Button ═══════════════════ */

/* ═══════════════════ Daily Insights Card ═══════════════════ */

const SEVERITY_COLORS: Record<string, string> = {
  high: "bg-rose-500/10 text-rose-400 border-rose-500/20",
  medium: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  low: "bg-zinc-500/10 text-zinc-400 border-zinc-500/20",
}

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  completed: { label: "完成", cls: "bg-emerald-500/15 text-emerald-400 border-emerald-500/25" },
  in_progress: { label: "进行中", cls: "bg-amber-500/15 text-amber-400 border-amber-500/25" },
  dropped: { label: "遗漏", cls: "bg-rose-500/15 text-rose-400 border-rose-500/25" },
  needs_attention: { label: "需关注", cls: "bg-rose-500/15 text-rose-400 border-rose-500/25" },
}

function DailyInsightsCard({ insights: data }: { insights: DailyInsights | null }) {
  const [collapsed, setCollapsed] = useState(false)
  const [timelineOpen, setTimelineOpen] = useState(false)

  if (!data) return null

  const { focus_top3, needs_attention, timeline, stats, bot_summaries } = data
  const sortedTimeline = [...(timeline ?? [])].sort((a, b) => a.time.localeCompare(b.time))

  return (
    <div className="mb-4 space-y-3">
      {/* ── Header Card: Focus + Attention + Stats ── */}
      <div className="rounded-xl border border-zinc-800/60 bg-[#111113] overflow-hidden">
        <button
          type="button"
          onClick={() => setCollapsed(!collapsed)}
          className="flex w-full items-center justify-between px-4 py-3 hover:bg-zinc-800/30 transition-colors"
        >
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500/10">
              <Lightbulb className="h-4 w-4 text-amber-400" />
            </div>
            <div className="text-left">
              <div className="text-sm font-semibold text-zinc-100">每日洞察</div>
              <div className="text-[11px] text-zinc-500">{data.date}</div>
            </div>
          </div>
          <ChevronDown className={cn("h-4 w-4 text-zinc-500 transition-transform", !collapsed && "rotate-180")} />
        </button>

        {!collapsed && (
          <div className="border-t border-zinc-800/40 px-4 py-3 space-y-4">
            {/* Focus Top 3 */}
            {focus_top3?.length > 0 && (
              <div className="space-y-2">
                <div className="text-[10px] font-medium text-zinc-500 uppercase tracking-wider">🎯 今日焦点</div>
                {focus_top3.map((f, i) => (
                  <div key={i} className="rounded-lg bg-amber-500/5 border border-amber-500/10 px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <span className="text-sm">{f.bot_emoji}</span>
                      <span className="text-xs font-semibold text-zinc-100">{f.title}</span>
                    </div>
                    <div className="text-[11px] text-zinc-400 mt-1 leading-relaxed">{f.description}</div>
                    <div className="text-[10px] text-zinc-600 mt-1">@{f.bot}</div>
                  </div>
                ))}
              </div>
            )}

            {/* Needs Attention */}
            {needs_attention?.length > 0 && (
              <div className="space-y-1.5">
                <div className="text-[10px] font-medium text-zinc-500 uppercase tracking-wider">🔔 需要关注</div>
                {[...needs_attention].sort((a, b) => {
                  const order: Record<string, number> = { high: 0, medium: 1, low: 2 }
                  return (order[a.severity] ?? 2) - (order[b.severity] ?? 2)
                }).map((n, i) => (
                  <div key={i} className={cn(
                    "rounded-lg border px-3 py-2",
                    SEVERITY_COLORS[n.severity] ?? SEVERITY_COLORS.low,
                  )}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm">{n.bot_emoji}</span>
                        <span className="text-xs font-medium">{n.title}</span>
                      </div>
                      <span className="text-[10px] opacity-60">@{n.bot}</span>
                    </div>
                    {n.description && (
                      <div className="text-[11px] mt-0.5 opacity-80 pl-6">{n.description}</div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Stats Bar */}
            {stats && (
              <div className="flex flex-wrap gap-3 rounded-lg bg-[#0c0c0e] px-3 py-2.5">
                <StatBadge icon={Bot} label="活跃 Bot" value={stats.active_bots} color="text-emerald-400" />
                <StatBadge icon={MessageSquare} label="消息" value={stats.total_messages} color="text-sky-400" />
                <StatBadge icon={CheckCircle2} label="完成" value={stats.completed} color="text-emerald-400" />
                <StatBadge icon={Clock} label="进行中" value={stats.in_progress} color="text-amber-400" />
                {stats.needs_attention > 0 && (
                  <StatBadge icon={AlertTriangle} label="需关注" value={stats.needs_attention} color="text-rose-400" />
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Unified Timeline ── */}
      {sortedTimeline.length > 0 && (
        <div className="rounded-xl border border-zinc-800/60 bg-[#111113] overflow-hidden">
          <button
            type="button"
            onClick={() => setTimelineOpen(!timelineOpen)}
            className="flex w-full items-center justify-between px-4 py-3 hover:bg-zinc-800/30 transition-colors"
          >
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-500/10">
                <History className="h-4 w-4 text-sky-400" />
              </div>
              <div className="text-left">
                <div className="text-sm font-semibold text-zinc-100">事件流</div>
                <div className="text-[11px] text-zinc-500">{sortedTimeline.length} 条事件</div>
              </div>
            </div>
            <ChevronDown className={cn("h-4 w-4 text-zinc-500 transition-transform", timelineOpen && "rotate-180")} />
          </button>

          {timelineOpen && (
            <div className="border-t border-zinc-800/40 px-4 py-3 space-y-0">
              {sortedTimeline.map((ev, i) => {
                const badge = STATUS_BADGE[ev.status] ?? { label: ev.status, cls: "bg-zinc-500/15 text-zinc-400 border-zinc-500/25" }
                const isLast = i === sortedTimeline.length - 1
                return (
                  <div key={i} className={cn(
                    "relative pl-7 pb-3",
                    ev.is_focus && "bg-amber-500/[0.03] -mx-4 px-[calc(1rem+28px)] rounded-lg"
                  )}>
                    {/* Vertical line */}
                    {!isLast && (
                      <div className="absolute left-[11px] top-5 bottom-0 w-px bg-zinc-700/40" />
                    )}
                    {/* Dot */}
                    <div className={cn(
                      "absolute left-0 top-1 h-[22px] w-[22px] rounded-full flex items-center justify-center text-xs border",
                      ev.is_focus ? "border-amber-500/30 bg-amber-500/10" : "border-zinc-700/50 bg-[#18181b]",
                    )}>
                      <span className="text-[11px]">{ev.bot_emoji}</span>
                    </div>
                    {/* Content */}
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[10px] font-mono text-zinc-500">{ev.time}</span>
                        <span className="text-xs text-zinc-300 font-medium">{ev.title}</span>
                        <span className={cn("rounded-full border px-1.5 py-0.5 text-[9px] font-medium", badge.cls)}>
                          {badge.label}
                        </span>
                      </div>
                      <div className="text-[10px] text-zinc-600 mt-0.5">@{ev.bot}</div>
                      {ev.deliverables?.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {ev.deliverables.map((d, di) => (
                            <code key={di} className="rounded bg-zinc-800/60 px-1.5 py-0.5 text-[9px] text-zinc-400 font-mono truncate max-w-[200px]">
                              {d}
                            </code>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function StatBadge({ icon: Icon, label, value, color }: { icon: React.ElementType; label: string; value: number; color: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <Icon className={cn("h-3.5 w-3.5", color)} />
      <span className="text-[11px] text-zinc-400">{label}</span>
      <span className={cn("text-sm font-bold tabular-nums", color)}>{value}</span>
    </div>
  )
}

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

/* ═══════════════════ Archive helpers ═══════════════════ */

const ARCHIVE_KEY = "portal:archived-bots"

function getArchivedIds(): Set<string> {
  try {
    const raw = localStorage.getItem(ARCHIVE_KEY)
    return raw ? new Set(JSON.parse(raw) as string[]) : new Set()
  } catch { return new Set() }
}

function setArchivedIds(ids: Set<string>) {
  localStorage.setItem(ARCHIVE_KEY, JSON.stringify([...ids]))
}

function useArchivedBots() {
  const [archived, setArchived] = useState<Set<string>>(() => getArchivedIds())

  const toggle = useCallback((id: string) => {
    setArchived(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      setArchivedIds(next)
      return next
    })
  }, [])

  return { archived, toggleArchive: toggle }
}

/* ═══════════════════ Bot Fleet Tab ═══════════════════ */

function BotFleetTab({ dashboard, loading, selectedTargets, onToggleTarget, onOpenProject, botSummaryMap, botSummaries }: {
  dashboard: DashboardData; loading: boolean; selectedTargets: CommandTarget[]; onToggleTarget: (t: CommandTarget) => void; onOpenProject: (slug: string) => void; botSummaryMap: Record<string, BotSummary>; botSummaries?: BotSummary[]
}) {
  const agents = dashboard.agents ?? []
  const { archived, toggleArchive } = useArchivedBots()
  const [showArchived, setShowArchived] = useState(false)

  // Find bots in bot_summaries that don't have a matching agent card
  const virtualAgents = useMemo(() => {
    if (!botSummaries?.length) return []
    const existingIds = new Set(agents.map(a => a.id))
    return botSummaries
      .filter(bs => {
        const agentId = MM_TO_AGENT_ID[bs.bot]
        // Not mapped, or mapped but not in existing agents
        return !agentId || !existingIds.has(agentId)
      })
      .filter(bs => {
        // Also skip if mapped ID exists
        const mappedId = MM_TO_AGENT_ID[bs.bot]
        return !mappedId || !existingIds.has(mappedId)
      })
      .map(bs => ({
        id: MM_TO_AGENT_ID[bs.bot] ?? bs.bot,
        name: bs.bot,
        role: "normal" as const,
        mm_user_id: null,
        production: null,
        dev: null,
        container: null,
        crons: null,
        tasks: null,
        project: null,
        _virtual: true,
        _emoji: bs.emoji,
      }))
  }, [agents, botSummaries])

  const allAgents = [...agents, ...virtualAgents] as (DashboardAgent & { _virtual?: boolean; _emoji?: string })[]
  const activeAgents = allAgents.filter(a => !archived.has(a.id))
  const archivedAgents = allAgents.filter(a => archived.has(a.id))

  return (
    <div className="space-y-3">
      {loading && agents.length === 0 ? <EmptyRow text="加载中..." /> : agents.length === 0 ? <EmptyRow text="暂无 Agent 数据" /> : (
        <>
          {/* Active bots */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {activeAgents.map((agent) => (
              <BotCard
                key={agent.id}
                agent={agent}
                selected={selectedTargets.some(t => t.id === agent.id)}
                onToggle={() => onToggleTarget({ id: agent.id, name: agent.name ?? agent.id, emoji: (agent as any)._emoji ?? "🤖", user_id: agent.mm_user_id!, kind: "bot" })}
                onOpenProject={onOpenProject}
                onArchive={() => toggleArchive(agent.id)}
                isArchived={false}
                botSummary={botSummaryMap[agent.id]}
                isVirtual={(agent as any)._virtual}
                virtualEmoji={(agent as any)._emoji}
              />
            ))}
          </div>

          {/* Archived section */}
          {archivedAgents.length > 0 && (
            <div className="mt-4">
              <button
                type="button"
                onClick={() => setShowArchived(!showArchived)}
                className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50 transition-colors"
              >
                <Archive className="h-3.5 w-3.5" />
                <span>已归档 ({archivedAgents.length})</span>
                <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", showArchived && "rotate-180")} />
              </button>
              {showArchived && (
                <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 opacity-60">
                  {archivedAgents.map((agent) => (
                    <BotCard
                      key={agent.id}
                      agent={agent}
                      selected={selectedTargets.some(t => t.id === agent.id)}
                      onToggle={() => onToggleTarget({ id: agent.id, name: agent.name ?? agent.id, emoji: (agent as any)._emoji ?? "🤖", user_id: agent.mm_user_id!, kind: "bot" })}
                      onOpenProject={onOpenProject}
                      onArchive={() => toggleArchive(agent.id)}
                      isArchived={true}
                      botSummary={botSummaryMap[agent.id]}
                      isVirtual={(agent as any)._virtual}
                      virtualEmoji={(agent as any)._emoji}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}

function BotCard({ agent, selected, onToggle, onOpenProject, onArchive, isArchived, botSummary, isVirtual, virtualEmoji }: { agent: DashboardAgent; selected: boolean; onToggle: () => void; onOpenProject: (slug: string) => void; onArchive: () => void; isArchived: boolean; botSummary?: BotSummary; isVirtual?: boolean; virtualEmoji?: string }) {
  const [expanded, setExpanded] = useState(false)
  const [cronOpen, setCronOpen] = useState(false)
  
  const mmUsername = AGENT_ID_TO_MM[agent.id] ?? agent.id
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
              {isVirtual && virtualEmoji ? (
                <span className="text-lg">{virtualEmoji}</span>
              ) : (
                <Workflow className="h-4.5 w-4.5" />
              )}
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-semibold text-zinc-100">{agent.name}</span>
                {agent.role === "coordination" && (
                  <Badge variant="outline" className="border-zinc-700 bg-zinc-800/50 px-1 py-0 text-[10px] text-zinc-400">协调</Badge>
                )}
                {isVirtual && (
                  <Badge variant="outline" className="border-sky-500/30 bg-sky-500/10 px-1 py-0 text-[10px] text-sky-400">日报</Badge>
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
              {/* Bot summary one-liner + stats (from daily insights) */}
              {botSummary && (
                <div className="flex items-center gap-2 mt-0.5 text-[10px]">
                  {botSummary.one_liner && (
                    <span className="text-zinc-400 truncate max-w-[180px]">{botSummary.one_liner}</span>
                  )}
                  <span className="text-sky-400">{botSummary.messages} msg</span>
                  <span className="text-emerald-400">✓{botSummary.completed}</span>
                  {botSummary.pending > 0 && <span className="text-amber-400">⏳{botSummary.pending}</span>}
                  {botSummary.dropped > 0 && <span className="text-rose-400">✗{botSummary.dropped}</span>}
                </div>
              )}
            </div>
          </div>
          
          <div className="flex items-center gap-2">
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
            {container && (
              <div className="grid grid-cols-1 gap-2 text-xs">
                <div className="flex items-center gap-2 rounded-md bg-[#18181b] px-2.5 py-2 border border-zinc-800/50">
                  <Box className="h-3.5 w-3.5 text-zinc-500" />
                  <span className="text-[11px] text-zinc-500">容器状态</span>
                  <div className="ml-auto flex items-center gap-1.5">
                    <span className={cn("h-1.5 w-1.5 rounded-full", container.status === "running" ? "bg-emerald-500" : "bg-rose-500")} />
                    <span className={cn("text-[11px] font-medium", container.status === "running" ? "text-emerald-400" : "text-rose-400")}>
                      {container.status}
                    </span>
                  </div>
                </div>
              </div>
            )}

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

            <DailyReportsSection agentId={mmUsername} />
            <ActivityTimeline agentId={mmUsername} />

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
               <button
                 onClick={(e) => { e.stopPropagation(); onArchive() }}
                 className={cn(
                   "inline-flex items-center justify-center gap-1 rounded-lg border py-1.5 px-2.5 text-xs transition-colors",
                   isArchived
                     ? "border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10"
                     : "border-zinc-800 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
                 )}
                 title={isArchived ? "取消归档" : "归档"}
               >
                 {isArchived ? <ArchiveRestore className="h-3.5 w-3.5" /> : <Archive className="h-3.5 w-3.5" />}
               </button>
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

/* ═══════════════════ Activity Timeline ═══════════════════ */

import { fetchDailyActivities, fetchDailyActivityDates, type DailyActivity } from "@/lib/api"

const ACTION_ICONS: Record<string, { icon: string; color: string }> = {
  completed: { icon: "✅", color: "text-emerald-400" },
  in_progress: { icon: "⏳", color: "text-amber-400" },
  dropped: { icon: "❌", color: "text-rose-400" },
  promise_no_result: { icon: "⚠️", color: "text-amber-400" },
  no_response: { icon: "🔇", color: "text-zinc-500" },
}

function ActivityTimeline({ agentId }: { agentId: string }) {
  const [activities, setActivities] = useState<DailyActivity[]>([])
  const [dates, setDates] = useState<string[]>([])
  const [selectedDate, setSelectedDate] = useState<string>("")
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [open, setOpen] = useState(false)

  // Load available dates
  useEffect(() => {
    let cancelled = false
    fetchDailyActivityDates(agentId).then(d => {
      if (!cancelled && d?.length) {
        setDates(d)
        setSelectedDate(d[0]) // latest
      }
    }).catch(() => {})
    return () => { cancelled = true }
  }, [agentId])

  // Load activities for selected date
  useEffect(() => {
    if (!selectedDate) return
    let cancelled = false
    setLoading(true)
    fetchDailyActivities(agentId, selectedDate).then(a => {
      if (!cancelled) { setActivities(a ?? []); setLoading(false); setLoaded(true) }
    }).catch(() => { if (!cancelled) { setActivities([]); setLoading(false); setLoaded(true) } })
    return () => { cancelled = true }
  }, [agentId, selectedDate])

  // Don't show section if no dates available
  if (dates.length === 0 && loaded) return null
  if (dates.length === 0) return null

  return (
    <div className="rounded-md border border-zinc-800/50 bg-[#18181b]">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between gap-2 px-2.5 py-2 text-xs hover:bg-zinc-800/30 transition-colors"
      >
        <div className="inline-flex items-center gap-2 text-zinc-400">
          <Clock className="h-3.5 w-3.5 text-zinc-500" />
          <span>活动时间线</span>
        </div>
        <div className="flex items-center gap-2">
          {dates.length > 0 && (
            <select
              value={selectedDate}
              onChange={(e) => { e.stopPropagation(); setSelectedDate(e.target.value) }}
              onClick={(e) => e.stopPropagation()}
              className="rounded bg-zinc-800 border border-zinc-700 px-1.5 py-0.5 text-[10px] text-zinc-300"
            >
              {dates.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          )}
          <ChevronDown className={cn("h-3 w-3 text-zinc-500 transition-transform", open && "rotate-180")} />
        </div>
      </button>

      {open && (
        <div className="border-t border-zinc-800/50 px-2.5 py-2">
          {loading ? (
            <div className="text-xs text-zinc-500 py-3 text-center">加载中...</div>
          ) : activities.length === 0 ? (
            <div className="text-xs text-zinc-500 py-3 text-center">今日无活动记录</div>
          ) : (
            <div className="space-y-0">
              {activities.map((act, i) => {
                const actionCfg = ACTION_ICONS[act.action] ?? { icon: "📌", color: "text-zinc-400" }
                const isLast = i === activities.length - 1
                return (
                  <div key={act.id} className="relative pl-6 pb-2">
                    {/* Vertical line */}
                    {!isLast && (
                      <div className="absolute left-[9px] top-5 bottom-0 w-px bg-zinc-700/40" />
                    )}
                    {/* Dot */}
                    <span className="absolute left-0 top-0.5 text-sm">{actionCfg.icon}</span>
                    {/* Content */}
                    <div>
                      <div className="flex items-center gap-2">
                        {act.time && (
                          <span className="text-[10px] font-mono text-zinc-500">{act.time}</span>
                        )}
                        <span className={cn("text-[10px] font-medium uppercase", actionCfg.color)}>
                          {act.action}
                        </span>
                      </div>
                      <div className="text-xs text-zinc-300 mt-0.5">{act.content}</div>
                      {act.detail?.references?.length ? (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {act.detail.references.map((ref, ri) => (
                            <code key={ri} className="rounded bg-zinc-800/60 px-1.5 py-0.5 text-[9px] text-zinc-400 font-mono">
                              {ref}
                            </code>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
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

function ServerFleetTab({ servers, loading, selectedTargets, onToggleTarget, productionSites, devSites }: {
  servers: ServerSnapshot[]
  loading: boolean
  selectedTargets: CommandTarget[]
  onToggleTarget: (t: CommandTarget) => void
  productionSites: DashboardData["production_sites"]
  devSites: DashboardData["dev_servers"]
}) {
  const { domestic, global } = useMemo(() => classifyServers(servers), [servers])
  const hasServers = servers.length > 0
  const hasSiteStatus = (productionSites ?? []).length > 0 || (devSites ?? []).length > 0

  return (
    <div className="space-y-6">
      {hasSiteStatus && <SiteStatusOverview productionSites={productionSites ?? []} devSites={devSites ?? []} />}
      {loading && !hasServers ? <EmptyRow text="加载中..." /> : !hasServers ? <EmptyRow text="暂无服务器数据" /> : (
        <>
          {domestic.length > 0 && <ServerGroup label="国内区域" flag="🇨🇳" servers={domestic} selectedTargets={selectedTargets} onToggleTarget={onToggleTarget} />}
          {global.length > 0 && <ServerGroup label="全球区域" flag="🌍" servers={global} selectedTargets={selectedTargets} onToggleTarget={onToggleTarget} />}
        </>
      )}
    </div>
  )
}

function SiteStatusOverview({ productionSites, devSites }: {
  productionSites: DashboardData["production_sites"]
  devSites: DashboardData["dev_servers"]
}) {
  return (
    <section className="rounded-xl border border-zinc-800/80 bg-[#111113] p-4">
      <div className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
        <Globe className="h-4 w-4 text-emerald-400" />
        <span>站点状态</span>
      </div>

      <div className="mt-3 space-y-3">
        <SiteStatusSection title="生产环境" sites={productionSites ?? []} emptyText="暂无生产环境站点" />
        <SiteStatusSection title="开发环境" sites={devSites ?? []} emptyText="暂无开发环境站点" />
      </div>
    </section>
  )
}

function SiteStatusSection({ title, sites, emptyText }: {
  title: string
  sites: Array<{ name: string; url: string; status: number }>
  emptyText: string
}) {
  return (
    <div className="rounded-lg border border-zinc-800/60 bg-[#0c0c0e]/50 p-3">
      <div className="mb-2 text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-500">{title}</div>
      {sites.length === 0 ? (
        <div className="text-xs text-zinc-600">{emptyText}</div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {sites.map((site) => {
            const isUp = site.status === 200
            return (
              <a
                key={`${title}-${site.name}-${site.url}`}
                href={site.url}
                target="_blank"
                rel="noreferrer"
                className={cn(
                  "inline-flex min-w-0 items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs transition-colors hover:bg-zinc-800/60",
                  isUp
                    ? "border-emerald-500/20 bg-emerald-500/5 text-emerald-300"
                    : "border-rose-500/20 bg-rose-500/5 text-rose-300"
                )}
                title={`${site.name} · ${site.url}`}
              >
                <span className="text-sm leading-none">{isUp ? "✅" : "❌"}</span>
                <span className="truncate">{site.name}</span>
              </a>
            )
          })}
        </div>
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
            onToggle={() => onToggleTarget({ id: `server:${server.id}`, name: server.name, emoji: "🖥️", user_id: "ctgkdui9n38idyepmdzaoccgdw", kind: "server" })}
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
