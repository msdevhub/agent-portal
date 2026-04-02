import { useCallback, useEffect, useMemo, useState } from "react"
import { Activity, AlertTriangle, ChevronDown, ChevronRight, Clock, Plus, X } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  fetchMonitorUptime,
  fetchMonitorHistory,
  fetchIncidents,
  createMonitor,
  type MonitorUptime,
  type MonitorHistory,
  type Incident,
} from "@/lib/api"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

/* ═══════════════════ Types ═══════════════════ */

interface GroupedMonitors {
  [groupName: string]: MonitorUptime[]
}

/* ═══════════════════ Helpers ═══════════════════ */

function getUptimeColor(pct: number): string {
  if (pct >= 99) return "text-emerald-400"
  if (pct >= 95) return "text-amber-400"
  return "text-rose-400"
}

function getStatusDotColor(status: number | null, expected: number = 200): string {
  if (status === null) return "bg-zinc-600"
  return status === expected ? "bg-emerald-400" : "bg-rose-400"
}

function formatDuration(seconds: number | null): string {
  if (!seconds) return "-"
  if (seconds < 60) return `${seconds}秒`
  if (seconds < 3600) return `${Math.round(seconds / 60)}分钟`
  return `${Math.round(seconds / 3600)}小时`
}

function formatTime(isoStr: string | null): string {
  if (!isoStr) return "-"
  const d = new Date(isoStr)
  return d.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
}

/* ═══════════════════ UptimeBar ═══════════════════ */

function UptimeBar({ history, expectedStatus }: { history: MonitorHistory[]; expectedStatus: number }) {
  // 45 bars for 7 days (~3.7h per bar)
  const barCount = 45
  const bars: ("ok" | "fail" | "none")[] = useMemo(() => {
    if (!history || history.length === 0) {
      return Array(barCount).fill("none")
    }
    const now = Date.now()
    const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000
    const intervalMs = (7 * 24 * 60 * 60 * 1000) / barCount
    
    const result: ("ok" | "fail" | "none")[] = []
    for (let i = 0; i < barCount; i++) {
      const start = sevenDaysAgo + i * intervalMs
      const end = start + intervalMs
      const checks = history.filter(h => {
        const t = new Date(h.snapshot_time).getTime()
        return t >= start && t < end
      })
      if (checks.length === 0) {
        result.push("none")
      } else {
        const hasFail = checks.some(c => c.http_status !== expectedStatus)
        result.push(hasFail ? "fail" : "ok")
      }
    }
    return result
  }, [history, expectedStatus])

  return (
    <div className="flex gap-[2px] mt-1.5">
      {bars.map((status, i) => (
        <div
          key={i}
          className={cn(
            "h-5 w-[4px] rounded-sm",
            status === "ok" && "bg-emerald-500",
            status === "fail" && "bg-rose-500",
            status === "none" && "bg-zinc-700"
          )}
        />
      ))}
    </div>
  )
}

/* ═══════════════════ ResponseChart ═══════════════════ */

