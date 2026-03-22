import { useEffect, useRef, useState } from "react"
import type { ComponentProps, ReactNode } from "react"
import {
  AlertTriangle,
  Archive,
  CheckCircle2,
  Code,
  Database,
  Edit3,
  ExternalLink,
  FileText,
  FlaskConical,
  Image,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Save,
  X,
  type LucideIcon,
} from "lucide-react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"

import { Progress } from "@/components/ui/progress"
import {
  createProject,
  fetchDocFile,
  fetchWorkspaceFile,
  saveDocFile,
  saveWorkspaceFile,
} from "@/lib/api"
import type { Artifact, Project, Stats, TimelineEvent, WorkspaceFile } from "@/lib/api"
import { STATUS_LABELS, STAGES, getArtifactTypeLabel, getStageIndex, getStageLabel } from "@/lib/constants"
import { cn } from "@/lib/utils"

export type Route = { page: "home" } | { page: "projects" } | { page: "project"; slug: string }
export type MarkdownSource = { type: "workspace" } | { type: "doc"; slug: string }

export interface MarkdownPreviewTarget {
  title: string
  path: string
  source: MarkdownSource
}

export interface VisibleTimelineEvent {
  event: TimelineEvent
  mergedCount: number
}

interface MarkdownModalProps {
  title: string
  filePath: string
  source: MarkdownSource
  onClose: () => void
  onError: (error: unknown) => void
}

export const inputClassName = "h-9 w-full rounded-lg border border-zinc-700 bg-[#111113] px-3 text-sm text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-emerald-400/40 sm:h-10 sm:rounded-xl"
export const textareaClassName = "min-h-[88px] w-full resize-none rounded-lg border border-zinc-700 bg-[#111113] px-3 py-2 text-sm text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-emerald-400/40 sm:min-h-[100px] sm:rounded-xl"
export const ghostActionButtonClassName = "inline-flex h-8 w-auto self-start items-center justify-center gap-1.5 rounded-lg px-1.5 text-sm font-medium text-zinc-300 transition hover:bg-zinc-800/60 hover:text-zinc-100"

export function SectionHeading({
  title,
  subtitle,
  className,
  subtitleClassName,
}: {
  title: string
  subtitle?: string
  className?: string
  subtitleClassName?: string
}) {
  return (
    <div className={cn("space-y-1", className)}>
      <h2 className="text-base font-semibold text-zinc-50 sm:text-lg">{title}</h2>
      {subtitle && <p className={cn("text-sm text-zinc-500", subtitleClassName)}>{subtitle}</p>}
    </div>
  )
}

export function CompactStatsBar({ stats }: { stats: Stats }) {
  return (
    <div className="rounded-2xl border border-zinc-800/80 bg-[#111113] px-3 py-3">
      <div className="grid grid-cols-4 gap-2">
        <CompactTopStat label="项目" value={stats.total} />
        <CompactTopStat label="进行中" value={stats.active} valueClassName="text-emerald-300" />
        <CompactTopStat label="完成" value={stats.completed} valueClassName="text-cyan-300" />
        <CompactTopStat label="任务" value={`${stats.tasksDone}/${stats.tasks}`} valueClassName="text-amber-300" />
      </div>
    </div>
  )
}

function CompactTopStat({
  label,
  value,
  valueClassName,
}: {
  label: string
  value: string | number
  valueClassName?: string
}) {
  return (
    <div className="text-center">
      <div className={cn("text-sm font-semibold text-zinc-100", valueClassName)}>{value}</div>
      <div className="mt-1 text-[10px] tracking-[0.18em] text-zinc-500">{label}</div>
    </div>
  )
}

