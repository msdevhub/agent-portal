import { useMemo } from "react"
import { Activity, ArrowLeft, Bot, ExternalLink, RefreshCw, Server, Timer } from "lucide-react"

import { UserMenu } from "@/components/auth/UserMenu"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { DashboardAgent, DashboardContainer, DashboardData, ProductionSite } from "@/lib/api"

interface HomePageProps {
  dashboard: DashboardData
  loading: boolean
  refreshing: boolean
  onBackToProjects: () => void
}

export function HomePage({ dashboard, loading, refreshing, onBackToProjects }: HomePageProps) {
  const summary = dashboard.summary ?? {}
  const lastUpdated = dashboard.updated_at ?? summary.timestamp ?? null

  const statusCards = useMemo(() => ([
    {
      title: '生产站点',
      icon: Activity,
      value: `${summary.production?.up ?? dashboard.production_sites.filter((site) => site.status === 200).length}/${summary.production?.total ?? dashboard.production_sites.length}`,
      description: 'up',
      accent: 'text-emerald-300',
    },
    {
      title: '容器',
      icon: Server,
      value: `${summary.containers?.up ?? dashboard.containers.filter((container) => container.running).length}/${summary.containers?.total ?? dashboard.containers.length}`,
      description: 'running',
      accent: 'text-cyan-300',
    },
    {
      title: 'Cron Jobs',
      icon: Timer,
      value: `${summary.crons?.ok ?? 0} ok / ${summary.crons?.error ?? 0} error`,
      description: `${summary.crons?.total ?? dashboard.cron_jobs.length} total`,
      accent: 'text-amber-300',
    },
    {
      title: 'Agent',
      icon: Bot,
      value: `${summary.agents?.total ?? dashboard.agents.length}`,
      description: 'total',
      accent: 'text-violet-300',
    },
  ]), [dashboard.agents.length, dashboard.containers, dashboard.cron_jobs.length, dashboard.production_sites, summary])

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-5 px-4 py-5 sm:gap-8 sm:px-6 sm:py-8 lg:px-8 lg:py-10">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onBackToProjects}
              className="inline-flex items-center gap-2 rounded-xl border border-zinc-800 bg-[#111113] px-3 py-2 text-sm text-zinc-300 transition hover:border-zinc-700 hover:text-zinc-100"
            >
              <ArrowLeft className="h-4 w-4" />
              项目列表
            </button>
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h1 className="text-2xl font-semibold tracking-tight text-zinc-50 sm:text-4xl">系统 Dashboard</h1>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-400">
                  展示生产站点、容器、Cron Jobs 与 Agent 状态，数据来自 Supabase AP_dashboard 表。
                </p>
              </div>
              <UserMenu />
            </div>
            <div className="flex flex-wrap items-center gap-3 text-xs text-zinc-500 sm:text-sm">
              <span>最近更新：{formatDateTime(lastUpdated)}</span>
              {refreshing && (
                <span className="inline-flex items-center gap-1 text-emerald-300">
                  <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                  刷新中
                </span>
              )}
            </div>
          </div>
        </div>
      </header>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {statusCards.map((card) => {
          const Icon = card.icon
          return (
            <Card key={card.title} className="border-zinc-800/80 bg-[#18181b] shadow-none">
              <CardContent className="flex items-center justify-between gap-3 px-5 py-5">
                <div>
                  <p className="text-sm text-zinc-500">{card.title}</p>
                  <p className={`mt-2 text-2xl font-semibold ${card.accent}`}>{card.value}</p>
                  <p className="mt-1 text-xs text-zinc-500">{card.description}</p>
                </div>
                <div className="rounded-2xl border border-zinc-800 bg-[#111113] p-3 text-zinc-300">
                  <Icon className="h-5 w-5" />
                </div>
              </CardContent>
            </Card>
          )
        })}
      </section>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,0.7fr)]">
        <Card className="border-zinc-800/80 bg-[#18181b] shadow-none">
          <CardHeader>
            <CardTitle className="text-zinc-50">生产站点</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {loading && dashboard.production_sites.length === 0 ? (
              <EmptyRow text="加载中..." />
            ) : dashboard.production_sites.length === 0 ? (
              <EmptyRow text="暂无生产站点数据。" />
            ) : (
              dashboard.production_sites.map((site) => <ProductionSiteRow key={`${site.name}-${site.url}`} site={site} />)
            )}
          </CardContent>
        </Card>

        <Card className="border-zinc-800/80 bg-[#18181b] shadow-none">
          <CardHeader>
            <CardTitle className="text-zinc-50">容器列表</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {loading && dashboard.containers.length === 0 ? (
              <EmptyRow text="加载中..." />
            ) : dashboard.containers.length === 0 ? (
              <EmptyRow text="暂无容器数据。" />
            ) : (
              dashboard.containers.map((container) => (
                <div key={container.name} className="rounded-xl border border-zinc-800/80 bg-[#111113] p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-zinc-100">{container.name}</div>
                      <div className="mt-1 text-xs text-zinc-500">{formatPorts(container.ports)}</div>
                    </div>
                    <StatusPill ok={Boolean(container.running)}>{container.status || (container.running ? 'running' : 'stopped')}</StatusPill>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="border-zinc-800/80 bg-[#18181b] shadow-none">
        <CardHeader>
          <CardTitle className="text-zinc-50">Cron Jobs</CardTitle>
        </CardHeader>
        <CardContent>
          {loading && dashboard.cron_jobs.length === 0 ? (
            <EmptyRow text="加载中..." />
          ) : dashboard.cron_jobs.length === 0 ? (
            <EmptyRow text="暂无 Cron Jobs 数据。" />
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-800 text-left text-xs text-zinc-500">
                    <th className="px-3 py-3 font-medium">名称</th>
                    <th className="px-3 py-3 font-medium">Agent</th>
                    <th className="px-3 py-3 font-medium">周期</th>
                    <th className="px-3 py-3 font-medium">模型</th>
                    <th className="px-3 py-3 font-medium">上次状态</th>
                    <th className="px-3 py-3 font-medium">上次时间</th>
                    <th className="px-3 py-3 font-medium">下次时间</th>
                    <th className="px-3 py-3 font-medium text-right">错误次数</th>
                  </tr>
                </thead>
                <tbody>
                  {dashboard.cron_jobs.map((job) => (
                    <tr key={job.id} className="border-b border-zinc-900/80 text-zinc-300 last:border-0">
                      <td className="px-3 py-3 font-medium text-zinc-100">{job.name}</td>
                      <td className="px-3 py-3">{job.agent || '—'}</td>
                      <td className="px-3 py-3">{job.schedule || '—'}</td>
                      <td className="px-3 py-3">{job.model || '—'}</td>
                      <td className="px-3 py-3"><CronStatus status={job.lastStatus} /></td>
                      <td className="px-3 py-3 whitespace-nowrap">{formatDateTime(job.lastRun)}</td>
                      <td className="px-3 py-3 whitespace-nowrap">{formatDateTime(job.nextRun)}</td>
                      <td className="px-3 py-3 text-right">{job.consecutiveErrors ?? 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card className="border-zinc-800/80 bg-[#18181b] shadow-none">
          <CardHeader>
            <CardTitle className="text-zinc-50">Agent 花名册</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {loading && dashboard.agents.length === 0 ? (
              <EmptyRow text="加载中..." />
            ) : dashboard.agents.length === 0 ? (
              <EmptyRow text="暂无 Agent 数据。" />
            ) : (
              dashboard.agents.map((agent) => <AgentRow key={agent.id} agent={agent} />)
            )}
          </CardContent>
        </Card>

        <Card className="border-zinc-800/80 bg-[#18181b] shadow-none">
          <CardHeader>
            <CardTitle className="text-zinc-50">开发服务器</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {loading && dashboard.dev_servers.length === 0 ? (
              <EmptyRow text="加载中..." />
            ) : dashboard.dev_servers.length === 0 ? (
              <EmptyRow text="暂无开发服务器数据。" />
            ) : (
              dashboard.dev_servers.map((server) => (
                <div key={`${server.name}-${server.url}`} className="rounded-xl border border-zinc-800/80 bg-[#111113] p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-zinc-100">{server.name}</div>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                        <span className="truncate">{server.url}</span>
                        {server.port ? <span>:{server.port}</span> : null}
                      </div>
                    </div>
                    <StatusPill ok={server.status === 200}>{server.status}</StatusPill>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  )
}

function ProductionSiteRow({ site }: { site: ProductionSite }) {
  return (
    <div className="rounded-xl border border-zinc-800/80 bg-[#111113] p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-lg">{site.emoji || '🌐'}</span>
            <span className="truncate text-sm font-medium text-zinc-100">{site.name}</span>
          </div>
          <a
            href={site.url}
            target="_blank"
            rel="noreferrer"
            className="mt-1 inline-flex max-w-full items-center gap-1 truncate text-xs text-sky-300 transition hover:text-sky-200"
          >
            <span className="truncate">{site.url}</span>
            <ExternalLink className="h-3.5 w-3.5 shrink-0" />
          </a>
          {site.project ? <div className="mt-1 text-xs text-zinc-500">项目：{site.project}</div> : null}
        </div>
        <StatusPill ok={site.status === 200}>{site.status}</StatusPill>
      </div>
    </div>
  )
}

function AgentRow({ agent }: { agent: DashboardAgent }) {
  return (
    <div className="rounded-xl border border-zinc-800/80 bg-[#111113] p-3">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-zinc-800 bg-[#18181b] text-lg">
          {agent.emoji || '🤖'}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-zinc-100">{agent.name}</div>
          <div className="mt-1 text-xs text-zinc-400">{agent.role || '—'}</div>
          <div className="mt-1 text-xs text-zinc-500">关联项目：{agent.project || '—'}</div>
        </div>
      </div>
    </div>
  )
}

function CronStatus({ status }: { status?: string }) {
  const normalized = String(status || '').toLowerCase()
  const ok = normalized === 'ok' || normalized === 'success' || normalized === 'passed'
  const label = status || '—'
  return <StatusPill ok={ok}>{label}</StatusPill>
}

function StatusPill({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <Badge
      variant="outline"
      className={ok
        ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
        : 'border-rose-500/30 bg-rose-500/10 text-rose-300'}
    >
      {children}
    </Badge>
  )
}

function EmptyRow({ text }: { text: string }) {
  return <div className="rounded-xl border border-dashed border-zinc-800/80 bg-[#111113] px-4 py-8 text-center text-sm text-zinc-500">{text}</div>
}

function formatDateTime(value?: string | null) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function formatPorts(ports?: DashboardContainer['ports']) {
  if (!ports) return '无端口映射'
  if (Array.isArray(ports)) return ports.join(', ') || '无端口映射'
  return ports || '无端口映射'
}
