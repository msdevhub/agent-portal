import { useEffect, useState, useCallback, useRef } from "react"
import {
  fetchAPProjects,
  sendProjectChat,
  triggerDigestRefresh,
  updateProjectSortOrder,
  type APProject,
  type DashboardAgent,
} from "@/lib/api"
import type { CommandTarget, ProjectContext } from "@/components/portal/CommandBar"
import { cn } from "@/lib/utils"
import {
  AlertTriangle,
  ArrowRight,
  Bot,
  GripVertical,
  Loader2,
  MessageSquare,
  RefreshCw,
  Search,
  Send,
  X,
} from "lucide-react"
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core"
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"

interface ProjectKanbanTabProps {
  onOpenProject?: (id: string) => void
  onOpenBot?: (agentId: string) => void
  agents?: DashboardAgent[]
  onToggleTarget?: (target: CommandTarget) => void
}

function Toast({ message, type, onDone }: { message: string; type: 'success' | 'error'; onDone: () => void }) {
  useEffect(() => { const t = setTimeout(onDone, 2500); return () => clearTimeout(t) }, [onDone])
  return (
    <div className={cn(
      "fixed bottom-6 left-1/2 -translate-x-1/2 z-[60] px-4 py-2.5 rounded-xl text-sm font-medium shadow-lg border backdrop-blur-sm transition-all",
      type === 'success' ? "bg-emerald-500/15 border-emerald-500/30 text-emerald-300" : "bg-rose-500/15 border-rose-500/30 text-rose-300"
    )}>
      {type === 'success' ? '✅' : '❌'} {message}
    </div>
  )
}

const STATUS_CONFIG = {
  blocked:     { color: "text-rose-400",    bg: "bg-rose-500/10",    border: "border-rose-500/25",   dot: "bg-rose-500",    label: "阻塞" },
  attention:   { color: "text-amber-400",   bg: "bg-amber-500/10",   border: "border-amber-500/25",  dot: "bg-amber-500",   label: "需关注" },
  active:      { color: "text-emerald-400", bg: "bg-emerald-500/10", border: "border-emerald-500/25", dot: "bg-emerald-500 animate-pulse", label: "进行中" },
  idle:        { color: "text-zinc-400",    bg: "bg-zinc-500/10",    border: "border-zinc-600/25",   dot: "bg-zinc-400",    label: "空闲" },
  discovering: { color: "text-sky-400",     bg: "bg-sky-500/10",     border: "border-sky-500/25",    dot: "bg-sky-500",     label: "探索中" },
  done:        { color: "text-violet-400",  bg: "bg-violet-500/10",  border: "border-violet-500/25", dot: "bg-violet-500",  label: "已完成" },
  completed:   { color: "text-violet-400",  bg: "bg-violet-500/10",  border: "border-violet-500/25", dot: "bg-violet-500",  label: "已完成" },
  dormant:     { color: "text-zinc-400",    bg: "bg-zinc-500/10",    border: "border-zinc-600/25",   dot: "bg-zinc-500",    label: "休眠" },
} as const

/** Check if last_active is today or yesterday */
function isRecentlyActive(lastActive: string | null | undefined): boolean {
  if (!lastActive) return false
  const now = new Date()
  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  const yesterdayStr = yesterday.toISOString().slice(0, 10)
  return lastActive >= yesterdayStr
}

function getDisplay(p: APProject) {
  if (p.status === 'blocked' || p.health === 'blocked' || p.health === 'attention') {
    return p.health === 'attention' ? STATUS_CONFIG.attention : STATUS_CONFIG.blocked
  }
  // Active projects: show "进行中" only if last_active is today/yesterday, else "空闲"
  if (p.status === 'active') {
    return isRecentlyActive(p.last_active) ? STATUS_CONFIG.active : STATUS_CONFIG.idle
  }
  return STATUS_CONFIG[p.status as keyof typeof STATUS_CONFIG] || STATUS_CONFIG.active
}

function needsDecision(p: APProject) {
  if (p.status === 'done' || p.status === 'completed' || p.status === 'dismissed') return false
  return p.status === 'blocked' || p.health === 'blocked' || p.health === 'attention'
}

type FilterId = "all" | "decision" | "active" | "done"

