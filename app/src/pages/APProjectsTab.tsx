import { useCallback, useEffect, useMemo, useState } from "react"
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Filter,
  FolderKanban,
  GitMerge,
  Plus,
  Search,
  Tag,
  Users,
  X,
} from "lucide-react"

import { fetchAPProjects, type APProject } from "@/lib/api"
import { cn } from "@/lib/utils"

/* ═══════════════════ Constants ═══════════════════ */

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string; order: number }> = {
  active:      { label: "Active",      color: "text-emerald-400", bg: "bg-emerald-500/15 border-emerald-500/30", order: 1 },
  blocked:     { label: "Blocked",     color: "text-red-400",     bg: "bg-red-500/15 border-red-500/30",         order: 2 },
  discovering: { label: "Discovering", color: "text-blue-400",    bg: "bg-blue-500/15 border-blue-500/30",       order: 3 },
  dormant:     { label: "Dormant",     color: "text-amber-400",   bg: "bg-amber-500/15 border-amber-500/30",     order: 4 },
  done:        { label: "Done",        color: "text-zinc-400",    bg: "bg-zinc-500/15 border-zinc-500/30",       order: 5 },
  dismissed:   { label: "Dismissed",   color: "text-zinc-500",    bg: "bg-zinc-600/15 border-zinc-600/30",       order: 6 },
}

const BOT_EMOJI: Record<string, string> = {
  rabbit: "🐰", research: "🔬", "research-portal": "🏗️", "research-bi": "📈",
  "research-craft": "🎨", "fries-mac": "🍟", quokka: "🐨", otter: "🦦",
  giraffe: "🦒", kids: "👶", "dora-kids": "👶", healthbot: "❤️",
  clawline: "🤖", "clawline-gateway": "🌐", "clawline-channel": "📡",
  "clawline-client-web": "🌍", "miss-e": "👩", fan_bog: "🏔️",
  wukong: "🐵", "wukong-bot": "🐵", bnef: "📊",
}

/* ═══════════════════ Component ═══════════════════ */