export function StatCard({
  label,
  value,
  tone,
}: {
  label: string
  value: string | number
  tone: "zinc" | "emerald" | "cyan" | "amber"
}) {
  const toneClassName = {
    zinc: "text-zinc-100",
    emerald: "text-emerald-300",
    cyan: "text-cyan-300",
    amber: "text-amber-300",
  }[tone]

  return (
    <div className="rounded-2xl border border-zinc-800/80 bg-[#111113] px-4 py-3">
      <div className="text-[11px] tracking-[0.2em] text-zinc-500">{label}</div>
      <div className={cn("mt-2 text-xl font-semibold", toneClassName)}>{value}</div>
    </div>
  )
}

export function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { icon: LucideIcon; label: string; className: string }> = {
    active: { icon: Play, label: "进行中", className: "bg-emerald-500/10 text-emerald-300" },
    paused: { icon: Pause, label: "已暂停", className: "bg-amber-500/10 text-amber-300" },
    completed: { icon: CheckCircle2, label: "已完成", className: "bg-cyan-500/10 text-cyan-300" },
    archived: { icon: Archive, label: "已归档", className: "bg-zinc-800 text-zinc-400" },
  }
  const current = config[status] || config.active
  const Icon = current.icon

  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium sm:px-3 sm:py-1 sm:text-xs", current.className)}>
      <Icon className="h-3.5 w-3.5" />
      {current.label}
    </span>
  )
}

export function CompactMetric({
  label,
  value,
  tone,
}: {
  label: string
  value: string | number
  tone: "zinc" | "emerald" | "cyan"
}) {
  const toneClassName = {
    zinc: "text-zinc-100",
    emerald: "text-emerald-300",
    cyan: "text-cyan-300",
  }[tone]

  return (
    <div className="rounded-xl border border-zinc-800/80 bg-[#18181b] px-3 py-2.5 sm:rounded-2xl sm:px-4 sm:py-3">
      <div className="text-[11px] tracking-[0.2em] text-zinc-500">{label}</div>
      <div className={cn("mt-1 text-lg font-semibold", toneClassName)}>{value}</div>
    </div>
  )
}

export function CompactInfoCard({
  title,
  value,
  description,
  tone,
}: {
  title: string
  value: string | number
  description: string
  tone: "emerald" | "cyan"
}) {
  const toneClassName = tone === "emerald"
    ? "border-emerald-500/20 bg-emerald-500/6 text-emerald-200"
    : "border-cyan-500/20 bg-cyan-500/6 text-cyan-200"
  const valueClassName = tone === "emerald" ? "text-emerald-300" : "text-cyan-300"

  return (
    <div className={cn("rounded-xl border p-3 sm:rounded-2xl sm:p-4", toneClassName)}>
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="text-sm font-medium">{title}</div>
          <div className={cn("text-2xl font-semibold", valueClassName)}>{value}</div>
        </div>
        <div className="rounded-full bg-black/20 px-2 py-1 text-[11px] text-zinc-300">数量</div>
      </div>
      <p className="mt-2 text-xs leading-5 text-zinc-500">{description}</p>
    </div>
  )
}

export function ProgressSummary({
  progress,
  label,
  showPercentage = true,
}: {
  progress: number
  label: string
  showPercentage?: boolean
}) {
  return (
    <div className="min-w-0 flex-1 rounded-xl border border-zinc-800/80 bg-[#18181b] px-3 py-2.5 sm:rounded-2xl sm:px-4 sm:py-3">
      <div className="flex items-center justify-between gap-3 text-xs">
        <span className="text-zinc-500">{label}</span>
        {showPercentage && <span className="font-medium text-zinc-100">{progress}%</span>}
      </div>
      <Progress value={progress} className="mt-2 h-1 bg-zinc-900 [&>div]:bg-emerald-500 sm:h-2" />
    </div>
  )
}

export function SurfaceCard({ className, ...props }: ComponentProps<"div">) {
  return (
    <div className={cn("rounded-2xl border border-zinc-800/80 bg-[#18181b] sm:rounded-3xl", className)} {...props} />
  )
}

