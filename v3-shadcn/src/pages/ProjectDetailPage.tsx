import { useEffect, useState } from "react"
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  Bot,
  Brain,
  CheckCircle2,
  Circle,
  Clock,
  Edit3,
  ExternalLink,
  Eye,
  Pencil,
  Plus,
  ScrollText,
  Trash2,
} from "lucide-react"

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import { Card, CardContent } from "@/components/ui/card"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  CompactInfoCard,
  CompactMetric,
  EmptyState,
  LabeledSelect,
  MarkdownModal,
  ProgressSummary,
  SectionHeading,
  SurfaceCard,
  formatBytes,
  formatDateTime,
  formatFileSize,
  getArtifactMobileMeta,
  getArtifactVisual,
  getMarkdownTargetFromArtifactUrl,
  getProjectProgress,
  getTimelineDotClassName,
  getTimelineSummary,
  getVisibleTimelineEvents,
  ghostActionButtonClassName,
  inputClassName,
  isAutoLoadedContextFile,
  isBehaviorRuleFile,
  textareaClassName,
  type MarkdownPreviewTarget,
} from "@/components/portal/shared"
import {
  createArtifact,
  createNote,
  createTask,
  deleteArtifact,
  deleteTask,
  fetchContextFiles,
  fetchMemoryFiles,
  fetchModelContext,
  updateProject,
  updateTask,
} from "@/lib/api"
import type { Artifact, ModelContextResponse, Project, Task, WorkspaceFile } from "@/lib/api"
import { ARTIFACT_TYPES, NOTE_TYPES, STAGES, STATUS_LABELS, getArtifactTypeLabel, getStageIndex } from "@/lib/constants"
import { cn } from "@/lib/utils"

interface ProjectDetailPageProps {
  project: Project | null
  loading: boolean
  onBack: () => void
  onRefresh: (slug: string) => Promise<void>
  onError: (error: unknown) => void
}