function ResponseChart({ history }: { history: MonitorHistory[] }) {
  if (!history || history.length < 2) {
    return <div className="text-xs text-zinc-600 py-4">暂无足够的响应时间数据</div>
  }

  const times = history.map(h => h.response_ms ?? 0).filter(t => t > 0)
  if (times.length < 2) {
    return <div className="text-xs text-zinc-600 py-4">暂无响应时间数据</div>
  }

  const maxTime = Math.max(...times, 100)
  const width = 280
  const height = 60
  const padding = { top: 5, right: 5, bottom: 15, left: 30 }
  const chartW = width - padding.left - padding.right
  const chartH = height - padding.top - padding.bottom

  const points = times.map((t, i) => ({
    x: padding.left + (i / (times.length - 1)) * chartW,
    y: padding.top + chartH - (t / maxTime) * chartH
  }))

  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')
  const avgTime = Math.round(times.reduce((a, b) => a + b, 0) / times.length)

  return (
    <div className="mt-2">
      <svg width={width} height={height} className="text-emerald-400">
        {/* Y axis labels */}
        <text x={padding.left - 4} y={padding.top + 3} className="text-[8px] fill-zinc-500" textAnchor="end">{maxTime}ms</text>
        <text x={padding.left - 4} y={height - padding.bottom} className="text-[8px] fill-zinc-500" textAnchor="end">0</text>
        {/* Grid lines */}
        <line x1={padding.left} y1={padding.top} x2={width - padding.right} y2={padding.top} className="stroke-zinc-800" strokeWidth={0.5} />
        <line x1={padding.left} y1={height - padding.bottom} x2={width - padding.right} y2={height - padding.bottom} className="stroke-zinc-800" strokeWidth={0.5} />
        {/* Line */}
        <path d={pathD} fill="none" stroke="currentColor" strokeWidth={1.5} />
        {/* Dots at ends */}
        {points.length > 0 && (
          <>
            <circle cx={points[0].x} cy={points[0].y} r={2} className="fill-emerald-400" />
            <circle cx={points[points.length - 1].x} cy={points[points.length - 1].y} r={2} className="fill-emerald-400" />
          </>
        )}
      </svg>
      <div className="text-[10px] text-zinc-500 mt-1">平均响应: {avgTime}ms</div>
    </div>
  )
}

/* ═══════════════════ MonitorRow ═══════════════════ */