export function EmptyState({
  icon,
  title,
  message,
  actionLabel,
  onAction,
  compact = false,
}: {
  icon: ReactNode
  title: string
  message: string
  actionLabel?: string
  onAction?: () => void
  compact?: boolean
}) {
  return (
    <div className={cn(
      "rounded-2xl border border-dashed border-zinc-800/80 bg-[#18181b] text-center",
      compact ? "px-4 py-5" : "px-5 py-10"
    )}>
      <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-2xl bg-zinc-900/80 text-zinc-300">
        {icon}
      </div>
      <div className="mt-3 text-sm font-medium text-zinc-100">{title}</div>
      <p className="mx-auto mt-2 max-w-xl text-xs leading-6 text-zinc-500">{message}</p>
      {actionLabel && onAction && (
        <button
          type="button"
          onClick={onAction}
          className="mt-4 inline-flex h-8 items-center gap-1.5 rounded-lg px-1.5 text-sm font-medium text-zinc-300 transition hover:bg-zinc-800/60 hover:text-zinc-100"
        >
          <Plus className="h-4 w-4" />
          {actionLabel}
        </button>
      )}
    </div>
  )
}

export function MobileDisclosure({
  title,
  summary,
  children,
}: {
  title: string
  summary: string
  children: ReactNode
}) {
  return (
    <details className="group rounded-2xl border border-zinc-800/80 bg-[#18181b]">
      <summary className="cursor-pointer list-none px-3 py-2.5">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-zinc-100">{title}</div>
          </div>
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-xs text-zinc-500">{summary}</span>
            <span className="shrink-0 text-xs text-zinc-500 group-open:hidden">展开</span>
            <span className="hidden shrink-0 text-xs text-zinc-500 group-open:inline">收起</span>
          </div>
        </div>
      </summary>
      <div className="border-t border-zinc-800/80 px-3 py-3">{children}</div>
    </details>
  )
}