function ProjectChatDialog({
  project,
  onClose,
  onSent,
}: {
  project: APProject
  onClose: () => void
  onSent: () => void
}) {
  const prefix = `[项目: ${project.name}] `
  const [message, setMessage] = useState(prefix)
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)

  const handleSend = async () => {
    const body = message.startsWith(prefix) ? message.slice(prefix.length).trim() : message.trim()
    if (!body) return
    setSending(true)
    try {
      await sendProjectChat(project.name, body)
      setSent(true)
      setTimeout(() => { onSent(); onClose() }, 1000)
    } catch {
      alert("发送失败，请重试")
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-0 sm:p-4" onClick={onClose}>
      <div className="w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl border border-zinc-700/60 bg-[#18181b] p-5 shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <MessageSquare className="h-4 w-4 text-sky-400" />
            <span className="text-sm font-medium text-zinc-100">与项目对话</span>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-zinc-700/50 text-zinc-400 hover:text-zinc-200 transition">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mb-3 text-xs text-zinc-400">
          将发送到 <span className="text-zinc-200 font-medium">Daddy ↔ rabbit</span> 的 DM 频道
        </div>

        <textarea
          className="w-full rounded-xl border border-zinc-700/60 bg-zinc-800/50 px-3 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-500 resize-none focus:outline-none focus:ring-1 focus:ring-sky-500/50 focus:border-sky-500/50 transition"
          rows={4}
          value={message}
          onChange={e => setMessage(e.target.value)}
          disabled={sending || sent}
          placeholder={`${prefix}输入指令...`}
        />

        <div className="mt-3 flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-1.5 text-xs rounded-lg text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700/50 transition">取消</button>
          <button
            onClick={handleSend}
            disabled={sending || sent || message.trim() === prefix.trim()}
            className={cn(
              "flex items-center gap-1.5 px-4 py-1.5 text-xs font-medium rounded-lg transition",
              sent
                ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                : "bg-sky-500/20 text-sky-300 border border-sky-500/30 hover:bg-sky-500/30 disabled:opacity-40"
            )}
          >
            {sending ? <Loader2 className="h-3 w-3 animate-spin" /> : sent ? "✓ 已发送给 rabbit" : <><Send className="h-3 w-3" /> 发送</>}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ── Sortable Project Card ── */
function SortableProjectCard({
  project,
  onOpenProject,
  onBotClick,
  onChat,
  onNextActionClick,
}: {
  project: APProject
  onOpenProject?: (id: string) => void
  onBotClick: (botId: string, project: APProject) => void
  onChat: (p: APProject) => void
  onNextActionClick?: (project: APProject, actionText: string) => void
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: project.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 50 : undefined,
  }

  const display = getDisplay(project)
  const nextAction = project.next_actions.find(a => !a.done)

  const maintainers = project.maintainers?.length
    ? project.maintainers
    : (project.responsible_bot || project.primary_bot)
      ? [{ agent_id: (project.responsible_bot || project.primary_bot)!, name: (project.responsible_bot || project.primary_bot)! }]
      : []

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "relative rounded-xl border bg-[#111113] transition-all duration-200 cursor-pointer group/card",
        display.border, "hover:border-zinc-600 active:scale-[0.99]",
        isDragging && "opacity-80 shadow-2xl scale-[1.02] ring-2 ring-sky-500/30"
      )}
      onClick={() => { if (!isDragging) onOpenProject?.(project.id) }}
    >
      {/* Drag handle — top center, floating */}
      <div
        className="absolute top-1 left-1/2 -translate-x-1/2 z-10 flex items-center justify-center w-12 h-4 rounded-full bg-zinc-800/80 opacity-50 sm:opacity-0 sm:group-hover/card:opacity-70 hover:!opacity-100 transition-all cursor-grab active:cursor-grabbing touch-none"
        {...attributes}
        {...listeners}
        onClick={e => e.stopPropagation()}
        onPointerDown={e => e.stopPropagation()}
      >
        <GripVertical className="h-3.5 w-3.5 text-zinc-400 rotate-90" />
      </div>

      <div className="px-3 sm:px-4 py-2.5 sm:py-3">
        <div className="min-w-0">
          {/* 标题 + 状态 */}
          <div className="flex items-start justify-between gap-2">
            <span className="text-xs sm:text-sm font-semibold text-zinc-100 min-w-0">
              {project.emoji ?? "📂"} {project.name}
            </span>
            <div className={cn("shrink-0 flex items-center gap-1.5 rounded-full px-2 py-0.5", display.bg)}>
              <div className={cn("h-1.5 w-1.5 rounded-full", display.dot)} />
              <span className={cn("text-[10px] font-medium", display.color)}>{display.label}</span>
            </div>
          </div>

          {/* 摘要 */}
          {(project.current_summary || project.description) && (
            <p className="mt-1 sm:mt-1.5 text-[11px] sm:text-xs text-zinc-400 line-clamp-2 leading-relaxed">{project.current_summary || project.description}</p>
          )}

          {/* 下一步（点击可引用到聊天） */}
          {nextAction && (
            <button
              className="mt-2 flex items-start gap-2 rounded-lg bg-zinc-800/40 px-2.5 sm:px-3 py-1.5 sm:py-2 w-full text-left hover:bg-zinc-700/50 transition group"
              onClick={(e) => { e.stopPropagation(); onNextActionClick?.(project, nextAction.text) }}
              title="点击引用到对话"
            >
              <ArrowRight className="h-3.5 w-3.5 text-sky-400 mt-0.5 shrink-0 group-hover:text-sky-300" />
              <p className="text-[11px] sm:text-xs text-zinc-300 min-w-0 group-hover:text-zinc-200">{nextAction.text}</p>
            </button>
          )}

          {/* 底部：主维护 bot + 对话按钮 */}
          <div className="mt-2 sm:mt-2.5 flex items-center justify-between gap-2">
            {maintainers.length > 0 ? (
              <div className="flex items-center gap-1 min-w-0 flex-wrap">
                {maintainers.map((m) => (
                  <button
                    key={m.agent_id}
                    onClick={(e) => { e.stopPropagation(); onBotClick(m.agent_id, project) }}
                    className="rounded-full px-2 py-0.5 text-[10px] font-medium bg-sky-500/15 border border-sky-500/30 text-sky-300 hover:bg-sky-500/25 transition truncate max-w-[140px]"
                    title={`与 ${m.name} 对话`}
                  >
                    <Bot className="h-2.5 w-2.5 inline mr-0.5 -mt-px" />{m.name}
                  </button>
                ))}
              </div>
            ) : (
              <span />
            )}

            <button
              onClick={(e) => { e.stopPropagation(); onChat(project) }}
              className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1 sm:py-1.5 text-[10px] sm:text-[11px] font-medium text-sky-400 rounded-lg border border-sky-500/25 bg-sky-500/8 hover:bg-sky-500/15 hover:border-sky-500/40 transition"
            >
              <MessageSquare className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
              对话
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ── Sortable Kanban Section ── */
function SortableKanbanSection({
  title,
  icon,
  projects,
  color,
  onOpenProject,
  onBotClick,
  onChat,
  onNextActionClick,
  onReorder,
}: {
  title: string
  icon: React.ReactNode
  projects: APProject[]
  color: string
  onOpenProject?: (id: string) => void
  onBotClick: (botId: string, project: APProject) => void
  onChat: (p: APProject) => void
  onNextActionClick?: (project: APProject, actionText: string) => void
  onReorder: (activeId: string, overId: string) => void
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 100, tolerance: 15 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (over && active.id !== over.id) {
      onReorder(active.id as string, over.id as string)
    }
  }

  if (projects.length === 0) return null
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 px-1">
        {icon}
        <h2 className={cn("text-xs font-semibold uppercase tracking-wider", color)}>{title}</h2>
        <span className="text-[10px] text-zinc-500 bg-zinc-800/60 rounded-full px-1.5 py-0.5">{projects.length}</span>
      </div>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={projects.map(p => p.id)} strategy={verticalListSortingStrategy}>
          <div className="space-y-2">
            {projects.map(p => (
              <SortableProjectCard key={p.id} project={p} onOpenProject={onOpenProject} onBotClick={onBotClick} onChat={onChat} onNextActionClick={onNextActionClick} />
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  )
}

export function ProjectKanbanTab({ onOpenProject, onOpenBot, agents, onToggleTarget }: ProjectKanbanTabProps) {
  const [projects, setProjects] = useState<APProject[]>([])
  const [loading, setLoading] = useState(true)
  const [chatTarget, setChatTarget] = useState<APProject | null>(null)
  const [filter, setFilter] = useState<FilterId>("all")
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const saveTimer = useRef<ReturnType<typeof setTimeout>>()

  const showToast = useCallback((msg: string, type: 'success' | 'error') => setToast({ msg, type }), [])

  const loadProjects = useCallback(() => {
    setLoading(true)
    fetchAPProjects()
      .then(p => {
        const filtered = p.filter(x => !x.merged_into)
        // Sort by metadata.sort_order (lower = higher priority), then by name
        filtered.sort((a, b) => {
          const aOrder = a.metadata?.sort_order ?? 999
          const bOrder = b.metadata?.sort_order ?? 999
          return aOrder - bOrder || a.name.localeCompare(b.name)
        })
        setProjects(filtered)
      })
      .catch(() => setProjects([]))
      .finally(() => setLoading(false))
  }, [])

  const [refreshMsg, setRefreshMsg] = useState<string | null>(null)

  const handleRefresh = useCallback(async () => {
    if (refreshing) return
    setRefreshing(true)
    setRefreshMsg(null)
    try {
      await triggerDigestRefresh()
      setRefreshMsg('已触发刷新，预计 1-3 分钟后数据更新')
      showToast('🔄 已通知 rabbit 刷新数据', 'success')
      // Auto-reload data after a delay
      setTimeout(async () => {
        await loadProjects()
        setRefreshMsg(null)
      }, 90_000) // 90s later auto-reload
    } catch (e: any) {
      showToast(e?.message ?? '刷新失败', 'error')
    } finally {
      setRefreshing(false)
    }
  }, [refreshing, showToast, loadProjects])

  // Persist sort order with debounce
  const persistSortOrder = useCallback((newProjects: APProject[]) => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      const orders = newProjects.map((p, i) => ({ id: p.id, sort_order: i }))
      updateProjectSortOrder(orders).catch(e => {
        console.error('[sort-order] save failed:', e)
      })
    }, 800)
  }, [])

  // Handle reorder within a section
  const handleReorder = useCallback((activeId: string, overId: string) => {
    setProjects(prev => {
      const oldIndex = prev.findIndex(p => p.id === activeId)
      const newIndex = prev.findIndex(p => p.id === overId)
      if (oldIndex === -1 || newIndex === -1) return prev
      const newProjects = arrayMove(prev, oldIndex, newIndex)
      persistSortOrder(newProjects)
      return newProjects
    })
  }, [persistSortOrder])

  useEffect(() => { loadProjects() }, [loadProjects])
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 2500)
    return () => clearTimeout(t)
  }, [toast])

  // 按 id 或 mm_username 查找 agent
  const findAgent = useCallback((botId: string) => {
    return agents?.find(a => a.id === botId || a.mm_username === botId)
  }, [agents])

  // 构建项目上下文
  const buildProjectContext = useCallback((project: APProject): ProjectContext => ({
    id: project.id,
    name: project.name,
    emoji: project.emoji,
    description: project.description,
    summary: project.current_summary,
    timeline: project.milestones?.length ? project.milestones : project.recent_events,
    next_actions: project.next_actions,
    status: project.status,
  }), [])

  // Bot 点击 → CommandBar 聊天
  const handleBotClick = useCallback((botId: string, project?: APProject) => {
    const agent = findAgent(botId)
    if (agent?.mm_user_id && onToggleTarget) {
      onToggleTarget({
        id: agent.id,
        name: agent.name ?? agent.id,
        emoji: (agent as any)._emoji ?? "🤖",
        user_id: agent.mm_user_id,
        kind: "bot",
        projectContext: project ? buildProjectContext(project) : undefined,
      })
    } else {
      showToast(`未找到 bot: ${botId}`, 'error')
    }
  }, [findAgent, onToggleTarget, showToast, buildProjectContext])

  // 下一步行动点击
  const handleNextActionClick = useCallback((project: APProject, actionText: string) => {
    const primaryBotId = project.responsible_bot || (project as any).primary_bot
    const agent = primaryBotId ? findAgent(primaryBotId) : null
    if (agent?.mm_user_id && onToggleTarget) {
      onToggleTarget({
        id: agent.id,
        name: agent.name ?? agent.id,
        emoji: (agent as any)._emoji ?? "🤖",
        user_id: agent.mm_user_id,
        kind: "bot",
        prefill: actionText,
        projectContext: buildProjectContext(project),
      })
    } else {
      navigator.clipboard.writeText(`[项目: ${project.name}] ${actionText}`).catch(() => {})
      showToast(primaryBotId ? `未找到 bot: ${primaryBotId}` : '该项目无关联 bot', 'error')
    }
  }, [findAgent, onToggleTarget, showToast, buildProjectContext])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-zinc-500">
        <Loader2 className="h-5 w-5 animate-spin mr-2" />加载项目...
      </div>
    )
  }

  const decision = projects.filter(p => needsDecision(p))
  const activeAll = projects.filter(p => !needsDecision(p) && p.status === 'active')
  const active = activeAll.filter(p => isRecentlyActive(p.last_active))
  const idle = activeAll.filter(p => !isRecentlyActive(p.last_active))
  const discovering = projects.filter(p => !needsDecision(p) && p.status === 'discovering')
  const done = projects.filter(p => p.status === 'done' || p.status === 'completed')

  const filters: { id: FilterId; label: string }[] = [
    { id: 'all',      label: `全部 ${projects.length}` },
    { id: 'decision', label: `需决策 ${decision.length}` },
    { id: 'active',   label: `进行中 ${active.length + discovering.length}` },
    { id: 'done',     label: `已完成 ${done.length}` },
  ]

  const showDecision = filter === 'all' || filter === 'decision'
  const showActive = filter === 'all' || filter === 'active'
  const showDone = filter === 'all' || filter === 'done'

  return (
    <div className="space-y-3 sm:space-y-4">
      {/* 过滤栏 + 刷新 */}
      <div className="flex items-center gap-1 sm:gap-1.5 flex-wrap">
        {filters.map(f => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            className={cn(
              "px-2 sm:px-3 py-1 sm:py-1.5 text-[11px] sm:text-xs font-medium rounded-lg border transition",
              filter === f.id
                ? "bg-zinc-700/60 border-zinc-600 text-zinc-100"
                : "bg-transparent border-zinc-800 text-zinc-500 hover:text-zinc-300 hover:border-zinc-700"
            )}
          >
            {f.label}
          </button>
        ))}
        <div className="flex-1" />
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className={cn(
            "flex items-center gap-1 sm:gap-1.5 px-2 sm:px-3 py-1 sm:py-1.5 text-[11px] sm:text-xs font-medium rounded-lg border transition",
            refreshing
              ? "bg-zinc-800/60 border-zinc-700 text-zinc-500 cursor-not-allowed"
              : "bg-transparent border-zinc-800 text-zinc-400 hover:text-zinc-200 hover:border-zinc-600 hover:bg-zinc-800/40"
          )}
        >
          <RefreshCw className={cn("h-3 w-3 sm:h-3.5 sm:w-3.5", refreshing && "animate-spin")} />
          <span className="hidden sm:inline">{refreshing ? "刷新中…" : "刷新数据"}</span>
        </button>
      </div>

      {refreshMsg && (
        <div className="flex items-center gap-2 rounded-lg border border-sky-500/20 bg-sky-500/5 px-3 py-2 text-xs text-sky-300">
          <RefreshCw className="h-3.5 w-3.5 animate-spin shrink-0" />
          {refreshMsg}
        </div>
      )}

      {showDecision && <SortableKanbanSection title="需要决策" icon={<AlertTriangle className="h-4 w-4 text-rose-400" />} projects={decision} color="text-rose-400" onOpenProject={onOpenProject} onBotClick={handleBotClick} onChat={setChatTarget} onNextActionClick={handleNextActionClick} onReorder={handleReorder} />}
      {showActive && <SortableKanbanSection title="进行中" icon={<div className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />} projects={active} color="text-emerald-400" onOpenProject={onOpenProject} onBotClick={handleBotClick} onChat={setChatTarget} onNextActionClick={handleNextActionClick} onReorder={handleReorder} />}
      {showActive && discovering.length > 0 && <SortableKanbanSection title="探索中" icon={<Search className="h-3.5 w-3.5 text-sky-400" />} projects={discovering} color="text-sky-400" onOpenProject={onOpenProject} onBotClick={handleBotClick} onChat={setChatTarget} onNextActionClick={handleNextActionClick} onReorder={handleReorder} />}
      {showActive && idle.length > 0 && <SortableKanbanSection title="空闲" icon={<div className="h-2 w-2 rounded-full bg-zinc-400" />} projects={idle} color="text-zinc-400" onOpenProject={onOpenProject} onBotClick={handleBotClick} onChat={setChatTarget} onNextActionClick={handleNextActionClick} onReorder={handleReorder} />}
      {showDone && <SortableKanbanSection title="已完成" icon={<div className="h-2 w-2 rounded-full bg-violet-500" />} projects={done} color="text-violet-400" onOpenProject={onOpenProject} onBotClick={handleBotClick} onChat={setChatTarget} onNextActionClick={handleNextActionClick} onReorder={handleReorder} />}

      {projects.length === 0 && <div className="text-center py-16 text-zinc-500 text-sm">暂无项目数据</div>}

      {chatTarget && (
        <ProjectChatDialog
          project={chatTarget}
          onClose={() => setChatTarget(null)}
          onSent={() => showToast('已发送给 rabbit', 'success')}
        />
      )}

      {toast && <Toast message={toast.msg} type={toast.type} onDone={() => setToast(null)} />}
    </div>
  )
}