function MonitorRow({ monitor, expanded, onToggle }: {
  monitor: MonitorUptime
  expanded: boolean
  onToggle: () => void
}) {
  const [history, setHistory] = useState<MonitorHistory[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)

  useEffect(() => {
    if (expanded && history.length === 0) {
      setHistoryLoading(true)
      fetchMonitorHistory(monitor.monitor_id, 168) // 7 days for bars
        .then(setHistory)
        .catch(console.error)
        .finally(() => setHistoryLoading(false))
    }
  }, [expanded, monitor.monitor_id, history.length])

  const uptimePct = Number(monitor.uptime_pct) || 100
  const avgMs = monitor.avg_response_ms != null ? Math.round(monitor.avg_response_ms) : null

  return (
    <div className="rounded-lg border border-zinc-800/60 bg-[#0c0c0e]/50">
      <button
        onClick={onToggle}
        className="w-full text-left p-3 flex items-center gap-3 hover:bg-zinc-800/30 transition-colors"
      >
        {expanded ? (
          <ChevronDown className="h-3.5 w-3.5 text-zinc-500 flex-shrink-0" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 text-zinc-500 flex-shrink-0" />
        )}
        <span
          className={cn("h-2 w-2 rounded-full flex-shrink-0", getStatusDotColor(monitor.last_status, monitor.expected_status))}
        />
        <span className="text-sm text-zinc-200 flex-1 truncate">{monitor.name}</span>
        <span className={cn("text-sm font-medium tabular-nums", getUptimeColor(uptimePct))}>
          {uptimePct.toFixed(1)}%
        </span>
        {avgMs !== null && (
          <span className="text-[11px] text-zinc-500 tabular-nums ml-2">
            ⏱ {avgMs}ms
          </span>
        )}
      </button>

      {expanded && (
        <div className="px-3 pb-3 pt-0 border-t border-zinc-800/40">
          <div className="mt-2 text-[11px] text-zinc-500 truncate">
            {monitor.target}
          </div>
          {historyLoading ? (
            <div className="text-xs text-zinc-600 py-2">加载中...</div>
          ) : (
            <>
              <UptimeBar history={history} expectedStatus={monitor.expected_status} />
              <ResponseChart history={history.slice(-48)} />
              <div className="mt-2 flex gap-4 text-[10px] text-zinc-500">
                <span>24h检查: {monitor.checks_24h}</span>
                <span>24h失败: {monitor.fails_24h}</span>
                {monitor.last_checked && (
                  <span>最后检查: {formatTime(monitor.last_checked)}</span>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

/* ═══════════════════ IncidentsList ═══════════════════ */

function IncidentsList({ incidents }: { incidents: Incident[] }) {
  if (!incidents || incidents.length === 0) {
    return (
      <div className="text-xs text-zinc-600 py-2">暂无故障记录 ✨</div>
    )
  }

  return (
    <div className="space-y-1.5">
      {incidents.slice(0, 5).map(inc => (
        <div key={inc.id} className="flex items-center gap-2 text-xs">
          <span className={inc.resolved_at ? "text-emerald-400" : "text-rose-400"}>
            {inc.resolved_at ? "🟢" : "🔴"}
          </span>
          <span className="text-zinc-300">{inc.monitor_name || `Monitor #${inc.monitor_id}`}</span>
          <span className="text-zinc-500">{formatTime(inc.started_at)}</span>
          {inc.resolved_at && (
            <>
              <span className="text-zinc-600">-</span>
              <span className="text-zinc-500">{formatTime(inc.resolved_at)}</span>
            </>
          )}
          {inc.duration_sec && (
            <span className="text-zinc-600">({formatDuration(inc.duration_sec)})</span>
          )}
          {inc.resolved_at && <span className="text-emerald-500/70 text-[10px]">已恢复</span>}
        </div>
      ))}
    </div>
  )
}

/* ═══════════════════ AddMonitorDialog ═══════════════════ */

function AddMonitorDialog({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState({
    name: "",
    type: "http",
    target: "",
    interval_sec: 300,
    timeout_ms: 5000,
    expected_status: 200,
    group_name: "其他",
    project_slug: "",
  })

  const handleSubmit = async () => {
    if (!form.name || !form.target) return
    setLoading(true)
    try {
      await createMonitor({
        ...form,
        project_slug: form.project_slug || null,
      })
      setOpen(false)
      setForm({
        name: "",
        type: "http",
        target: "",
        interval_sec: 300,
        timeout_ms: 5000,
        expected_status: 200,
        group_name: "其他",
        project_slug: "",
      })
      onCreated()
    } catch (e) {
      console.error("Create monitor failed:", e)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="h-7 px-2 text-zinc-400 hover:text-zinc-200">
          <Plus className="h-3.5 w-3.5 mr-1" />
          添加
        </Button>
      </DialogTrigger>
      <DialogContent className="bg-[#111113] border-zinc-800 max-w-md">
        <DialogHeader>
          <DialogTitle className="text-zinc-100">添加监控项</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div className="space-y-2">
            <Label className="text-zinc-400">名称</Label>
            <Input
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="例如: My Service"
              className="bg-zinc-900 border-zinc-800"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label className="text-zinc-400">类型</Label>
              <Select value={form.type} onValueChange={v => setForm(f => ({ ...f, type: v }))}>
                <SelectTrigger className="bg-zinc-900 border-zinc-800">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="http">HTTP</SelectItem>
                  <SelectItem value="tcp">TCP</SelectItem>
                  <SelectItem value="ping">Ping</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="text-zinc-400">分组</Label>
              <Select value={form.group_name} onValueChange={v => setForm(f => ({ ...f, group_name: v }))}>
                <SelectTrigger className="bg-zinc-900 border-zinc-800">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="生产环境">生产环境</SelectItem>
                  <SelectItem value="开发环境">开发环境</SelectItem>
                  <SelectItem value="代理节点">代理节点</SelectItem>
                  <SelectItem value="其他">其他</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <Label className="text-zinc-400">目标 URL/地址</Label>
            <Input
              value={form.target}
              onChange={e => setForm(f => ({ ...f, target: e.target.value }))}
              placeholder="https://example.com 或 host:port"
              className="bg-zinc-900 border-zinc-800"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label className="text-zinc-400">检查间隔</Label>
              <Select value={String(form.interval_sec)} onValueChange={v => setForm(f => ({ ...f, interval_sec: Number(v) }))}>
                <SelectTrigger className="bg-zinc-900 border-zinc-800">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="60">1分钟</SelectItem>
                  <SelectItem value="300">5分钟</SelectItem>
                  <SelectItem value="900">15分钟</SelectItem>
                  <SelectItem value="1800">30分钟</SelectItem>
                  <SelectItem value="3600">1小时</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="text-zinc-400">超时</Label>
              <Select value={String(form.timeout_ms)} onValueChange={v => setForm(f => ({ ...f, timeout_ms: Number(v) }))}>
                <SelectTrigger className="bg-zinc-900 border-zinc-800">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="3000">3秒</SelectItem>
                  <SelectItem value="5000">5秒</SelectItem>
                  <SelectItem value="10000">10秒</SelectItem>
                  <SelectItem value="30000">30秒</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          {form.type === "http" && (
            <div className="space-y-2">
              <Label className="text-zinc-400">预期状态码</Label>
              <Input
                type="number"
                value={form.expected_status}
                onChange={e => setForm(f => ({ ...f, expected_status: Number(e.target.value) || 200 }))}
                className="bg-zinc-900 border-zinc-800"
              />
            </div>
          )}
          <div className="space-y-2">
            <Label className="text-zinc-400">关联项目 (可选)</Label>
            <Input
              value={form.project_slug}
              onChange={e => setForm(f => ({ ...f, project_slug: e.target.value }))}
              placeholder="例如: clawcraft"
              className="bg-zinc-900 border-zinc-800"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={loading}>
              取消
            </Button>
            <Button onClick={handleSubmit} disabled={loading || !form.name || !form.target}>
              {loading ? "保存中..." : "保存"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/* ═══════════════════ MonitorPanel (Main Export) ═══════════════════ */

export function MonitorPanel() {
  const [uptimeData, setUptimeData] = useState<MonitorUptime[]>([])
  const [incidents, setIncidents] = useState<Incident[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedId, setExpandedId] = useState<number | null>(null)

  const loadData = useCallback(async () => {
    try {
      const [uptime, incs] = await Promise.all([
        fetchMonitorUptime(7),
        fetchIncidents({ limit: 10 }),
      ])
      setUptimeData(uptime ?? [])
      setIncidents(incs ?? [])
    } catch (e) {
      console.error("Failed to load monitor data:", e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadData()
  }, [loadData])

  const groupedMonitors = useMemo<GroupedMonitors>(() => {
    const grouped: GroupedMonitors = {}
    for (const m of uptimeData) {
      const group = m.group_name || "其他"
      if (!grouped[group]) grouped[group] = []
      grouped[group].push(m)
    }
    return grouped
  }, [uptimeData])

  // Priority order for groups
  const groupOrder = ["生产环境", "开发环境", "代理节点", "其他"]
  const sortedGroups = Object.keys(groupedMonitors).sort((a, b) => {
    const ai = groupOrder.indexOf(a)
    const bi = groupOrder.indexOf(b)
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi)
  })

  if (loading) {
    return (
      <section className="rounded-xl border border-zinc-800/80 bg-[#111113] p-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
          <Activity className="h-4 w-4 text-emerald-400" />
          <span>健康监控</span>
        </div>
        <div className="mt-4 text-sm text-zinc-600">加载中...</div>
      </section>
    )
  }

  return (
    <section className="rounded-xl border border-zinc-800/80 bg-[#111113] p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
          <Activity className="h-4 w-4 text-emerald-400" />
          <span>健康监控</span>
        </div>
        <AddMonitorDialog onCreated={loadData} />
      </div>

      <div className="mt-4 space-y-4">
        {sortedGroups.length === 0 ? (
          <div className="text-sm text-zinc-600">暂无监控项</div>
        ) : (
          sortedGroups.map(group => (
            <div key={group}>
              <div className="mb-2 text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-500">
                {group}
              </div>
              <div className="space-y-1.5">
                {(groupedMonitors[group] ?? []).map(m => (
                  <MonitorRow
                    key={m.monitor_id}
                    monitor={m}
                    expanded={expandedId === m.monitor_id}
                    onToggle={() => setExpandedId(prev => prev === m.monitor_id ? null : m.monitor_id)}
                  />
                ))}
              </div>
            </div>
          ))
        )}

        {/* Recent Incidents */}
        <div className="pt-2 border-t border-zinc-800/60">
          <div className="mb-2 flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-500">
            <AlertTriangle className="h-3 w-3" />
            最近故障
          </div>
          <IncidentsList incidents={incidents} />
        </div>
      </div>
    </section>
  )
}
