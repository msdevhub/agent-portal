import { useMemo } from "react"
import { ArrowLeft, CalendarDays, FileText } from "lucide-react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"

import { UserMenu } from "@/components/auth/UserMenu"
import { EmptyState, SectionHeading } from "@/components/portal/shared"
import type { DailyReport } from "@/lib/api"
import { cn } from "@/lib/utils"

interface DailyReportsPageProps {
  reports: DailyReport[]
  selectedReport: DailyReport | null
  loading: boolean
  onBack: () => void
  onSelectDate: (date: string) => void
}

export function DailyReportsPage({ reports, selectedReport, loading, onBack, onSelectDate }: DailyReportsPageProps) {
  const reportDates = useMemo(() => reports.map((report) => report.date), [reports])

  return (
    <main className="min-h-screen px-4 py-5 pb-16 sm:px-6 sm:py-6 lg:px-8 lg:py-8">
      <header className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-3">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-2 text-sm text-zinc-400 transition hover:text-emerald-300"
          >
            <ArrowLeft className="h-4 w-4" />
            返回首页
          </button>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-50 sm:text-3xl">研究日报</h1>
            <p className="mt-1 text-sm text-zinc-500">查看 research agent 每晚生成的 Markdown 日报。</p>
          </div>
        </div>
        <UserMenu />
      </header>

      <div className="grid gap-4 lg:grid-cols-[240px_minmax(0,1fr)]">
        <aside className="rounded-2xl border border-zinc-800/80 bg-[#18181b] p-4 sm:rounded-3xl">
          <SectionHeading title="最近日报" subtitle={`共 ${reportDates.length} 条`} />
          <div className="mt-4 space-y-2">
            {loading && reportDates.length === 0 ? (
              <div className="rounded-xl border border-zinc-800/80 bg-[#111113] px-3 py-4 text-sm text-zinc-500">加载中...</div>
            ) : reportDates.length === 0 ? (
              <EmptyState
                compact
                icon={<CalendarDays className="h-5 w-5" />}
                title="暂无日报"
                message="还没有可展示的研究日报。"
              />
            ) : (
              reportDates.map((date) => {
                const active = selectedReport?.date === date
                return (
                  <button
                    key={date}
                    type="button"
                    onClick={() => onSelectDate(date)}
                    className={cn(
                      "flex w-full items-center justify-between rounded-xl border px-3 py-2.5 text-left text-sm transition",
                      active
                        ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
                        : "border-zinc-800 bg-[#111113] text-zinc-300 hover:border-zinc-700 hover:bg-zinc-800/60 hover:text-zinc-100"
                    )}
                  >
                    <span className="font-medium">{date}</span>
                    <CalendarDays className="h-4 w-4" />
                  </button>
                )
              })
            )}
          </div>
        </aside>

        <section className="rounded-2xl border border-zinc-800/80 bg-[#18181b] p-4 sm:rounded-3xl sm:p-6">
          {selectedReport ? (
            <>
              <div className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800/70 pb-4">
                <div>
                  <div className="text-xs tracking-[0.2em] text-zinc-500">DATE</div>
                  <div className="mt-1 text-xl font-semibold text-zinc-50">{selectedReport.date}</div>
                </div>
                <div className="rounded-full border border-zinc-800 bg-[#111113] px-3 py-1.5 text-xs text-zinc-400">
                  agent: {selectedReport.agent_id || "research"}
                </div>
              </div>
              <div className="prose prose-invert prose-sm max-w-none prose-headings:text-zinc-100 prose-p:text-zinc-300 prose-p:leading-7 prose-a:text-cyan-300 prose-strong:text-zinc-100 prose-code:rounded prose-code:bg-zinc-800/50 prose-code:px-1.5 prose-code:py-0.5 prose-code:text-emerald-300 prose-pre:border prose-pre:border-zinc-800/60 prose-pre:bg-[#09090b] prose-li:text-zinc-300 prose-th:text-zinc-200 prose-td:text-zinc-300 prose-hr:border-zinc-800">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{selectedReport.content}</ReactMarkdown>
              </div>
            </>
          ) : (
            <EmptyState
              icon={<FileText className="h-5 w-5" />}
              title="选择一份日报"
              message="从左侧选择日期后，在这里查看 Markdown 内容。"
            />
          )}
        </section>
      </div>
    </main>
  )
}