export function ProjectDetailPage({
  project,
  loading,
  onBack,
  onRefresh,
  onError,
}: ProjectDetailPageProps) {
  const [activeTab, setActiveTab] = useState("tasks")
  const [addingTask, setAddingTask] = useState(false)
  const [newTaskTitle, setNewTaskTitle] = useState("")
  const [newTaskStage, setNewTaskStage] = useState("")
  const [addingArtifact, setAddingArtifact] = useState(false)
  const [artifactStage, setArtifactStage] = useState("")
  const [artifactTitle, setArtifactTitle] = useState("")
  const [artifactType, setArtifactType] = useState<Artifact["type"]>("doc")
  const [artifactUrl, setArtifactUrl] = useState("")
  const [artifactDescription, setArtifactDescription] = useState("")
  const [selectedArtifactStage, setSelectedArtifactStage] = useState("")
  const [openTaskStage, setOpenTaskStage] = useState<string | null>(null)
  const [addingNote, setAddingNote] = useState(false)
  const [newNoteContent, setNewNoteContent] = useState("")
  const [newNoteType, setNewNoteType] = useState("finding")
  const [markdownTarget, setMarkdownTarget] = useState<MarkdownPreviewTarget | null>(null)
  const [contextFiles, setContextFiles] = useState<WorkspaceFile[]>([])
  const [memoryFiles, setMemoryFiles] = useState<WorkspaceFile[]>([])
  const [modelContext, setModelContext] = useState<ModelContextResponse | null>(null)
  const [projectEditorOpen, setProjectEditorOpen] = useState(false)
  const [projectEditorSaving, setProjectEditorSaving] = useState(false)
  const [draftStatus, setDraftStatus] = useState<Project["status"]>("active")
  const [draftStage, setDraftStage] = useState("")
  const [draftDescription, setDraftDescription] = useState("")

  useEffect(() => {
    if (!project) return

    void (async () => {
      try {
        const [nextContextFiles, nextMemoryFiles] = await Promise.all([
          fetchContextFiles(),
          fetchMemoryFiles(),
        ])
        setContextFiles(nextContextFiles)
        setMemoryFiles(nextMemoryFiles)
      } catch (error) {
        onError(error)
      }

      try {
        const nextModelContext = await fetchModelContext(project.slug)
        setModelContext(nextModelContext)
      } catch {
        // Optional panel, ignore fetch failures.
      }
    })()
  }, [onError, project])

  useEffect(() => {
    if (!project) return

    setActiveTab("tasks")
    setAddingTask(false)
    setNewTaskTitle("")
    setNewTaskStage(project.stage)
    setAddingArtifact(false)
    setArtifactStage(project.stage)
    setArtifactTitle("")
    setArtifactType("doc")
    setArtifactUrl("")
    setArtifactDescription("")
    setSelectedArtifactStage(project.stage)
    setAddingNote(false)
    setNewNoteContent("")
    setNewNoteType("finding")
    setProjectEditorOpen(false)
    setProjectEditorSaving(false)
    setDraftStatus(project.status)
    setDraftStage(project.stage)
    setDraftDescription(project.description || "")

    const stagesWithTasks = STAGES
      .map((stage) => ({ stageId: stage.id, tasks: (project.tasks || []).filter((task) => task.stage === stage.id) }))
      .filter((group) => group.tasks.length > 0)
    const defaultTaskStage = stagesWithTasks.find((group) => group.stageId === project.stage)?.stageId
      || stagesWithTasks[0]?.stageId
      || null
    setOpenTaskStage(defaultTaskStage)
  }, [project])

  if (loading) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-7xl items-center justify-center px-4 py-12 sm:px-6 lg:px-8">
        <Card className="w-full max-w-2xl border-zinc-800/80 bg-[#18181b] shadow-none">
          <CardContent className="px-6 py-16 text-center text-sm text-zinc-500">
            正在加载项目详情...
          </CardContent>
        </Card>
      </main>
    )
  }

  if (!project) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-7xl items-center justify-center px-4 py-12 sm:px-6 lg:px-8">
        <Card className="w-full max-w-2xl border-zinc-800/80 bg-[#18181b] shadow-none">
          <CardContent className="flex flex-col items-center px-6 py-16 text-center">
            <AlertTriangle className="mb-4 h-10 w-10 text-amber-400" />
            <p className="text-base text-zinc-100">项目详情不可用</p>
            <p className="mt-2 text-sm text-zinc-500">项目可能不存在，或者接口返回了错误。</p>
            <button
              type="button"
              onClick={onBack}
              className="mt-5 inline-flex h-10 items-center gap-2 rounded-xl border border-zinc-700 bg-[#111113] px-4 text-sm font-medium text-zinc-100 transition hover:border-emerald-400/40 hover:bg-[#17171b] hover:text-emerald-200"
            >
              <ArrowLeft className="h-4 w-4" />
              返回首页
            </button>
          </CardContent>
        </Card>
      </main>
    )
  }

  const stageIndex = getStageIndex(project.stage)
  const stage = STAGES[stageIndex] || STAGES[0]
  const progress = getProjectProgress(project)
  const tasks = project.tasks || []
  const artifacts = project.artifacts || []
  const tasksDone = tasks.filter((task) => task.status === "done").length
  const taskCompletion = tasks.length > 0 ? Math.round((tasksDone / tasks.length) * 100) : 0
  const artifactStageGroups = STAGES
    .map((item) => ({ stage: item, artifacts: artifacts.filter((artifact) => artifact.stage === item.id) }))
    .filter((group) => group.artifacts.length > 0 || group.stage.id === project.stage)
  const activeArtifactStage = artifactStageGroups.find((group) => group.stage.id === selectedArtifactStage)?.stage
    || artifactStageGroups[0]?.stage
    || stage
  const activeArtifacts = artifacts.filter((artifact) => artifact.stage === activeArtifactStage.id)
  const autoLoadedFiles = contextFiles.filter(isAutoLoadedContextFile)
  const visibleTimeline = getVisibleTimelineEvents(project.timeline || [])

  const openProjectEditor = () => {
    setDraftStatus(project.status)
    setDraftStage(project.stage)
    setDraftDescription(project.description || "")
    setProjectEditorOpen(true)
  }

  const handleSaveProjectMeta = async () => {
    setProjectEditorSaving(true)
    try {
      await updateProject(project.id, {
        status: draftStatus,
        stage: draftStage,
        description: draftDescription.trim(),
      })
      setProjectEditorOpen(false)
      await onRefresh(project.slug)
    } catch (error) {
      onError(error)
    } finally {
      setProjectEditorSaving(false)
    }
  }

  const handleToggleTask = async (task: Task) => {
    try {
      await updateTask(task.id, { status: task.status === "done" ? "pending" : "done" })
      await onRefresh(project.slug)
    } catch (error) {
      onError(error)
    }
  }

  const handleDeleteTask = async (taskId: string) => {
    try {
      await deleteTask(taskId)
      await onRefresh(project.slug)
    } catch (error) {
      onError(error)
    }
  }

  const handleAddTask = async () => {
    if (!newTaskTitle.trim()) return

    try {
      await createTask({
        project_id: project.id,
        title: newTaskTitle.trim(),
        stage: newTaskStage || project.stage,
      })
      setNewTaskTitle("")
      setAddingTask(false)
      await onRefresh(project.slug)
    } catch (error) {
      onError(error)
    }
  }

  const handleAddArtifact = async () => {
    if (!artifactTitle.trim()) return

    try {
      await createArtifact({
        project_id: project.id,
        stage: artifactStage || project.stage,
        title: artifactTitle.trim(),
        type: artifactType,
        url: artifactUrl.trim(),
        description: artifactDescription.trim(),
      })
      setArtifactTitle("")
      setArtifactUrl("")
      setArtifactDescription("")
      setArtifactType("doc")
      setAddingArtifact(false)
      await onRefresh(project.slug)
    } catch (error) {
      onError(error)
    }
  }

  const handleDeleteArtifact = async (artifactId: string) => {
    try {
      await deleteArtifact(artifactId)
      await onRefresh(project.slug)
    } catch (error) {
      onError(error)
    }
  }

  const handleAddNote = async () => {
    if (!newNoteContent.trim()) return

    try {
      await createNote({
        project_id: project.id,
        content: newNoteContent.trim(),
        type: newNoteType,
      })
      setNewNoteContent("")
      setAddingNote(false)
      await onRefresh(project.slug)
    } catch (error) {
      onError(error)
    }
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-4 px-4 py-5 sm:gap-8 sm:px-6 sm:py-8 lg:px-8 lg:py-10">
      <header className="sticky top-0 z-20 rounded-xl border border-zinc-800/80 bg-[#111113]/90 px-3 py-2 backdrop-blur sm:rounded-3xl sm:px-5 sm:py-4">
        <div className="flex flex-col gap-2.5 sm:gap-4">
          <div className="min-w-0 space-y-2 sm:space-y-3">
            <div className="flex items-center">
              <button
                type="button"
                onClick={onBack}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg px-1 text-sm text-zinc-400 transition hover:bg-zinc-800/60 hover:text-zinc-100"
                aria-label="返回"
              >
                <ArrowLeft className="h-4 w-4" />
                <span>Agent Portal</span>
              </button>
            </div>
            <div className="space-y-1.5 sm:space-y-2">
              <h1 className="truncate text-2xl font-semibold tracking-tight text-zinc-50 sm:text-4xl">{project.name}</h1>
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-zinc-400 sm:text-sm">
                  <span>{STATUS_LABELS[project.status] || project.status}</span>
                  <span className="text-zinc-600">·</span>
                  <span>{stage.icon} {stage.label}</span>
                  <span className="text-zinc-600">·</span>
                  <span>{tasksDone}/{tasks.length} 已完成</span>
                </div>
                <button
                  type="button"
                  onClick={openProjectEditor}
                  className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-zinc-800/80 bg-[#18181b] text-zinc-400 transition hover:border-zinc-700 hover:text-zinc-100"
                  aria-label="编辑项目"
                >
                  <Pencil className="h-4 w-4" />
                </button>
              </div>
              <p className="max-w-3xl line-clamp-1 text-sm text-zinc-500">
                {project.description || "暂无项目说明。"}
              </p>
            </div>
            <div className="hidden gap-3 sm:grid sm:grid-cols-3">
              <CompactMetric label="当前阶段" value={`${stage.icon} ${stage.label}`} tone="zinc" />
              <CompactMetric label="项目进度" value={`${progress}%`} tone="emerald" />
              <CompactMetric label="任务完成" value={`${tasksDone}/${tasks.length}`} tone="cyan" />
            </div>
          </div>
        </div>
      </header>

      <div className="space-y-3 sm:space-y-6">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="tasks">任务</TabsTrigger>
            <TabsTrigger value="artifacts">产出物</TabsTrigger>
            <TabsTrigger value="context">上下文</TabsTrigger>
            <TabsTrigger value="timeline">时间线</TabsTrigger>
          </TabsList>

          <TabsContent value="tasks" className="space-y-3 sm:space-y-6">
            <SectionHeading
              className="hidden sm:block"
              title="阶段任务"
              subtitle="按阶段分组。空阶段不渲染，默认只展开当前阶段或第一个有任务的阶段。"
            />

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <ProgressSummary progress={taskCompletion} label={`${tasksDone}/${tasks.length} 已完成`} showPercentage={false} />
              <button
                type="button"
                onClick={() => {
                  setAddingTask((value) => !value)
                  setNewTaskStage(project.stage)
                }}
                className={ghostActionButtonClassName}
              >
                <Plus className="h-4 w-4" />
                添加任务
              </button>
            </div>

            {addingTask && (
              <SurfaceCard className="space-y-3 p-3 sm:space-y-4 sm:p-5">
                <input
                  value={newTaskTitle}
                  onChange={(event) => setNewTaskTitle(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void handleAddTask()
                  }}
                  placeholder="例如：补全文献对比矩阵"
                  className={inputClassName}
                />
                <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-3">
                  <select
                    value={newTaskStage}
                    onChange={(event) => setNewTaskStage(event.target.value)}
                    className={inputClassName}
                  >
                    {STAGES.map((item) => (
                      <option key={item.id} value={item.id}>{item.icon} {item.label}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => void handleAddTask()}
                    className="inline-flex h-9 items-center justify-center rounded-lg border border-zinc-700 bg-[#111113] px-3 text-sm font-medium text-zinc-100 transition hover:border-emerald-400/40 hover:bg-[#17171b] hover:text-emerald-200 sm:h-10 sm:rounded-xl sm:px-4"
                  >
                    保存任务
                  </button>
                </div>
              </SurfaceCard>
            )}

            {tasks.length === 0 ? (
              <EmptyState
                icon={<CheckCircle2 className="h-5 w-5" />}
                title="还没有任务"
                message="先为当前阶段拆出 2 到 5 个明确动作，详情页默认就会展开这一组任务。"
                actionLabel="添加第一条任务"
                onAction={() => {
                  setAddingTask(true)
                  setNewTaskStage(project.stage)
                }}
              />
            ) : (
              <TaskStageAccordion
                project={project}
                openTaskStage={openTaskStage}
                onOpenTaskStageChange={setOpenTaskStage}
                onToggleTask={handleToggleTask}
                onDeleteTask={handleDeleteTask}
              />
            )}
          </TabsContent>

          <TabsContent value="artifacts" className="space-y-3 sm:space-y-6">
            <SectionHeading
              className="hidden sm:block"
              title="产出物"
              subtitle="阶段切换改为可横向滚动的文本标签，文档仍支持页内 Markdown 预览。"
            />

            <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex-1 overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                <div className="inline-flex min-w-full gap-2 sm:min-w-0">
                  {artifactStageGroups.map((group) => (
                    <button
                      key={group.stage.id}
                      type="button"
                      onClick={() => setSelectedArtifactStage(group.stage.id)}
                      className={cn(
                        "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition sm:gap-2 sm:px-4 sm:py-2 sm:text-sm",
                        activeArtifactStage.id === group.stage.id
                          ? "border-cyan-500/40 bg-cyan-500/10 text-cyan-200"
                          : "border-zinc-700 bg-[#111113] text-zinc-300 hover:border-zinc-500 hover:text-zinc-100"
                      )}
                    >
                      <span>{group.stage.label}</span>
                      <span className="rounded-full bg-black/20 px-2 py-0.5 text-xs">{group.artifacts.length}</span>
                    </button>
                  ))}
                </div>
              </div>

              <button
                type="button"
                onClick={() => {
                  setAddingArtifact((value) => !value)
                  setArtifactStage(activeArtifactStage.id)
                }}
                className={ghostActionButtonClassName}
              >
                <Plus className="h-4 w-4" />
                添加产出物
              </button>
            </div>

            {addingArtifact && (
              <SurfaceCard className="space-y-3 p-3 sm:p-5">
                <div className="grid gap-2 md:grid-cols-2 sm:gap-3">
                  <input
                    value={artifactTitle}
                    onChange={(event) => setArtifactTitle(event.target.value)}
                    placeholder="例如：POC 部署地址"
                    className={inputClassName}
                  />
                  <select
                    value={artifactStage}
                    onChange={(event) => setArtifactStage(event.target.value)}
                    className={inputClassName}
                  >
                    {STAGES.map((item) => (
                      <option key={item.id} value={item.id}>{item.icon} {item.label}</option>
                    ))}
                  </select>
                  <select
                    value={artifactType}
                    onChange={(event) => setArtifactType(event.target.value as Artifact["type"])}
                    className={inputClassName}
                  >
                    {ARTIFACT_TYPES.map((item) => (
                      <option key={item.id} value={item.id}>{item.label}</option>
                    ))}
                  </select>
                  <input
                    value={artifactUrl}
                    onChange={(event) => setArtifactUrl(event.target.value)}
                    placeholder="链接地址（可选）"
                    className={inputClassName}
                  />
                </div>
                <textarea
                  value={artifactDescription}
                  onChange={(event) => setArtifactDescription(event.target.value)}
                  placeholder="补充这个产出物的用途、结论或上下文"
                  className={textareaClassName}
                />
                <button
                  type="button"
                  onClick={() => void handleAddArtifact()}
                  className="inline-flex h-9 items-center justify-center rounded-lg border border-zinc-700 bg-[#111113] px-3 text-sm font-medium text-zinc-100 transition hover:border-cyan-400/40 hover:bg-[#17171b] hover:text-cyan-200 sm:h-10 sm:rounded-xl sm:px-4"
                >
                  保存产出物
                </button>
              </SurfaceCard>
            )}

            {activeArtifacts.length === 0 ? (
              <EmptyState
                icon={<ScrollText className="h-5 w-5" />}
                title={`${activeArtifactStage.label} 阶段还没有产出物`}
                message="把文档、代码、数据、图片或外部链接沉淀进来，后续回看才有材料。"
                actionLabel="为这个阶段添加产出物"
                onAction={() => {
                  setAddingArtifact(true)
                  setArtifactStage(activeArtifactStage.id)
                }}
              />
            ) : (
              <div className="space-y-1.5 sm:space-y-3">
                {activeArtifacts.map((artifact) => (
                  <ArtifactRow
                    key={artifact.id}
                    artifact={artifact}
                    onDelete={() => void handleDeleteArtifact(artifact.id)}
                    onPreview={(target) => setMarkdownTarget(target)}
                  />
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="context" className="space-y-3 sm:space-y-6">
            <SectionHeading
              className="hidden sm:block"
              title="上下文"
              subtitle={'保留"自动加载"和"可检索"标记，项目文档只保留 CONTEXT.md 作为单一事实源。'}
            />

            {modelContext && (
              <SurfaceCard className="space-y-3 p-3 sm:p-5">
                <div className="flex items-center gap-2">
                  <Brain className="h-4 w-4 text-violet-400" />
                  <span className="text-sm font-semibold text-zinc-100">模型上下文</span>
                  <span className="ml-auto rounded-full bg-violet-500/10 px-2 py-0.5 text-[11px] font-medium text-violet-300">
                    ~{modelContext.summary.estimatedTokens.toLocaleString()} tokens · {modelContext.summary.usagePercent}%
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-800">
                    <div
                      className="h-full rounded-full bg-violet-500 transition-all"
                      style={{ width: `${Math.min(modelContext.summary.usagePercent, 100)}%` }}
                    />
                  </div>
                  <span className="shrink-0 text-[11px] text-zinc-500">
                    {formatBytes(modelContext.summary.alwaysLoadedBytes)} / {(modelContext.summary.maxTokens / 1000).toFixed(0)}K
                  </span>
                </div>
                <div className="space-y-2">
                  {modelContext.layers.map((layer) => (
                    <div key={layer.layer}>
                      <div className="flex items-center gap-2 py-1">
                        <span className={cn(
                          "h-1.5 w-1.5 rounded-full",
                          layer.layer === "permanent" ? "bg-emerald-400" : layer.layer === "project" ? "bg-cyan-400" : "bg-zinc-500"
                        )} />
                        <span className="text-xs font-medium text-zinc-300">{layer.label}</span>
                        <span className="text-[11px] text-zinc-500">{layer.description}</span>
                      </div>
                      <div className="ml-3.5 space-y-0.5">
                        {layer.files.map((file) => (
                          <div key={file.name} className="flex items-center gap-2 py-0.5 text-[11px]">
                            <span className="min-w-0 flex-1 truncate text-zinc-400">{file.name}</span>
                            <span className="shrink-0 text-zinc-600">{formatBytes(file.size)}</span>
                          </div>
                        ))}
                        {layer.files.length === 0 && (
                          <span className="text-[11px] text-zinc-600">无文件</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </SurfaceCard>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              <CompactInfoCard
                title="自动加载"
                value={autoLoadedFiles.length + 1}
                tone="emerald"
                description="顶层 Markdown 与项目 CONTEXT.md 会直接进入上下文。"
              />
              <CompactInfoCard
                title="可检索"
                value={memoryFiles.length}
                tone="cyan"
                description="`memory/` 里的资料按需召回，不默认全部塞进上下文。"
              />
            </div>

            <SurfaceCard className="space-y-3 p-3 sm:space-y-4 sm:p-5">
              <button
                type="button"
                onClick={() => setMarkdownTarget({
                  title: `${project.name} — CONTEXT.md`,
                  path: "CONTEXT.md",
                  source: { type: "doc", slug: project.slug },
                })}
                className="flex w-full items-start gap-3 rounded-xl border border-violet-500/20 bg-violet-500/6 px-3 py-3 text-left transition hover:bg-violet-500/10 sm:rounded-2xl sm:px-4 sm:py-4"
              >
                <Brain className="mt-0.5 h-5 w-5 shrink-0 text-violet-300" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-violet-200">项目 CONTEXT.md</span>
                    <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] text-emerald-300">自动加载</span>
                  </div>
                  <p className="mt-1 text-xs leading-5 text-zinc-500">项目的单一事实源，保留目标、现状、决策和阻塞。</p>
                </div>
                <Eye className="h-4 w-4 shrink-0 text-zinc-500" />
              </button>

              <div className="grid gap-3 sm:gap-4 lg:grid-cols-2">
                <ContextFileList title="工作区上下文" files={contextFiles} onOpenMarkdown={setMarkdownTarget} />
                <MemoryFileList files={memoryFiles} onOpenMarkdown={setMarkdownTarget} />
              </div>
            </SurfaceCard>

            <SurfaceCard className="space-y-3 p-3 sm:space-y-4 sm:p-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="text-lg font-semibold text-zinc-100">项目笔记</div>
                  <p className="mt-1 text-sm text-zinc-500">保留原来的笔记能力，但并入上下文页签。</p>
                </div>
                <button
                  type="button"
                  onClick={() => setAddingNote((value) => !value)}
                  className={ghostActionButtonClassName}
                >
                  <Plus className="h-4 w-4" />
                  添加笔记
                </button>
              </div>

              {addingNote && (
                <div className="space-y-3 rounded-xl border border-zinc-800/80 bg-[#111113] p-3 sm:rounded-2xl sm:p-4">
                  <select
                    value={newNoteType}
                    onChange={(event) => setNewNoteType(event.target.value)}
                    className={inputClassName}
                  >
                    {NOTE_TYPES.map((item) => (
                      <option key={item.id} value={item.id}>{item.icon} {item.label}</option>
                    ))}
                  </select>
                  <textarea
                    value={newNoteContent}
                    onChange={(event) => setNewNoteContent(event.target.value)}
                    placeholder="例如：文献 A 的实验设置与目标场景不匹配"
                    className={textareaClassName}
                  />
                  <button
                    type="button"
                    onClick={() => void handleAddNote()}
                    className="inline-flex h-9 items-center justify-center rounded-lg border border-zinc-700 bg-[#111113] px-3 text-sm font-medium text-zinc-100 transition hover:border-cyan-400/40 hover:bg-[#17171b] hover:text-cyan-200 sm:h-10 sm:rounded-xl sm:px-4"
                  >
                    保存笔记
                  </button>
                </div>
              )}

              {(project.notes || []).length === 0 ? (
                <EmptyState
                  icon={<Edit3 className="h-5 w-5" />}
                  title="还没有研究笔记"
                  message="把关键发现、决策和阻塞记下来，后续回看项目上下文会清楚很多。"
                  actionLabel="添加第一条笔记"
                  onAction={() => setAddingNote(true)}
                />
              ) : (
                <div className="space-y-3">
                  {(project.notes || []).map((note) => (
                    <NoteCard key={note.id} note={note} />
                  ))}
                </div>
              )}
            </SurfaceCard>
          </TabsContent>

          <TabsContent value="timeline" className="space-y-3 sm:space-y-6">
            <SectionHeading
              className="hidden sm:block"
              title="时间线"
              subtitle="保留垂直线和事件类型图标，按项目演进顺序展示。"
            />

            {(project.timeline || []).length === 0 ? (
              <EmptyState
                icon={<Activity className="h-5 w-5" />}
                title="时间线还没有事件"
                message="状态变更、任务完成、产出物新增和笔记都会沉淀到这里。"
              />
            ) : (
              <div className="space-y-1.5 sm:space-y-2">
                {visibleTimeline.map((item, index) => (
                  <TimelineItem key={item.event.id} item={item} isLast={index === visibleTimeline.length - 1} />
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>

      <footer className="mt-auto flex flex-col gap-2 border-t border-zinc-800/80 pt-5 text-xs text-zinc-500 sm:flex-row sm:items-center sm:justify-between">
        <span>创建于 {formatDateTime(project.created_at, "date")}</span>
        <span>最近更新 {formatDateTime(project.updated_at, "datetime")}</span>
      </footer>

      {markdownTarget && (
        <MarkdownModal
          title={markdownTarget.title}
          filePath={markdownTarget.path}
          source={markdownTarget.source}
          onClose={() => setMarkdownTarget(null)}
          onError={onError}
        />
      )}

      <Dialog open={projectEditorOpen} onOpenChange={setProjectEditorOpen}>
        <DialogContent
          showCloseButton={false}
          className="max-w-[calc(100%-2rem)] border border-zinc-800/80 bg-[#18181b] p-0 text-zinc-100 ring-0 sm:max-w-md"
        >
          <DialogHeader className="border-b border-zinc-800/80 px-4 py-4 sm:px-5">
            <DialogTitle>编辑项目信息</DialogTitle>
            <p className="text-sm text-zinc-500">状态、阶段和完整说明都在这里维护。</p>
          </DialogHeader>

          <div className="space-y-4 px-4 py-4 sm:px-5">
            <LabeledSelect
              label="状态"
              value={draftStatus}
              onChange={(value) => setDraftStatus(value as Project["status"])}
              options={["active", "paused", "completed", "archived"].map((status) => ({
                value: status,
                label: STATUS_LABELS[status],
              }))}
            />
            <LabeledSelect
              label="阶段"
              value={draftStage}
              onChange={setDraftStage}
              options={STAGES.map((item) => ({
                value: item.id,
                label: `${item.icon} ${item.label}`,
              }))}
            />
            <label className="space-y-1.5 sm:space-y-2">
              <span className="text-[11px] tracking-[0.2em] text-zinc-500">项目说明</span>
              <textarea
                value={draftDescription}
                onChange={(event) => setDraftDescription(event.target.value)}
                placeholder="补充当前阶段目标、范围或补充背景"
                className={textareaClassName}
              />
            </label>
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-zinc-800/80 px-4 py-4 sm:px-5">
            <button
              type="button"
              onClick={() => setProjectEditorOpen(false)}
              className="rounded-lg px-3 py-2 text-sm text-zinc-500 transition hover:bg-zinc-800/60 hover:text-zinc-200"
            >
              取消
            </button>
            <button
              type="button"
              onClick={() => void handleSaveProjectMeta()}
              disabled={projectEditorSaving}
              className="inline-flex h-9 items-center justify-center rounded-lg border border-zinc-700 bg-[#111113] px-3 text-sm font-medium text-zinc-100 transition hover:border-emerald-400/40 hover:bg-[#17171b] hover:text-emerald-200 disabled:opacity-50"
            >
              {projectEditorSaving ? "保存中..." : "保存"}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </main>
  )
}

function TaskStageAccordion({
  project,
  openTaskStage,
  onOpenTaskStageChange,
  onToggleTask,
  onDeleteTask,
}: {
  project: Project
  openTaskStage: string | null
  onOpenTaskStageChange: (value: string | null) => void
  onToggleTask: (task: Task) => Promise<void>
  onDeleteTask: (taskId: string) => Promise<void>
}) {
  const [expandedCompletedStages, setExpandedCompletedStages] = useState<Record<string, boolean>>({})
  const stageIndex = getStageIndex(project.stage)
  const visibleGroups = STAGES
    .map((stage, index) => ({
      stage,
      index,
      tasks: (project.tasks || []).filter((task) => task.stage === stage.id),
    }))
    .filter((group) => group.tasks.length > 0)

  useEffect(() => {
    setExpandedCompletedStages({})
  }, [project.id])

  return (
    <Accordion value={openTaskStage} onValueChange={onOpenTaskStageChange} collapsible>
      {visibleGroups.map((group) => {
        const isCurrent = group.stage.id === project.stage
        const isCompleted = project.status === "completed" || group.index < stageIndex
        const activeTasks = group.tasks.filter((task) => task.status !== "done")
        const completedTasks = group.tasks.filter((task) => task.status === "done")
        const completedCount = completedTasks.length
        const completedExpanded = Boolean(expandedCompletedStages[group.stage.id])

        return (
          <AccordionItem
            key={group.stage.id}
            value={group.stage.id}
            className={cn(
              "border-zinc-800/80 bg-[#18181b]",
              isCurrent && "border-emerald-500/30 bg-[#121715]",
              !isCurrent && isCompleted && "bg-[#151518]"
            )}
          >
            <AccordionTrigger className="px-3 py-2 sm:px-5 sm:py-4">
              <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                    <span className={cn(isCurrent ? "text-emerald-200" : "text-zinc-100")}>
                      {group.stage.icon} {group.stage.label}
                    </span>
                    {isCurrent && (
                      <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] text-emerald-300">
                        当前阶段
                      </span>
                    )}
                    {!isCurrent && isCompleted && (
                      <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-[11px] text-zinc-400">
                        已完成阶段
                      </span>
                    )}
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs leading-5 text-zinc-500 sm:line-clamp-none">{group.stage.desc}</p>
                </div>
                <div className="text-left sm:text-right">
                  <div className="text-sm font-medium text-zinc-200">{completedCount}/{group.tasks.length}</div>
                  <div className="text-xs text-zinc-500">已完成任务</div>
                </div>
              </div>
            </AccordionTrigger>
            <AccordionContent className="px-0 py-0">
              {activeTasks.map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  onToggle={() => void onToggleTask(task)}
                  onDelete={() => void onDeleteTask(task.id)}
                />
              ))}
              {completedTasks.length > 0 && (
                <>
                  <button
                    type="button"
                    onClick={() => setExpandedCompletedStages((current) => ({
                      ...current,
                      [group.stage.id]: !current[group.stage.id],
                    }))}
                    className="flex w-full items-center justify-between border-b border-zinc-800/70 px-3 py-2 text-left text-sm text-zinc-400 transition hover:bg-zinc-900/50 hover:text-zinc-200 last:border-b-0 sm:px-4"
                  >
                    <span>✅ {completedTasks.length} 个已完成</span>
                    <span className="text-xs text-zinc-500">{completedExpanded ? "收起" : "展开"}</span>
                  </button>
                  {completedExpanded && completedTasks.map((task) => (
                    <TaskRow
                      key={task.id}
                      task={task}
                      onToggle={() => void onToggleTask(task)}
                      onDelete={() => void onDeleteTask(task.id)}
                    />
                  ))}
                </>
              )}
            </AccordionContent>
          </AccordionItem>
        )
      })}
    </Accordion>
  )
}

function TaskRow({
  task,
  onToggle,
  onDelete,
}: {
  task: Task
  onToggle: () => void
  onDelete: () => void
}) {
  return (
    <div className="group flex items-center gap-2.5 border-b border-zinc-800/70 px-2 py-2 last:border-b-0 sm:px-4 sm:py-3">
      <button type="button" onClick={onToggle} className="shrink-0">
        {task.status === "done" ? (
          <CheckCircle2 className="h-4 w-4 text-emerald-500" />
        ) : task.status === "blocked" ? (
          <AlertTriangle className="h-4 w-4 text-red-400" />
        ) : task.status === "in_progress" ? (
          <Clock className="h-4 w-4 text-amber-400" />
        ) : (
          <Circle className="h-4 w-4 text-zinc-600" />
        )}
      </button>
      <div className="min-w-0 flex-1">
        <div className={cn("text-sm", task.status === "done" ? "text-zinc-500" : "text-zinc-200")}>
          {task.title}
        </div>
        <div className="mt-0.5 text-[11px] text-zinc-600">
          {STATUS_LABELS[task.status] || task.status} · {formatDateTime(task.updated_at, "datetime")}
        </div>
      </div>
      <button
        type="button"
        onClick={onDelete}
        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-zinc-600 transition hover:bg-red-500/10 hover:text-red-400 sm:opacity-0 sm:group-hover:opacity-100"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

function ArtifactRow({
  artifact,
  onDelete,
  onPreview,
}: {
  artifact: Artifact
  onDelete: () => void
  onPreview: (target: MarkdownPreviewTarget) => void
}) {
  const artifactVisual = getArtifactVisual(artifact.type)
  const ArtifactIcon = artifactVisual.icon
  const docTarget = artifact.url ? getMarkdownTargetFromArtifactUrl(artifact) : null

  return (
    <>
      {docTarget ? (
        <button
          type="button"
          onClick={() => onPreview(docTarget)}
          className="flex min-h-14 w-full items-center gap-3 rounded-xl border border-zinc-800/80 bg-[#18181b] px-3 py-2 text-left transition hover:border-zinc-700 active:bg-zinc-800/60 sm:hidden"
        >
          <ArtifactIcon className={cn("h-4 w-4 shrink-0", artifactVisual.iconClassName)} />
          <div className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-zinc-100">{artifact.title}</span>
            <p className="mt-0.5 truncate text-[11px] text-zinc-500">{getArtifactMobileMeta(artifact)}</p>
          </div>
        </button>
      ) : artifact.url ? (
        <a
          href={artifact.url}
          target="_blank"
          rel="noreferrer"
          className="flex min-h-14 w-full items-center gap-3 rounded-xl border border-zinc-800/80 bg-[#18181b] px-3 py-2 text-left transition hover:border-zinc-700 active:bg-zinc-800/60 sm:hidden"
        >
          <ArtifactIcon className={cn("h-4 w-4 shrink-0", artifactVisual.iconClassName)} />
          <div className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-zinc-100">{artifact.title}</span>
            <p className="mt-0.5 truncate text-[11px] text-zinc-500">{getArtifactMobileMeta(artifact)}</p>
          </div>
          <ExternalLink className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
        </a>
      ) : (
        <div className="flex min-h-14 w-full items-center gap-3 rounded-xl border border-zinc-800/80 bg-[#18181b] px-3 py-2 sm:hidden">
          <ArtifactIcon className={cn("h-4 w-4 shrink-0", artifactVisual.iconClassName)} />
          <div className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-zinc-100">{artifact.title}</span>
            <p className="mt-0.5 truncate text-[11px] text-zinc-500">{getArtifactMobileMeta(artifact)}</p>
          </div>
        </div>
      )}

      <SurfaceCard className="group hidden flex-col gap-3 p-3 sm:flex sm:flex-row sm:items-center sm:p-5">
        <div className={cn("inline-flex h-10 w-10 items-center justify-center rounded-2xl", artifactVisual.containerClassName)}>
          <ArtifactIcon className="h-4 w-4" />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {docTarget ? (
              <button
                type="button"
                onClick={() => onPreview(docTarget)}
                className="truncate text-left text-sm font-medium text-zinc-100 transition hover:text-cyan-300"
              >
                {artifact.title}
              </button>
            ) : artifact.url ? (
              <a
                href={artifact.url}
                target="_blank"
                rel="noreferrer"
                className="truncate text-sm font-medium text-zinc-100 transition hover:text-cyan-300"
              >
                {artifact.title}
              </a>
            ) : (
              <span className="truncate text-sm font-medium text-zinc-100">{artifact.title}</span>
            )}
            <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-[11px] text-zinc-400">
              {getArtifactTypeLabel(artifact.type)}
            </span>
            {docTarget && (
              <span className="rounded-full bg-cyan-500/10 px-2 py-0.5 text-[11px] text-cyan-300">
                页面预览
              </span>
            )}
          </div>
          {artifact.description && <p className="mt-2 line-clamp-2 text-xs leading-5 text-zinc-500 sm:line-clamp-none">{artifact.description}</p>}
        </div>

        <div className="flex items-center gap-2 self-end sm:self-center">
          {docTarget ? (
            <button
              type="button"
              onClick={() => onPreview(docTarget)}
              className="inline-flex h-8 items-center gap-1 rounded-lg border border-zinc-700 bg-[#111113] px-2.5 text-xs font-medium text-zinc-100 transition hover:border-cyan-400/40 hover:text-cyan-200 sm:h-9 sm:px-3"
            >
              <Eye className="h-3.5 w-3.5" />
              预览
            </button>
          ) : artifact.url ? (
            <a
              href={artifact.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-8 items-center gap-1 rounded-lg border border-zinc-700 bg-[#111113] px-2.5 text-xs font-medium text-zinc-100 transition hover:border-cyan-400/40 hover:text-cyan-200 sm:h-9 sm:px-3"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              打开
            </a>
          ) : null}

          <button
            type="button"
            onClick={onDelete}
            className="inline-flex h-8 items-center justify-center rounded-lg border border-transparent px-2 text-zinc-500 transition hover:border-red-500/30 hover:bg-red-500/8 hover:text-red-300 sm:h-9 sm:opacity-0 sm:group-hover:opacity-100"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </SurfaceCard>
    </>
  )
}

function ContextFileList({
  title,
  files,
  onOpenMarkdown,
}: {
  title: string
  files: WorkspaceFile[]
  onOpenMarkdown: (target: MarkdownPreviewTarget) => void
}) {
  const contextIcons: Record<string, string> = {
    "SOUL.md": "🧠",
    "AGENTS.md": "🤖",
    "USER.md": "👤",
    "HEARTBEAT.md": "💓",
    "TOOLS.md": "🔧",
    "IDENTITY.md": "🪪",
  }

  return (
    <div className="space-y-3">
      <div>
        <div className="text-sm font-medium text-zinc-200">{title}</div>
        <p className="mt-1 text-xs text-zinc-500">顶层 Markdown 会直接影响 Agent 的行为和上下文。</p>
      </div>

      {files.length === 0 ? (
        <EmptyState
          icon={<Brain className="h-5 w-5" />}
          title="还没有工作区上下文文件"
          message="把全局规则或代理行为说明写成顶层 Markdown 后，这里会自动出现。"
          compact
        />
      ) : (
        <div className="space-y-2">
          {files.map((file) => (
            <button
              key={file.path}
              type="button"
              onClick={() => onOpenMarkdown({
                title: file.name,
                path: file.path,
                source: { type: "workspace" },
              })}
              className="flex w-full items-start gap-3 rounded-xl border border-zinc-800/80 bg-[#111113] px-3 py-2.5 text-left transition hover:border-zinc-700 hover:bg-zinc-900/70 sm:rounded-2xl sm:px-4 sm:py-3"
            >
              <span className="mt-0.5 text-base">{contextIcons[file.name] || "📄"}</span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-sm font-medium text-zinc-100">{file.name}</span>
                  {isAutoLoadedContextFile(file) && (
                    <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] text-emerald-300">
                      自动加载
                    </span>
                  )}
                  {isBehaviorRuleFile(file.name) && (
                    <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-300">
                      行为规则
                    </span>
                  )}
                </div>
                <div className="mt-1 text-[11px] text-zinc-500">{formatFileSize(file.size)} · {file.mtime}</div>
              </div>
              <Eye className="mt-0.5 h-4 w-4 shrink-0 text-zinc-500" />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function MemoryFileList({
  files,
  onOpenMarkdown,
}: {
  files: WorkspaceFile[]
  onOpenMarkdown: (target: MarkdownPreviewTarget) => void
}) {
  return (
    <div className="space-y-3">
      <div>
        <div className="text-sm font-medium text-zinc-200">记忆文件</div>
        <p className="mt-1 text-xs text-zinc-500">这些文件不会默认塞满上下文，但会作为可检索资料被召回。</p>
      </div>

      {files.length === 0 ? (
        <EmptyState
          icon={<Bot className="h-5 w-5" />}
          title="还没有记忆文件"
          message="把经验总结、偏好和长期约束写进 `memory/` 目录。"
          compact
        />
      ) : (
        <div className="space-y-2">
          {files.map((file) => (
            <button
              key={file.path}
              type="button"
              onClick={() => onOpenMarkdown({
                title: `记忆 - ${file.name}`,
                path: file.path,
                source: { type: "workspace" },
              })}
              className="flex w-full items-start gap-3 rounded-xl border border-zinc-800/80 bg-[#111113] px-3 py-2.5 text-left transition hover:border-zinc-700 hover:bg-zinc-900/70 sm:rounded-2xl sm:px-4 sm:py-3"
            >
              <span className="mt-0.5 text-base">📝</span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-sm font-medium text-zinc-100">{file.name}</span>
                  <span className="rounded-full bg-cyan-500/10 px-2 py-0.5 text-[11px] text-cyan-300">
                    可检索
                  </span>
                </div>
                <div className="mt-1 text-[11px] text-zinc-500">{formatFileSize(file.size)} · {file.mtime}</div>
              </div>
              <Eye className="mt-0.5 h-4 w-4 shrink-0 text-zinc-500" />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function NoteCard({ note }: { note: NonNullable<Project["notes"]>[number] }) {
  const noteType = NOTE_TYPES.find((item) => item.id === note.type)

  return (
    <div
      className={cn(
        "rounded-xl border bg-[#111113] p-3 sm:rounded-2xl sm:p-4",
        note.type === "finding" ? "border-cyan-900/40" :
        note.type === "decision" ? "border-emerald-900/40" :
        note.type === "blocker" ? "border-red-900/40" :
        "border-amber-900/40"
      )}
    >
      <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
        <span>{noteType?.icon}</span>
        <span>{noteType?.label}</span>
        <span className="ml-auto">{formatDateTime(note.created_at, "datetime")}</span>
      </div>
      <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-zinc-200">{note.content}</p>
    </div>
  )
}

function TimelineItem({ item, isLast }: { item: ReturnType<typeof getVisibleTimelineEvents>[number]; isLast: boolean }) {
  const summary = getTimelineSummary(item.event, item.mergedCount)

  return (
    <div className="relative pl-5">
      {!isLast && <div className="absolute bottom-0 left-[7px] top-0 border-l-2 border-zinc-700" />}
      <span className={cn("absolute left-1 top-1/2 h-2 w-2 -translate-y-1/2 rounded-full", getTimelineDotClassName(item.event.event_type))} />
      <div className="flex min-w-0 items-center gap-3 rounded-xl border border-zinc-800/80 bg-[#18181b] px-3 py-2">
        <p className="min-w-0 flex-1 truncate text-sm text-zinc-200">
          {summary}
        </p>
        <div className="shrink-0 text-[11px] tabular-nums text-zinc-500">
          {formatDateTime(item.event.created_at, "timeline")}
        </div>
      </div>
    </div>
  )
}