export function APProjectsTab({ onOpenProject }: { onOpenProject: (id: string) => void }) {
  const [projects, setProjects] = useState<APProject[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filterStatus, setFilterStatus] = useState<string | null>(null)
  const [filterBot, setFilterBot] = useState<string | null>(null)
  const [filterTag, setFilterTag] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState("")
  const [showFilters, setShowFilters] = useState(false)
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set(["done", "dormant", "dismissed"]))

  const loadProjects = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await fetchAPProjects({
        status: filterStatus ?? undefined,
        bot: filterBot ?? undefined,
        tag: filterTag ?? undefined,
      })
      setProjects(data)
    } catch (e: any) {
      setError(e.message || "加载失败")
    } finally {
      setLoading(false)
    }
  }, [filterStatus, filterBot, filterTag])

  useEffect(() => { void loadProjects() }, [loadProjects])

  // Extract unique bots and tags for filter dropdowns
  const { allBots, allTags } = useMemo(() => {
    const bots = new Set<string>()
    const tags = new Set<string>()
    for (const p of projects) {
      p.involved_bots?.forEach(b => bots.add(b))
      p.tags?.forEach(t => tags.add(t))
    }
    return { allBots: Array.from(bots).sort(), allTags: Array.from(tags).sort() }
  }, [projects])

  // Group by status, apply search
  const groupedProjects = useMemo(() => {
    const q = searchQuery.toLowerCase().trim()
    const filtered = q
      ? projects.filter(p =>
          p.name.toLowerCase().includes(q) ||
          p.description?.toLowerCase().includes(q) ||
          p.tags?.some(t => t.toLowerCase().includes(q)) ||
          p.involved_bots?.some(b => b.toLowerCase().includes(q))
        )
      : projects

    const groups: Record<string, APProject[]> = {}
    for (const p of filtered) {
      const s = p.status || "active"
      if (!groups[s]) groups[s] = []
      groups[s].push(p)
    }

    // Sort groups by status order
    return Object.entries(groups)
      .sort(([a], [b]) => (STATUS_CONFIG[a]?.order ?? 99) - (STATUS_CONFIG[b]?.order ?? 99))
  }, [projects, searchQuery])

  const totalCount = projects.length
  const activeCount = projects.filter(p => p.status === "active").length

  const toggleGroup = (status: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev)
      if (next.has(status)) next.delete(status)
      else next.add(status)
      return next
    })
  }

  const clearFilters = () => {
    setFilterStatus(null)
    setFilterBot(null)
    setFilterTag(null)
    setSearchQuery("")
  }

  const hasFilters = filterStatus || filterBot || filterTag || searchQuery

  return (
    <div className="space-y-4">
      {/* Header Row */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <FolderKanban className="h-4 w-4 text-emerald-400" />
          <span className="text-sm font-medium text-zinc-300">
            {activeCount} active / {totalCount} total
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowFilters(f => !f)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition",
              showFilters || hasFilters
                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                : "border-zinc-700 bg-zinc-800/50 text-zinc-400 hover:border-zinc-600 hover:text-zinc-300"
            )}
          >
            <Filter className="h-3 w-3" />
            筛选
            {hasFilters && (
              <span className="ml-1 rounded-full bg-emerald-500/20 px-1.5 text-[10px]">on</span>
            )}
          </button>
        </div>
      </div>

      {/* Filter Bar */}
      {showFilters && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-900/50 p-3">
          {/* Search */}
          <div className="relative flex-1 min-w-[180px]">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
            <input
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="搜索项目..."
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 py-1.5 pl-8 pr-3 text-xs text-zinc-200 placeholder:text-zinc-500 focus:border-emerald-500/40 focus:outline-none"
            />
          </div>
          {/* Status filter */}
          <select
            value={filterStatus ?? ""}
            onChange={e => setFilterStatus(e.target.value || null)}
            className="rounded-lg border border-zinc-700 bg-zinc-800/50 px-2.5 py-1.5 text-xs text-zinc-300 focus:border-emerald-500/40 focus:outline-none"
          >
            <option value="">所有状态</option>
            {Object.entries(STATUS_CONFIG).map(([k, v]) => (
              <option key={k} value={k}>{v.label}</option>
            ))}
          </select>
          {/* Bot filter */}
          <select
            value={filterBot ?? ""}
            onChange={e => setFilterBot(e.target.value || null)}
            className="rounded-lg border border-zinc-700 bg-zinc-800/50 px-2.5 py-1.5 text-xs text-zinc-300 focus:border-emerald-500/40 focus:outline-none"
          >
            <option value="">所有 Bot</option>
            {allBots.map(b => (
              <option key={b} value={b}>{BOT_EMOJI[b] ?? "🤖"} {b}</option>
            ))}
          </select>
          {/* Tag filter */}
          {allTags.length > 0 && (
            <select
              value={filterTag ?? ""}
              onChange={e => setFilterTag(e.target.value || null)}
              className="rounded-lg border border-zinc-700 bg-zinc-800/50 px-2.5 py-1.5 text-xs text-zinc-300 focus:border-emerald-500/40 focus:outline-none"
            >
              <option value="">所有标签</option>
              {allTags.map(t => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          )}
          {hasFilters && (
            <button onClick={clearFilters} className="inline-flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-300">
              <X className="h-3 w-3" /> 清除
            </button>
          )}
        </div>
      )}

      {/* Loading/Error */}
      {loading && projects.length === 0 && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 px-5 py-12 text-center text-sm text-zinc-500">
          加载中...
        </div>
      )}
      {error && (
        <div className="flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {/* Project Groups */}
      {!loading && !error && groupedProjects.length === 0 && (
        <div className="flex flex-col items-center rounded-xl border border-zinc-800 bg-zinc-900/50 px-5 py-16 text-center">
          <FolderKanban className="mb-3 h-8 w-8 text-zinc-600" />
          <p className="text-sm text-zinc-400">
            {hasFilters ? "没有匹配的项目" : "暂无项目数据"}
          </p>
          <p className="mt-1 text-xs text-zinc-600">
            {hasFilters ? "试试调整筛选条件" : "后端正在填充数据，请稍候..."}
          </p>
        </div>
      )}

      {groupedProjects.map(([status, items]) => {
        const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.active
        const isCollapsed = collapsedGroups.has(status)

        return (
          <div key={status}>
            {/* Group Header */}
            <button
              onClick={() => toggleGroup(status)}
              className="mb-2 flex w-full items-center gap-2 text-left"
            >
              {isCollapsed
                ? <ChevronRight className={cn("h-3.5 w-3.5", cfg.color)} />
                : <ChevronDown className={cn("h-3.5 w-3.5", cfg.color)} />
              }
              <span className={cn("text-sm font-semibold", cfg.color)}>{cfg.label}</span>
              <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-[10px] font-medium text-zinc-400">
                {items.length}
              </span>
            </button>

            {/* Project Cards */}
            {!isCollapsed && (
              <div className="space-y-2 pl-1">
                {items.map(project => (
                  <ProjectCard
                    key={project.id}
                    project={project}
                    onClick={() => onOpenProject(project.id)}
                  />
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

/* ═══════════════════ Project Card ═══════════════════ */

function ProjectCard({ project, onClick }: { project: APProject; onClick: () => void }) {
  const cfg = STATUS_CONFIG[project.status] ?? STATUS_CONFIG.active
  const deliverableCount = project.deliverables?.length ?? 0
  const milestoneCount = project.milestones?.length ?? 0
  const botList = project.involved_bots ?? []

  return (
    <button
      type="button"
      onClick={onClick}
      className="block w-full text-left rounded-xl border border-zinc-800/80 bg-[#18181b] px-4 py-3 transition hover:border-zinc-700 hover:bg-[#1d1d21] sm:px-5 sm:py-4"
    >
      {/* Row 1: Name + Status badge */}
      <div className="flex items-start justify-between gap-3">
        <h3 className="min-w-0 flex-1 text-sm font-semibold text-zinc-100 sm:text-base">
          {project.name}
        </h3>
        <span className={cn("shrink-0 rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider", cfg.bg, cfg.color)}>
          {cfg.label}
        </span>
      </div>

      {/* Row 2: Description */}
      {project.description && (
        <p className="mt-1 line-clamp-1 text-xs text-zinc-500">{project.description}</p>
      )}

      {/* Row 3: Bots + meta */}
      <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-zinc-500">
        {/* Involved bots */}
        {botList.length > 0 && (
          <span className="inline-flex items-center gap-1">
            <Users className="h-3 w-3" />
            {botList.slice(0, 4).map(b => (
              <span key={b} className="rounded bg-zinc-800 px-1.5 py-0.5 text-zinc-400">
                {BOT_EMOJI[b] ?? "🤖"}{b}
              </span>
            ))}
            {botList.length > 4 && (
              <span className="text-zinc-600">+{botList.length - 4}</span>
            )}
          </span>
        )}

        {/* Primary bot */}
        {project.primary_bot && (
          <span className="text-zinc-400">
            主: {BOT_EMOJI[project.primary_bot] ?? "🤖"}{project.primary_bot}
          </span>
        )}

        {/* Tags */}
        {project.tags && project.tags.length > 0 && (
          <span className="inline-flex items-center gap-1">
            <Tag className="h-3 w-3" />
            {project.tags.slice(0, 3).map(t => (
              <span key={t} className="rounded bg-zinc-800 px-1.5 py-0.5">{t}</span>
            ))}
          </span>
        )}

        {/* Divider */}
        <span className="hidden sm:inline text-zinc-700">·</span>

        {/* Counts */}
        {milestoneCount > 0 && <span>{milestoneCount} 里程碑</span>}
        {deliverableCount > 0 && <span>{deliverableCount} 产出</span>}

        {/* Last active */}
        {project.last_active && (
          <span className="ml-auto text-zinc-600">
            {formatRelativeDate(project.last_active)}
          </span>
        )}
      </div>
    </button>
  )
}

/* ═══════════════════ Helpers ═══════════════════ */

function formatRelativeDate(dateStr: string): string {
  const d = new Date(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffDays = Math.floor(diffMs / 86400000)
  if (diffDays === 0) return "今天"
  if (diffDays === 1) return "昨天"
  if (diffDays < 7) return `${diffDays} 天前`
  return dateStr.slice(0, 10)
}