export function LabeledSelect({
  label,
  value,
  onChange,
  options,
  hideLabel = false,
  className,
  selectClassName,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  options: Array<{ value: string; label: string }>
  hideLabel?: boolean
  className?: string
  selectClassName?: string
}) {
  return (
    <label className={cn("space-y-1.5 sm:space-y-2", className)}>
      <span className={cn("text-[11px] tracking-[0.2em] text-zinc-500", hideLabel && "sr-only")}>{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={cn(inputClassName, selectClassName)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </label>
  )
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-2 block text-[11px] tracking-[0.22em] text-zinc-500">{label}</span>
      {children}
    </label>
  )
}

export function ErrorToast({ message, onClose }: { message: string | null; onClose: () => void }) {
  if (!message) return null

  return (
    <div className="fixed right-4 top-4 z-[70] w-[calc(100%-2rem)] max-w-sm rounded-2xl border border-red-500/30 bg-[#1b1114] p-4 shadow-2xl shadow-black/40">
      <div className="flex items-start gap-3">
        <div className="rounded-xl bg-red-500/10 p-2 text-red-300">
          <AlertTriangle className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-red-200">操作失败</p>
          <p className="mt-1 text-sm leading-6 text-red-100/80">{message}</p>
        </div>
        <button type="button" onClick={onClose} className="rounded-md p-1 text-red-200/70 transition hover:bg-red-500/10 hover:text-red-100">
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}

export function CreateProjectModal({
  onClose,
  onCreated,
  onError,
}: {
  onClose: () => void
  onCreated: () => Promise<void>
  onError: (error: unknown) => void
}) {
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [emoji, setEmoji] = useState("🔬")
  const [stage, setStage] = useState("idea")

  const handleCreate = async () => {
    if (!name.trim()) return

    try {
      await createProject({
        name: name.trim(),
        description: description.trim(),
        emoji: emoji || "🔬",
        stage,
      })
      await onCreated()
    } catch (error) {
      onError(error)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/75 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-[460px] rounded-xl border border-zinc-800/80 bg-[#18181b] p-4 shadow-2xl shadow-black/40 sm:rounded-2xl sm:p-6">
        <div className="mb-4 flex items-center gap-3 sm:mb-5">
          <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-2.5 text-emerald-300 sm:rounded-2xl sm:p-3">
            <FlaskConical className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-zinc-50">新建研究项目</h2>
            <p className="text-sm text-zinc-500">创建后从详情页维护任务、产出物、上下文和时间线。</p>
          </div>
        </div>

        <div className="space-y-3 sm:space-y-4">
          <Field label="项目名称">
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void handleCreate()
              }}
              placeholder="例如：多智能体检索增强研究"
              className={inputClassName}
              autoFocus
            />
          </Field>

          <Field label="项目描述">
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="描述研究目标、边界和预期输出"
              className={textareaClassName}
            />
          </Field>

          <div className="grid gap-3 sm:grid-cols-[110px_minmax(0,1fr)] sm:gap-4">
            <Field label="图标">
              <input
                value={emoji}
                onChange={(event) => setEmoji(event.target.value)}
                className={inputClassName}
              />
            </Field>

            <Field label="初始阶段">
              <select value={stage} onChange={(event) => setStage(event.target.value)} className={inputClassName}>
                {STAGES.map((item) => (
                  <option key={item.id} value={item.id}>{item.icon} {item.label}</option>
                ))}
              </select>
            </Field>
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2 sm:mt-6 sm:gap-3">
          <button type="button" onClick={onClose} className="rounded-xl px-4 py-2 text-sm text-zinc-500 transition hover:text-zinc-200">
            取消
          </button>
          <button
            type="button"
            onClick={() => void handleCreate()}
            className="inline-flex h-10 items-center rounded-xl border border-zinc-700 bg-[#111113] px-4 text-sm font-medium text-zinc-100 transition hover:border-emerald-400/40 hover:bg-[#17171b] hover:text-emerald-200"
          >
            创建项目
          </button>
        </div>
      </div>
    </div>
  )
}

export function MarkdownModal({ title, filePath, source, onClose, onError }: MarkdownModalProps) {
  const [content, setContent] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [editContent, setEditContent] = useState("")
  const [saving, setSaving] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    void (async () => {
      try {
        setContent(null)
        setEditing(false)
        const text = source.type === "workspace"
          ? await fetchWorkspaceFile(filePath)
          : await fetchDocFile(source.slug, filePath)
        setContent(text)
        setEditContent(text)
      } catch (error) {
        onError(error)
      }
    })()
  }, [filePath, onError, source])

  const handleSave = async () => {
    setSaving(true)
    try {
      if (source.type === "workspace") {
        await saveWorkspaceFile(filePath, editContent)
      } else {
        await saveDocFile(source.slug, filePath, editContent)
      }
      setContent(editContent)
      setEditing(false)
    } catch (error) {
      onError(error)
    } finally {
      setSaving(false)
    }
  }

  const handleEdit = () => {
    setEditContent(content || "")
    setEditing(true)
    window.setTimeout(() => textareaRef.current?.focus(), 50)
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-0 sm:p-4">
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={onClose} />
      <div className="relative flex h-[100dvh] w-full max-w-5xl flex-col overflow-hidden border border-zinc-800/80 bg-[#111113] shadow-2xl shadow-black/50 sm:h-[90vh] sm:rounded-xl lg:rounded-2xl">
        <div className="flex h-12 items-center justify-between gap-2 border-b border-zinc-800/80 bg-[#18181b] px-2.5 sm:h-auto sm:px-5 sm:py-4">
          <div className="flex min-w-0 items-center gap-2.5 sm:gap-3">
            <FileText className="h-4 w-4 shrink-0 text-cyan-300 sm:h-5 sm:w-5" />
            <div className="min-w-0">
              <h3 className="truncate text-xs font-semibold text-zinc-50 sm:text-base">{title}</h3>
              <p className="hidden text-xs text-zinc-500 sm:block">{filePath}</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 sm:gap-2">
            {!editing ? (
              <button
                type="button"
                onClick={handleEdit}
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-700 bg-[#111113] text-xs font-medium text-zinc-100 transition hover:border-emerald-400/40 hover:text-emerald-200 sm:h-9 sm:w-auto sm:gap-1.5 sm:px-3"
              >
                <Edit3 className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">编辑</span>
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setEditing(false)
                    setEditContent(content || "")
                  }}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-xs text-zinc-400 transition hover:bg-zinc-800/60 hover:text-zinc-200 sm:h-9 sm:w-auto sm:px-3 sm:py-2"
                >
                  <RotateCcw className="h-3.5 w-3.5 sm:hidden" />
                  <span className="hidden sm:inline">取消</span>
                </button>
                <button
                  type="button"
                  onClick={() => void handleSave()}
                  disabled={saving}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-700 bg-[#111113] text-xs font-medium text-zinc-100 transition hover:border-emerald-400/40 hover:text-emerald-200 disabled:opacity-50 sm:h-9 sm:w-auto sm:gap-1.5 sm:px-3"
                >
                  <Save className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">{saving ? "保存中..." : "保存"}</span>
                </button>
              </>
            )}
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg p-1.5 text-zinc-500 transition hover:bg-zinc-800/60 hover:text-zinc-200 sm:h-auto sm:w-auto sm:p-2"
            >
              <X className="h-4 w-4 sm:h-5 sm:w-5" />
            </button>
          </div>
        </div>

        <div className="custom-scrollbar flex-1 overflow-y-auto">
          {content === null ? (
            <div className="flex items-center justify-center py-20 text-sm text-zinc-500">加载中...</div>
          ) : editing ? (
            <textarea
              ref={textareaRef}
              value={editContent}
              onChange={(event) => setEditContent(event.target.value)}
              className="h-full w-full resize-none bg-transparent px-4 py-4 font-mono text-sm leading-6 text-zinc-200 outline-none sm:px-6 sm:py-5 sm:leading-7"
              spellCheck={false}
            />
          ) : (
            <div className="prose prose-invert prose-sm max-w-none px-4 py-4 prose-headings:text-zinc-100 prose-p:text-zinc-300 prose-p:leading-6 prose-a:text-cyan-300 prose-strong:text-zinc-100 prose-code:rounded prose-code:bg-zinc-800/50 prose-code:px-1.5 prose-code:py-0.5 prose-code:text-emerald-300 prose-pre:border prose-pre:border-zinc-800/60 prose-pre:bg-[#09090b] prose-li:text-zinc-300 prose-th:text-zinc-200 prose-td:text-zinc-300 prose-hr:border-zinc-800 sm:px-6 sm:py-5 sm:prose-p:leading-7">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export function useHashRoute() {
  const [route, setRoute] = useState<Route>(() => parseHashRoute(window.location.hash))

  useEffect(() => {
    const handleHashChange = () => {
      setRoute(parseHashRoute(window.location.hash))
    }

    window.addEventListener("hashchange", handleHashChange)
    return () => window.removeEventListener("hashchange", handleHashChange)
  }, [])

  return route
}

export function navigateToRoute(route: Route) {
  let nextHash: string
  if (route.page === "home") nextHash = "#/"
  else if (route.page === "projects") nextHash = "#/projects"
  else nextHash = `#/project/${encodeURIComponent(route.slug)}`
  if (window.location.hash === nextHash) return
  window.location.hash = nextHash
}

function parseHashRoute(hash: string): Route {
  const normalized = hash.replace(/^#/, "") || "/"
  if (normalized === "/" || normalized === "") return { page: "home" }
  if (normalized === "/projects") return { page: "projects" }
  const match = normalized.match(/^\/project\/(.+)$/)
  if (match) {
    return { page: "project", slug: decodeURIComponent(match[1]) }
  }

  return { page: "home" }
}

export function getProjectProgress(project: Project) {
  const stageIndex = getStageIndex(project.stage)
  if (project.status === "completed") return 100
  return Math.max(0, Math.round(((stageIndex + 1) / STAGES.length) * 100))
}

export function getArtifactVisual(type: Artifact["type"]) {
  switch (type) {
    case "doc":
      return {
        icon: FileText,
        iconClassName: "text-blue-400",
        containerClassName: "bg-blue-500/10 text-blue-400",
      }
    case "code":
      return {
        icon: Code,
        iconClassName: "text-amber-400",
        containerClassName: "bg-amber-500/10 text-amber-400",
      }
    case "data":
      return {
        icon: Database,
        iconClassName: "text-purple-400",
        containerClassName: "bg-purple-500/10 text-purple-400",
      }
    case "link":
      return {
        icon: ExternalLink,
        iconClassName: "text-emerald-400",
        containerClassName: "bg-emerald-500/10 text-emerald-400",
      }
    case "image":
      return {
        icon: Image,
        iconClassName: "text-pink-400",
        containerClassName: "bg-pink-500/10 text-pink-400",
      }
    default:
      return {
        icon: FileText,
        iconClassName: "text-blue-400",
        containerClassName: "bg-blue-500/10 text-blue-400",
      }
  }
}

export function getArtifactMobileMeta(artifact: Artifact) {
  return [
    getArtifactTypeLabel(artifact.type),
    artifact.url ? "链接" : "未附链接",
    formatDateTime(artifact.created_at, "date"),
  ].join(" · ")
}

function getTimelineAppearance(eventType: string) {
  switch (eventType) {
    case "stage_change":
      return { dotClassName: "bg-emerald-400" }
    case "status_change":
      return { dotClassName: "bg-cyan-400" }
    case "task_done":
      return { dotClassName: "bg-emerald-400" }
    case "artifact_added":
      return { dotClassName: "bg-amber-400" }
    case "note_added":
      return { dotClassName: "bg-violet-400" }
    case "workspace_sync":
      return { dotClassName: "bg-sky-400" }
    default:
      return { dotClassName: "bg-zinc-500" }
  }
}

export function getTimelineDotClassName(eventType: string) {
  return getTimelineAppearance(eventType).dotClassName
}

export function getVisibleTimelineEvents(events: TimelineEvent[]): VisibleTimelineEvent[] {
  const visibleEvents: VisibleTimelineEvent[] = []

  for (let index = 0; index < events.length; index += 1) {
    const current = events[index]
    if (current.event_type !== "workspace_sync") {
      visibleEvents.push({ event: current, mergedCount: 0 })
      continue
    }

    const block = [current]
    while (index + 1 < events.length && events[index + 1].event_type === "workspace_sync") {
      block.push(events[index + 1])
      index += 1
    }

    const latestEvent = block.reduce((latest, event) => (
      new Date(event.created_at).getTime() > new Date(latest.created_at).getTime() ? event : latest
    ), block[0])

    visibleEvents.push({
      event: latestEvent,
      mergedCount: block.length - 1,
    })
  }

  return visibleEvents
}

export function getTimelineSummary(event: TimelineEvent, mergedCount = 0) {
  const metadata = event.metadata && typeof event.metadata === "object" ? event.metadata : null
  const from = metadata && typeof metadata.from === "string" ? metadata.from : null
  const to = metadata && typeof metadata.to === "string" ? metadata.to : null
  const title = metadata ? getTimelineMetadataTitle(metadata) : null
  const fallback = truncateInlineText(event.description || event.event_type, 120)

  if (event.event_type === "workspace_sync") {
    return mergedCount > 0 ? `${fallback} · 还有 ${mergedCount} 条同步记录` : fallback
  }

  if (event.event_type === "stage_change" && (from || to)) {
    return `阶段从「${getStageLabel(from || "未设置")}」切换到「${getStageLabel(to || "未设置")}」`
  }

  if (event.event_type === "status_change" && (from || to)) {
    return `状态从「${STATUS_LABELS[from || "未设置"] || from || "未设置"}」切换到「${STATUS_LABELS[to || "未设置"] || to || "未设置"}」`
  }

  if (event.event_type === "task_done" && title) {
    return `任务完成：${title}`
  }

  if (event.event_type === "artifact_added" && title) {
    return `新增产出物：${title}`
  }

  if (event.event_type === "note_added") {
    return title ? `新增笔记：${title}` : fallback
  }

  return fallback
}

function getTimelineMetadataTitle(metadata: Record<string, unknown>) {
  const candidates = [
    metadata.title,
    metadata.task_title,
    metadata.artifact_title,
    metadata.note_title,
    metadata.name,
    metadata.target,
  ]

  const value = candidates.find((item) => typeof item === "string" && item.trim())
  return typeof value === "string" ? truncateInlineText(value, 64) : null
}

export function isAutoLoadedContextFile(file: WorkspaceFile) {
  return !file.path.includes("/") && file.name.toLowerCase().endsWith(".md")
}

export function isBehaviorRuleFile(name: string) {
  return ["SOUL.md", "AGENTS.md", "TOOLS.md", "IDENTITY.md"].includes(name)
}

export function getMarkdownTargetFromArtifactUrl(artifact: Artifact): MarkdownPreviewTarget | null {
  if (!artifact.url) return null

  try {
    const parsed = new URL(artifact.url, window.location.origin)
    const match = parsed.pathname.match(/^\/api\/doc\/([^/]+)\/(.+)$/)
    if (match) {
      return {
        title: artifact.title,
        path: decodeURIComponent(match[2]),
        source: { type: "doc", slug: decodeURIComponent(match[1]) },
      }
    }
  } catch {
    // Ignore parse errors and fall back to file:// support.
  }

  const workspacePrefix = "file:///home/resley/.openclaw/workspace-research/projects/"
  if (artifact.url.startsWith(workspacePrefix) && artifact.url.endsWith(".md")) {
    const rest = artifact.url.slice(workspacePrefix.length)
    const slashIndex = rest.indexOf("/")
    if (slashIndex > 0) {
      const slug = rest.slice(0, slashIndex)
      const path = rest.slice(slashIndex + 1)
      return {
        title: artifact.title,
        path,
        source: { type: "doc", slug },
      }
    }
  }

  return null
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  return `${(bytes / 1024).toFixed(1)}KB`
}

export function formatDateTime(value: string, mode: "date" | "datetime" | "timeline" = "datetime") {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value

  if (mode === "timeline") {
    const month = `${date.getMonth() + 1}`.padStart(2, "0")
    const day = `${date.getDate()}`.padStart(2, "0")
    const hour = `${date.getHours()}`.padStart(2, "0")
    const minute = `${date.getMinutes()}`.padStart(2, "0")
    return `${month}/${day} ${hour}:${minute}`
  }

  return date.toLocaleString("zh-CN", mode === "date"
    ? { year: "numeric", month: "2-digit", day: "2-digit" }
    : {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
}

export function formatFileSize(size: number) {
  if (size < 1024) return `${size}B`
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))}KB`
  return `${(size / (1024 * 1024)).toFixed(1)}MB`
}

export function getErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === "string") return error
  return "发生未知错误"
}

export function stripMarkdown(text: string): string {
  return text
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/`(.+?)`/g, "$1")
    .replace(/\[(.+?)\]\(.+?\)/g, "$1")
    .replace(/!\[.*?\]\(.+?\)/g, "")
    .replace(/^[-*+]\s+/gm, "")
    .replace(/^\d+\.\s+/gm, "")
    .replace(/^>\s+/gm, "")
    .replace(/---+/g, "")
    .replace(/\n{2,}/g, " ")
    .trim()
}

export function truncateInlineText(value: string, maxLength: number) {
  const normalized = value.replace(/\s+/g, " ").trim()
  if (normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, maxLength)}...`
}
