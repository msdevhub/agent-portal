import { useCallback, useEffect, useState } from "react"
import {
  AlertTriangle,
  ArrowLeft,
  Calendar,
  CheckCircle2,
  ChevronDown,
  Circle,
  ExternalLink,
  FileText,
  GitMerge,
  Loader2,
  Save,
  Tag,
  Users,
} from "lucide-react"

import {
  fetchAPProject,
  fetchAPProjects,
  mergeAPProject,
  updateAPProject,
  type APProject,
} from "@/lib/api"
import { cn } from "@/lib/utils"
import { MM_TO_AGENT_ID, AGENT_ID_TO_MM } from "@/pages/DashboardPage"

/* ═══════════════════ Constants ═══════════════════ */

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string; dot: string }> = {
  active:      { label: "Active",      color: "text-emerald-400", bg: "bg-emerald-500/15 border-emerald-500/30", dot: "bg-emerald-400" },
  blocked:     { label: "Blocked",     color: "text-red-400",     bg: "bg-red-500/15 border-red-500/30",         dot: "bg-red-400" },
  discovering: { label: "Discovering", color: "text-blue-400",    bg: "bg-blue-500/15 border-blue-500/30",       dot: "bg-blue-400" },
  dormant:     { label: "Dormant",     color: "text-amber-400",   bg: "bg-amber-500/15 border-amber-500/30",     dot: "bg-amber-400" },
  done:        { label: "Done",        color: "text-zinc-400",    bg: "bg-zinc-500/15 border-zinc-500/30",       dot: "bg-zinc-400" },
  dismissed:   { label: "Dismissed",   color: "text-zinc-500",    bg: "bg-zinc-600/15 border-zinc-600/30",       dot: "bg-zinc-500" },
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

interface APProjectDetailPageProps {
  projectId: string
  onBack: () => void
  onOpenBot?: (agentId: string) => void
}

export function APProjectDetailPage({ projectId, onBack, onOpenBot }: APProjectDetailPageProps) {
  const [project, setProject] = useState<APProject | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [editNotes, setEditNotes] = useState<string | null>(null)
  const [showMergeModal, setShowMergeModal] = useState(false)
  const [statusDropdownOpen, setStatusDropdownOpen] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await fetchAPProject(projectId)
      setProject(data)
      setEditNotes(null)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => { void load() }, [load])

  const handleStatusChange = async (newStatus: string) => {
    if (!project) return
    setStatusDropdownOpen(false)
    try {
      setSaving(true)
      await updateAPProject(project.id, { status: newStatus })
      setProject(p => p ? { ...p, status: newStatus as APProject["status"] } : p)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  const handleSaveNotes = async () => {
    if (!project || editNotes === null) return
    try {
      setSaving(true)
      await updateAPProject(project.id, { user_notes: editNotes })
      setProject(p => p ? { ...p, user_notes: editNotes } : p)
      setEditNotes(null)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-10">
        <button onClick={onBack} className="mb-6 inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-300">
          <ArrowLeft className="h-4 w-4" /> 返回
        </button>
        <div className="flex items-center justify-center py-20 text-zinc-500">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span className="ml-2 text-sm">加载中...</span>
        </div>
      </div>
    )
  }

  if (error || !project) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-10">
        <button onClick={onBack} className="mb-6 inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-300">
          <ArrowLeft className="h-4 w-4" /> 返回
        </button>
        <div className="flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          <AlertTriangle className="h-4 w-4" />
          {error || "项目不存在"}
        </div>
      </div>
    )
  }

  const cfg = STATUS_CONFIG[project.status] ?? STATUS_CONFIG.active
  const milestones = Array.isArray(project.milestones) ? [...project.milestones].sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "")) : []
  const nextActions = Array.isArray(project.next_actions) ? project.next_actions : []
  const deliverables = Array.isArray(project.deliverables) ? project.deliverables : []
  const bots = project.involved_bots ?? []

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:py-10">
      {/* Back button */}
      <button onClick={onBack} className="mb-5 inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-300 transition">
        <ArrowLeft className="h-4 w-4" /> 返回项目列表
      </button>

      {/* Header */}
      <div className="mb-6 space-y-3">
        <div className="flex flex-wrap items-start gap-3">
          <h1 className="min-w-0 flex-1 text-xl font-bold text-zinc-100 sm:text-2xl">
            {project.name}
          </h1>

          {/* Status Dropdown */}
          <div className="relative">
            <button
              onClick={() => setStatusDropdownOpen(o => !o)}
              className={cn("inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold uppercase tracking-wider transition", cfg.bg, cfg.color)}
            >
              {cfg.label}
              <ChevronDown className="h-3 w-3" />
            </button>
            {statusDropdownOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setStatusDropdownOpen(false)} />
                <div className="absolute right-0 top-full z-50 mt-1 w-40 rounded-lg border border-zinc-700 bg-zinc-900 py-1 shadow-xl">
                  {Object.entries(STATUS_CONFIG).map(([k, v]) => (
                    <button
                      key={k}
                      onClick={() => handleStatusChange(k)}
                      className={cn(
                        "flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-zinc-800",
                        project.status === k ? "text-zinc-100 font-medium" : "text-zinc-400"
                      )}
                    >
                      <span className={cn("h-2 w-2 rounded-full", v.dot)} />
                      {v.label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Merge button */}
          <button
            onClick={() => setShowMergeModal(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-1.5 text-xs font-medium text-zinc-400 hover:border-zinc-600 hover:text-zinc-300 transition"
          >
            <GitMerge className="h-3.5 w-3.5" />
            合并
          </button>
        </div>

        {/* Description */}
        {project.description && (
          <p className="text-sm text-zinc-400">{project.description}</p>
        )}

        {/* Tags */}
        {project.tags && project.tags.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <Tag className="h-3.5 w-3.5 text-zinc-600" />
            {project.tags.map(t => (
              <span key={t} className="rounded-md bg-zinc-800 px-2 py-0.5 text-[11px] text-zinc-400">{t}</span>
            ))}
          </div>
        )}

        {/* Meta row */}
        <div className="flex flex-wrap items-center gap-4 text-xs text-zinc-500">
          {project.first_seen && (
            <span className="inline-flex items-center gap-1">
              <Calendar className="h-3 w-3" />
              首次: {project.first_seen}
            </span>
          )}
          {project.last_active && (
            <span className="inline-flex items-center gap-1">
              <Calendar className="h-3 w-3" />
              最近: {project.last_active}
            </span>
          )}
          {project.auto_generated && (
            <span className="rounded bg-blue-500/10 px-1.5 py-0.5 text-[10px] text-blue-400">自动创建</span>
          )}
        </div>
      </div>

      {/* ═══ Artifacts ═══ */}
      <ArtifactsSection metadata={project.metadata} />

      <div className="grid gap-5 lg:grid-cols-[1fr_300px]">
        {/* Main content */}
        <div className="space-y-5">
          {/* Involved Bots */}
          {bots.length > 0 && (
            <Section title="参与 Bot" icon={<Users className="h-4 w-4" />}>
              <div className="flex flex-wrap gap-2">
                {bots.map(b => {
                  // Resolve: involved_bots may store mm_username or agent_id
                  const resolvedId = MM_TO_AGENT_ID[b] ?? b
                  return (
                    <button
                      key={b}
                      onClick={() => onOpenBot?.(resolvedId)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900/50 px-3 py-1.5 text-xs text-zinc-300 transition hover:border-emerald-500/30 hover:text-emerald-300"
                    >
                      <span>{BOT_EMOJI[b] ?? BOT_EMOJI[resolvedId] ?? "🤖"}</span>
                      <span>{b}</span>
                      {b === project.primary_bot && (
                        <span className="rounded bg-emerald-500/15 px-1 py-0.5 text-[9px] text-emerald-400">主</span>
                      )}
                    </button>
                  )
                })}
              </div>
            </Section>
          )}

          {/* Milestones Timeline */}
          <Section title="里程碑" icon={<Calendar className="h-4 w-4" />} count={milestones.length}>
            {milestones.length === 0 ? (
              <EmptyHint>暂无里程碑</EmptyHint>
            ) : (
              <div className="relative space-y-0 pl-4">
                {/* Timeline line */}
                <div className="absolute left-[7px] top-1 bottom-1 w-px bg-zinc-800" />
                {milestones.map((ms, i) => (
                  <div key={i} className="relative pb-4 last:pb-0">
                    {/* Dot */}
                    <div className="absolute -left-4 top-1 h-2 w-2 rounded-full border border-zinc-700 bg-zinc-900" />
                    <div className="flex items-baseline gap-2">
                      <span className="shrink-0 text-[11px] font-medium text-zinc-500">{ms.date}</span>
                      {ms.bot && (
                        <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-500">
                          {BOT_EMOJI[ms.bot] ?? "🤖"}{ms.bot}
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-sm text-zinc-300">{ms.event}</p>
                  </div>
                ))}
              </div>
            )}
          </Section>

          {/* Next Actions */}
          <Section title="下一步行动" icon={<CheckCircle2 className="h-4 w-4" />} count={nextActions.length}>
            {nextActions.length === 0 ? (
              <EmptyHint>暂无行动项</EmptyHint>
            ) : (
              <div className="space-y-1.5">
                {nextActions.map((action, i) => (
                  <div key={i} className="flex items-start gap-2.5 rounded-lg px-2 py-1.5">
                    {action.done
                      ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />
                      : <Circle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-zinc-600" />
                    }
                    <span className={cn("text-sm", action.done ? "text-zinc-500 line-through" : "text-zinc-300")}>
                      {action.text}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Section>
        </div>

        {/* Sidebar */}
        <div className="space-y-5">
          {/* Deliverables */}
          <Section title="产出物" icon={<FileText className="h-4 w-4" />} count={deliverables.length}>
            {deliverables.length === 0 ? (
              <EmptyHint>暂无产出</EmptyHint>
            ) : (
              <div className="space-y-1.5">
                {deliverables.map((d, i) => (
                  <div key={i} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm">
                    <FileText className="h-3.5 w-3.5 shrink-0 text-zinc-600" />
                    {d.url ? (
                      <a href={d.url} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300 transition inline-flex items-center gap-1">
                        {d.name}
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    ) : (
                      <span className="text-zinc-300">{d.name}</span>
                    )}
                    {d.type && (
                      <span className="ml-auto rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-500">{d.type}</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Section>

          {/* Notes */}
          <Section title="备注" icon={<FileText className="h-4 w-4" />}>
            {editNotes !== null ? (
              <div className="space-y-2">
                <textarea
                  value={editNotes}
                  onChange={e => setEditNotes(e.target.value)}
                  rows={4}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-emerald-500/40 focus:outline-none resize-none"
                  placeholder="添加备注..."
                />
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleSaveNotes}
                    disabled={saving}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500 transition disabled:opacity-50"
                  >
                    <Save className="h-3 w-3" />
                    保存
                  </button>
                  <button
                    onClick={() => setEditNotes(null)}
                    className="text-xs text-zinc-500 hover:text-zinc-300"
                  >
                    取消
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setEditNotes(project.user_notes ?? "")}
                className="w-full text-left"
              >
                {project.user_notes ? (
                  <p className="text-sm text-zinc-400 hover:text-zinc-300 transition">{project.user_notes}</p>
                ) : (
                  <EmptyHint>点击添加备注</EmptyHint>
                )}
              </button>
            )}
          </Section>
        </div>
      </div>

      {/* Saving indicator */}
      {saving && (
        <div className="fixed bottom-4 right-4 z-50 flex items-center gap-2 rounded-lg bg-zinc-800 px-3 py-2 text-xs text-zinc-300 shadow-lg border border-zinc-700">
          <Loader2 className="h-3 w-3 animate-spin" />
          保存中...
        </div>
      )}

      {/* Merge Modal */}
      {showMergeModal && (
        <MergeModal
          projectId={project.id}
          projectName={project.name}
          onClose={() => setShowMergeModal(false)}
          onMerged={() => { setShowMergeModal(false); onBack() }}
        />
      )}
    </div>
  )
}

/* ═══════════════════ Artifacts ═══════════════════ */

const ARTIFACT_ICON: Record<string, string> = {
  url: "🔗", deploy: "🖥️", repo: "📂", stack: "🛠️", db: "🗄️", cron: "⏰", info: "ℹ️",
}

interface ArtifactItem {
  type: string
  label: string
  value: string
}

function ArtifactsSection({ metadata }: { metadata?: Record<string, unknown> }) {
  if (!metadata) return null
  const raw = metadata.artifacts
  if (!raw || !Array.isArray(raw) || raw.length === 0) return null

  const artifacts = raw as ArtifactItem[]

  return (
    <div className="mb-5 rounded-xl border border-zinc-800/80 bg-[#18181b] overflow-hidden">
      <div className="flex items-center gap-2 border-b border-zinc-800/60 px-4 py-2.5">
        <span className="text-sm">📦</span>
        <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">产出物</span>
        <span className="rounded-full bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-500">{artifacts.length}</span>
      </div>
      <div className="px-4 py-3 grid gap-1.5 sm:grid-cols-2">
        {artifacts.map((a, i) => (
          <div key={i} className="flex items-center gap-2.5 rounded-lg bg-zinc-900/50 px-3 py-2 text-sm">
            <span className="shrink-0 text-base">{ARTIFACT_ICON[a.type] ?? "📎"}</span>
            <span className="shrink-0 text-zinc-500">{a.label}</span>
            {a.type === "url" ? (
              <a
                href={a.value}
                target="_blank"
                rel="noopener noreferrer"
                className="min-w-0 truncate text-blue-400 hover:text-blue-300 transition inline-flex items-center gap-1"
              >
                {a.value.replace(/^https?:\/\//, "")}
                <ExternalLink className="h-3 w-3 shrink-0" />
              </a>
            ) : (
              <span className="min-w-0 truncate text-zinc-300">{a.value}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

/* ═══════════════════ Sub-components ═══════════════════ */

function Section({ title, icon, count, children }: { title: string; icon?: React.ReactNode; count?: number; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-zinc-800/80 bg-[#18181b] overflow-hidden">
      <div className="flex items-center gap-2 border-b border-zinc-800/60 px-4 py-2.5">
        {icon && <span className="text-zinc-500">{icon}</span>}
        <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">{title}</span>
        {count !== undefined && count > 0 && (
          <span className="rounded-full bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-500">{count}</span>
        )}
      </div>
      <div className="px-4 py-3">{children}</div>
    </div>
  )
}

function EmptyHint({ children }: { children: React.ReactNode }) {
  return <p className="py-2 text-center text-xs text-zinc-600">{children}</p>
}

function MergeModal({ projectId, projectName, onClose, onMerged }: { projectId: string; projectName: string; onClose: () => void; onMerged: () => void }) {
  const [targets, setTargets] = useState<APProject[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [merging, setMerging] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      try {
        const all = await fetchAPProjects()
        setTargets(all.filter(p => p.id !== projectId))
      } catch (e: any) {
        setError(e.message)
      } finally {
        setLoading(false)
      }
    })()
  }, [projectId])

  const handleMerge = async () => {
    if (!selectedId) return
    setMerging(true)
    setError(null)
    try {
      await mergeAPProject(projectId, selectedId)
      onMerged()
    } catch (e: any) {
      setError(e.message)
      setMerging(false)
    }
  }

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed inset-x-4 top-1/2 z-50 mx-auto max-w-md -translate-y-1/2 rounded-xl border border-zinc-700 bg-zinc-900 p-5 shadow-2xl">
        <h2 className="text-base font-semibold text-zinc-100">合并项目</h2>
        <p className="mt-1 text-xs text-zinc-500">
          将 <span className="text-zinc-300">{projectName}</span> 的里程碑合并到目标项目，当前项目将标记为 dismissed。
        </p>

        {error && (
          <div className="mt-3 flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
            <AlertTriangle className="h-3 w-3" />
            {error}
          </div>
        )}

        <div className="mt-4 max-h-60 space-y-1.5 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-8 text-zinc-500">
              <Loader2 className="h-4 w-4 animate-spin" />
            </div>
          ) : targets.length === 0 ? (
            <p className="py-4 text-center text-xs text-zinc-500">没有可合并的目标项目</p>
          ) : (
            targets.map(t => {
              const tcfg = STATUS_CONFIG[t.status] ?? STATUS_CONFIG.active
              return (
                <button
                  key={t.id}
                  onClick={() => setSelectedId(t.id)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition",
                    selectedId === t.id
                      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
                      : "border-zinc-800 bg-zinc-800/30 text-zinc-300 hover:border-zinc-700"
                  )}
                >
                  <span className={cn("h-2 w-2 shrink-0 rounded-full", tcfg.dot)} />
                  <span className="min-w-0 flex-1 truncate">{t.name}</span>
                  <span className="text-[10px] text-zinc-500">{tcfg.label}</span>
                </button>
              )
            })
          )}
        </div>

        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-lg border border-zinc-700 px-4 py-1.5 text-xs text-zinc-400 hover:text-zinc-300 transition"
          >
            取消
          </button>
          <button
            onClick={handleMerge}
            disabled={!selectedId || merging}
            className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-red-500 transition disabled:opacity-50"
          >
            <GitMerge className="h-3 w-3" />
            {merging ? "合并中..." : "确认合并"}
          </button>
        </div>
      </div>
    </>
  )
}
