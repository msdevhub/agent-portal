import { FlaskConical, Plus } from "lucide-react"

import { UserMenu } from "@/components/auth/UserMenu"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import {
  CompactStatsBar,
  MobileDisclosure,
  SectionHeading,
  StatCard,
  StatusBadge,
  formatDateTime,
  getProjectProgress,
  truncateInlineText,
} from "@/components/portal/shared"
import type { Project, Stats } from "@/lib/api"
import { STAGES } from "@/lib/constants"
import { cn } from "@/lib/utils"

interface RecentNotePreview {
  id: string
  content: string
  created_at: string
  projectName: string
}

interface HomePageProps {
  stats: Stats
  projects: Project[]
  recentNotes: RecentNotePreview[]
  loading: boolean
  onCreateProject: () => void
  onOpenProject: (slug: string) => void
}

export function HomePage({
  stats,
  projects,
  recentNotes,
  loading,
  onCreateProject,
  onOpenProject,
}: HomePageProps) {
  const stageSummary = STAGES
    .map((stage) => `${stage.icon}${projects.filter((project) => project.stage === stage.id).length}`)
    .join(" ")
  const pendingTasks = Math.max(stats.tasks - stats.tasksDone, 0)
  const latestNotePreview = recentNotes[0] ? truncateInlineText(recentNotes[0].content, 20) : "暂无笔记"

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-4 px-4 py-5 sm:gap-8 sm:px-6 sm:py-8 lg:px-8 lg:py-10">
      <header className="flex flex-col gap-4 sm:gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-1.5 sm:space-y-2">
          <div className="flex items-center justify-between gap-3">
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-50 sm:text-4xl">研究项目首页</h1>
            <UserMenu />
          </div>
          <p className="hidden max-w-2xl text-sm leading-6 text-zinc-400 sm:block">
            项目列表和全局统计分开处理。移动端优先暴露项目列表，次要统计折叠到下面。
          </p>
        </div>

        <div className="flex flex-col gap-3 sm:items-end">
          <div className="sm:hidden">
            <CompactStatsBar stats={stats} />
          </div>
          <div className="hidden grid-cols-4 gap-3 sm:grid">
            <StatCard label="项目" value={stats.total} tone="zinc" />
            <StatCard label="进行中" value={stats.active} tone="emerald" />
            <StatCard label="已完成" value={stats.completed} tone="cyan" />
            <StatCard label="任务完成" value={`${stats.tasksDone}/${stats.tasks}`} tone="amber" />
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
      </header>

      <div className="grid gap-4 sm:gap-8 xl:grid-cols-[minmax(0,1.45fr)_340px]">
        <section className="space-y-3 sm:space-y-5">
          <SectionHeading
            title="项目列表"
            subtitle="卡片只保留项目名称、状态、当前阶段和进度。点击整张卡片进入独立详情页。"
            subtitleClassName="hidden sm:block"
          />

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
                <p className="mt-2 hidden text-sm text-zinc-500 sm:block">先创建一个项目，再从详情页维护任务、产出物、上下文和时间线。</p>
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
          <div className="space-y-3 sm:space-y-4">
            <SectionHeading title="阶段概览" subtitle="按项目看当前所处阶段。" />
            <StageOverviewList projects={projects} />
          </div>

          <div className="space-y-3 sm:space-y-4">
            <SectionHeading title="任务执行" subtitle="只保留整体任务完成进度和基础计数。" />
            <TaskExecutionCard stats={stats} />
          </div>

          <div className="space-y-3 sm:space-y-4">
            <SectionHeading title="最近笔记" subtitle="最近 5 条跨项目笔记。" />
            <RecentNotesCard notes={recentNotes} />
          </div>
        </aside>
      </div>
    </main>
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
            <span className="text-zinc-500">任务完成率</span>
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
                  <span>{formatDateTime(note.created_at, "date")}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function MiniStat({
  label,
  value,
  accentClassName,
}: {
  label: string
  value: string | number
  accentClassName?: string
}) {
  return (
    <div>
      <div className="text-[10px] tracking-[0.18em] text-zinc-500">{label}</div>
      <div className={cn("mt-1 text-lg font-semibold text-zinc-100", accentClassName)}>{value}</div>
    </div>
  )
}
