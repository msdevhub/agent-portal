const API = '/api'

export interface Artifact {
  id: string
  project_id: string
  stage: string
  title: string
  type: 'doc' | 'code' | 'data' | 'link' | 'image'
  url: string
  description: string
  created_at: string
}

export interface TimelineEvent {
  id: string
  project_id: string
  event_type: 'stage_change' | 'status_change' | 'task_done' | 'note_added' | 'artifact_added' | string
  description: string
  metadata?: Record<string, unknown>
  created_at: string
}

export interface Task {
  id: string
  project_id: string
  title: string
  description: string
  stage: string
  status: 'pending' | 'in_progress' | 'done' | 'blocked'
  priority?: number
  created_at: string
  updated_at: string
}

export interface Note {
  id: string
  project_id: string
  content: string
  type: 'finding' | 'decision' | 'blocker' | 'idea'
  created_at: string
}

export interface Project {
  id: string
  name: string
  slug: string
  description: string
  emoji: string
  status: 'active' | 'paused' | 'completed' | 'archived'
  stage: string
  created_at: string
  updated_at: string
  tasks?: Task[]
  notes?: Note[]
  artifacts?: Artifact[]
  timeline?: TimelineEvent[]
  task_count?: number
  tasks_done?: number
  artifact_count?: number
  last_activity_at?: string | null
}

export interface Stats {
  total: number
  active: number
  completed: number
  tasks: number
  tasksDone: number
}

export interface DashboardSummary {
  timestamp?: string
  production?: { total: number; up: number }
  dev?: { total: number; up: number }
  containers?: { total: number; up: number }
  crons?: { total: number; ok: number; error: number }
  agents?: { total: number }
}

export interface ProductionSite {
  name: string
  emoji?: string
  url: string
  project?: string
  status: number
  checkedAt?: string
}

export interface DevServer {
  name: string
  subdomain?: string
  port?: number
  url: string
  status: number
  checkedAt?: string
}

export interface DashboardContainer {
  name: string
  status: string
  ports?: string[] | string
  image?: string
  running?: boolean
}

export interface CronJob {
  id: string
  name: string
  agent?: string
  enabled?: boolean
  schedule?: string
  model?: string
  lastStatus?: string
  lastRun?: string
  nextRun?: string
  consecutiveErrors?: number
}

export interface DashboardAgent {
  id: string
  name: string
  emoji?: string
  role?: string
  project?: string
  github?: string
  mm_user_id?: string
  mm_username?: string
  last_active?: string
  production?: { url: string; status?: number } | null
  dev?: { url: string; status?: number } | null
  container?: { name: string; running: boolean; status: string } | null
  crons?: { total: number; ok: number; error: number; jobs: Array<{ name: string; lastStatus: string; schedule: string }> }
  tasks?: { pending: number; done: number; total: number } | null
}

export interface ServerService {
  name: string
  type: string
  status: string
  ports: string[]
}

export interface ServerAlert {
  level: string
  message: string
}

export interface ServerSnapshot {
  id: string
  name: string
  ip: string
  internal_ip: string | null
  region: string
  cloud: string
  resource_group: string
  role: string
  tags: string[]
  os: string
  cpu_cores: number
  memory_total_mb: number
  memory_used_mb: number
  disk_total_gb: number
  disk_used_gb: number
  disk_usage_pct: number
  uptime_seconds: number
  ssh_port: number
  ssh_user: string
  ssh_reachable: boolean
  services: ServerService[]
  listening_ports: number[]
  alerts: ServerAlert[]
  extra: Record<string, unknown>
  snapshot_time: string
  collector: string
}

export interface DashboardData {
  summary: DashboardSummary
  production_sites: ProductionSite[]
  dev_servers: DevServer[]
  containers: DashboardContainer[]
  cron_jobs: CronJob[]
  agents: DashboardAgent[]
  servers: ServerSnapshot[]
  updated_at: string | null
  as_of?: string | null
}

export interface DailyReport {
  id: number
  date: string
  content: string
  agent_id: string
  created_at: string
  updated_at: string
}

interface ApiErrorPayload {
  error?: string
  message?: string
}

const LEGACY_STAGE_MAP: Record<string, string> = {
  question: 'idea',
  literature: 'plan',
  hypothesis: 'plan',
  poc: 'build',
  conclusion: 'ship',
  report: 'ship',
}

async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const opts: RequestInit = { method }

  if (body !== undefined) {
    opts.headers = { 'Content-Type': 'application/json' }
    opts.body = JSON.stringify(body)
  }

  const res = await fetch(`${API}${path}`, opts)
  const raw = await res.text()
  const payload = raw ? safeParseJson<ApiErrorPayload & T>(raw) : undefined

  if (!res.ok) {
    const message = payload?.error || payload?.message || `请求失败 (${res.status})`
    const err = new Error(message) as Error & { status: number }
    err.status = res.status
    throw err
  }

  return (payload as T | undefined) ?? (undefined as T)
}

function safeParseJson<T>(raw: string): T | undefined {
  try {
    return JSON.parse(raw) as T
  } catch {
    return undefined
  }
}

function normalizeStage(stage: string) {
  return LEGACY_STAGE_MAP[stage] ?? stage
}

function normalizeArtifact(artifact: Artifact): Artifact {
  return {
    ...artifact,
    stage: normalizeStage(artifact.stage),
  }
}

function normalizeTask(task: Task): Task {
  return {
    ...task,
    stage: normalizeStage(task.stage),
  }
}

function normalizeTimelineEvent(event: TimelineEvent): TimelineEvent {
  if (!event.metadata || typeof event.metadata !== 'object') {
    return event
  }

  const metadata = { ...event.metadata }

  if (typeof metadata.from === 'string') {
    metadata.from = normalizeStage(metadata.from)
  }

  if (typeof metadata.to === 'string') {
    metadata.to = normalizeStage(metadata.to)
  }

  if (typeof metadata.stage === 'string') {
    metadata.stage = normalizeStage(metadata.stage)
  }

  return {
    ...event,
    metadata,
  }
}

function normalizeProject(project: Project): Project {
  return {
    ...project,
    stage: normalizeStage(project.stage),
    tasks: project.tasks?.map(normalizeTask),
    artifacts: project.artifacts?.map(normalizeArtifact),
  }
}

function normalizeDashboardData(data: Partial<DashboardData> | undefined): DashboardData {
  return {
    summary: data?.summary ?? {},
    production_sites: data?.production_sites ?? [],
    dev_servers: data?.dev_servers ?? [],
    containers: data?.containers ?? [],
    cron_jobs: data?.cron_jobs ?? [],
    agents: data?.agents ?? [],
    servers: data?.servers ?? [],
    updated_at: data?.updated_at ?? null,
    as_of: data?.as_of ?? data?.updated_at ?? null,
  }
}

export const fetchStats = () => api<Stats>('/stats')
export const fetchProjects = async () => (await api<Project[]>('/projects')).map(normalizeProject)
export const fetchProject = async (slug: string) => normalizeProject(await api<Project>(`/projects/${slug}`))
export const fetchDashboard = async (at?: string) => normalizeDashboardData(await api<DashboardData>(`/dashboard${at ? `?at=${encodeURIComponent(at)}` : ''}`))
export const fetchDashboardHistory = async (limit = 120) => api<{ points: string[]; botPoints?: string[]; serverPoints?: string[]; summaries?: { time: string; bots: number | null; srvs: number | null }[] }>(`/dashboard/history?limit=${limit}`)
export const fetchDailyReports = (limit = 30, offset = 0, agentId?: string) =>
  api<DailyReport[]>(`/daily-reports?limit=${limit}&offset=${offset}${agentId ? `&agentId=${encodeURIComponent(agentId)}` : ''}`)

// ── Daily Insights ──
export interface ThingDone {
  title: string
  description: string
  status: "completed" | "in_progress" | "blocked"
  bots: string[]
  bot_emojis: string[]
  time_range: string
  deliverables: string[]
  is_focus: boolean
}

export interface NeedAttention {
  title: string
  description: string
  bot: string
  bot_emoji: string
  severity: "high" | "medium"
  nba?: {
    action: string
    target_bot: string
    message: string
  }
}

export interface InsightsStats {
  active_bots: number
  total_messages: number
  things_count: number
  completed: number
  in_progress: number
  blocked: number
}

export interface InsightsBotSummary {
  bot: string
  emoji: string
  messages: number
  things: number
  one_liner: string
}

export interface DailyInsights {
  date: string
  things_done: ThingDone[]
  needs_attention: NeedAttention[]
  stats: InsightsStats
  bot_summaries: InsightsBotSummary[]
  updated_at?: string
}
export const fetchDailyInsights = (date?: string) =>
  api<DailyInsights | null>(`/insights${date ? `?date=${encodeURIComponent(date)}` : ''}`)
export const fetchInsightDates = () =>
  api<string[]>('/insights/dates')

// ── Bot Real-time Status ──
export interface BotStatusEntry {
  agent_id: string
  mm_user_id: string
  emoji: string
  name: string
  status: 'typing' | 'active' | 'idle'
  lastActivity: number
  lastMessage: string
}
export const fetchBotStatuses = () => api<BotStatusEntry[]>('/bots/status')

// ── Bot Reports & Activities (new endpoints) ──
export const fetchBotReport = (agentId: string, date?: string) =>
  api<{ content: string; date: string } | null>(`/reports/${encodeURIComponent(agentId)}${date ? `?date=${encodeURIComponent(date)}` : ''}`)
export const fetchBotActivities = (agentId: string, date?: string) =>
  api<DailyActivity[]>(`/activities/${encodeURIComponent(agentId)}${date ? `?date=${encodeURIComponent(date)}` : ''}`)

// ── Daily Activities ──
export interface DailyActivity {
  id: string
  agent_id: string
  date: string
  time: string | null
  action: string
  content: string
  detail: { category?: string; references?: string[]; deliverables?: string[]; who?: string; original_action?: string } | null
}
export const fetchDailyActivities = (agentId: string, date?: string, limit = 50, offset = 0) =>
  api<DailyActivity[]>(`/daily-activities?agent_id=${encodeURIComponent(agentId)}${date ? `&date=${encodeURIComponent(date)}` : ''}&limit=${limit}&offset=${offset}`)
export const fetchDailyActivityDates = (agentId: string) =>
  api<string[]>(`/daily-activities/dates?agent_id=${encodeURIComponent(agentId)}`)

// ── Daily Timeline (granular L1 events) ──
export interface DailyTimelineEvent {
  id: string
  agent_id: string
  date: string
  time: string | null
  who: string | null
  action: string
  content: string
  status: string | null
  deliverables: string[]
  created_at: string
}
export const fetchDailyTimeline = (agentId: string, date?: string, limit = 50, offset = 0) =>
  api<DailyTimelineEvent[]>(`/daily-timeline?agent_id=${encodeURIComponent(agentId)}${date ? `&date=${encodeURIComponent(date)}` : ''}&limit=${limit}&offset=${offset}`)

export const fetchDailyReport = (date: string) =>
  api<DailyReport>(`/daily-reports/${encodeURIComponent(date)}`)
export const createDailyReport = (data: { date: string; content: string; agentId?: string }) =>
  api<DailyReport>('/daily-reports', 'POST', data)
export const createProject = (data: { name: string; description?: string; emoji?: string; stage?: string }) =>
  api<Project>('/projects', 'POST', data)
export const updateProject = (id: string, data: Partial<Project>) =>
  api<Project>(`/projects/${id}`, 'PUT', data)
export const createTask = (data: { project_id: string; title: string; stage: string; description?: string }) =>
  api<Task>('/tasks', 'POST', data)
export const updateTask = (id: string, data: Partial<Task>) =>
  api<Task>(`/tasks/${id}`, 'PUT', data)
export const deleteTask = (id: string) => api<void>(`/tasks/${id}`, 'DELETE')
export const createNote = (data: { project_id: string; content: string; type: string }) =>
  api<Note>('/notes', 'POST', data)
export const fetchArtifacts = (projectId: string) =>
  api<Artifact[]>(`/artifacts?project_id=${encodeURIComponent(projectId)}`).then((artifacts) => artifacts.map(normalizeArtifact))
export const createArtifact = (data: {
  project_id: string
  stage: string
  title: string
  type: Artifact['type']
  url?: string
  description?: string
}) => api<Artifact>('/artifacts', 'POST', data)
export const deleteArtifact = (id: string) => api<void>(`/artifacts/${id}`, 'DELETE')
export const fetchTimeline = (projectId: string) =>
  api<TimelineEvent[]>(`/timeline?project_id=${encodeURIComponent(projectId)}`).then((events) => events.map(normalizeTimelineEvent))
export const initDB = () => api<void>('/init-db', 'POST')

// ── Workspace / Context / Memory APIs ──

export interface WorkspaceFile {
  name: string
  path: string
  size: number
  mtime: string
}

export interface ModelContextFile {
  name: string
  size: number
  mtime: string
}

export interface ModelContextLayer {
  layer: string
  label: string
  description: string
  files: ModelContextFile[]
}

export interface ModelContextSummary {
  alwaysLoadedFiles: number
  alwaysLoadedBytes: number
  skillFiles: number
  skillBytes: number
  estimatedTokens: number
  maxTokens: number
  usagePercent: number
}

export interface ModelContextResponse {
  layers: ModelContextLayer[]
  summary: ModelContextSummary
}

export const fetchContextFiles = () => api<WorkspaceFile[]>('/context')
export const fetchMemoryFiles = () => api<WorkspaceFile[]>('/memory')
export const fetchModelContext = (slug: string) => api<ModelContextResponse>(`/model-context/${slug}`)

/** Read a workspace file (returns raw markdown text) */
export async function fetchWorkspaceFile(filePath: string): Promise<string> {
  const res = await fetch(`${API}/workspace/${filePath}`)
  if (!res.ok) throw new Error(`读取失败 (${res.status})`)
  return res.text()
}

/** Write a workspace file */
export const saveWorkspaceFile = (filePath: string, content: string) =>
  api<{ ok: boolean }>(`/workspace/${filePath}`, 'PUT', { content })

/** Read a project doc file (returns raw markdown text) */
export async function fetchDocFile(slug: string, docPath: string): Promise<string> {
  const res = await fetch(`${API}/doc/${slug}/${docPath}`)
  if (!res.ok) throw new Error(`读取失败 (${res.status})`)
  return res.text()
}

/** Write a project doc file */
export const saveDocFile = (slug: string, docPath: string, content: string) =>
  api<{ ok: boolean }>(`/doc/${slug}/${docPath}`, 'PUT', { content })

// ── Changelog APIs ──

export interface ChangelogCommit {
  sha: string
  message: string
  author: string
  date: string
  url: string
}

export interface ChangelogResponse {
  githubRepo: string
  commits: ChangelogCommit[]
}

export const fetchChangelog = (slug: string) =>
  api<ChangelogResponse>(`/changelog/${slug}`)

// ── Portal Ops APIs ──

export interface OpsPost {
  id: string
  channel_id: string
  user_id: string
  message: string
  create_at: number
  update_at: number
  type?: string
  is_self?: boolean
}

export interface OpsSendResult {
  ok: boolean
  post_id: string
  channel_id: string
}

export interface OpsMessagesResult {
  posts: OpsPost[]
  channel_id: string
}

export const sendOpsMessage = (targetUserId: string, message: string) =>
  api<OpsSendResult>('/ops/send', 'POST', { target_user_id: targetUserId, message })

export const getOpsChannel = (targetUserId: string) =>
  api<{ channel_id: string }>(`/ops/channel?target_user_id=${encodeURIComponent(targetUserId)}`)

export const getOpsMessages = (channelId: string, since?: number) => {
  let path = `/ops/messages?channel_id=${encodeURIComponent(channelId)}`
  if (since) path += `&since=${since}`
  return api<OpsMessagesResult>(path)
}

// ── NBA (Next Best Action) ──
export const sendNbaMessage = (targetBot: string, message: string) =>
  api<{ ok: boolean; post_id: string; channel_id: string }>('/nba/send', 'POST', { target_bot: targetBot, message })

// ── AP Projects v2 (auto-tracked project status layer) ──

export interface APProject {
  id: string
  name: string
  slug?: string
  description: string | null
  status: 'discovering' | 'active' | 'blocked' | 'done' | 'dormant' | 'dismissed'
  health: 'healthy' | 'attention' | 'blocked' | 'stale'
  current_summary: string | null
  responsible_bot: string | null
  recent_events: { date: string | null; event: string; bot?: string }[]
  last_updated: string | null
  first_seen: string | null
  last_active: string | null
  involved_bots: string[]
  primary_bot: string | null
  milestones: { date: string; event: string; bot?: string }[]
  next_actions: { text: string; done?: boolean }[]
  deliverables: { name: string; url?: string; type?: string }[]
  tags: string[]
  user_notes: string | null
  auto_generated: boolean
  merged_into: string | null
  emoji?: string | null
  maintainers?: { agent_id: string; name: string; mm_username?: string }[] | null
  metadata?: Record<string, any> | null
}

export const fetchAPProjects = (filters?: { status?: string; bot?: string; tag?: string }) => {
  const params = new URLSearchParams()
  if (filters?.status) params.set('status', filters.status)
  if (filters?.bot) params.set('bot', filters.bot)
  if (filters?.tag) params.set('tag', filters.tag)
  const qs = params.toString()
  return api<APProject[]>(`/ap-projects${qs ? `?${qs}` : ''}`)
}

export const fetchAPProject = (id: string) =>
  api<APProject>(`/ap-projects/${id}`)

export const updateAPProject = (id: string, data: { status?: string; user_notes?: string; name?: string; description?: string }) =>
  api<APProject>(`/ap-projects/${id}`, 'PATCH', data)

export const mergeAPProject = (mainId: string, mergeId: string) =>
  api<{ success: boolean; updated_project: APProject }>('/project-merge', 'POST', { main_id: mainId, merge_id: mergeId })

export const createAPProject = (data: { name: string; description?: string; status?: string; primary_bot?: string; involved_bots?: string[]; tags?: string[] }) =>
  api<APProject>('/ap-projects', 'POST', data)

export const sendProjectMessage = (projectId: string, message: string, botId?: string) =>
  api<{ ok: boolean; post_id: string; channel_id: string; bot: string }>(
    `/ap-projects/${projectId}/message`, 'POST', { message, bot_id: botId }
  )

export const submitProjectAction = (data: {
  project_id: string
  action: 'approve' | 'reject'
  next_action?: string
  reason?: string
}) =>
  api<{ ok: boolean; action: string; project_id: string; new_health: string; message_sent: boolean; bot: string | null }>(
    '/project-action', 'POST', data
  )

export const sendProjectChat = (projectName: string, message: string) =>
  api<{ ok: boolean; post_id: string; message: string }>(
    '/project-chat', 'POST', { project_name: projectName, message }
  )

// ── Digest Refresh ──
export const triggerDigestRefresh = () =>
  api<{ ok: boolean; message?: string }>('/digest/refresh', 'POST')

export const fetchDigestStatus = () =>
  api<{ running: boolean; last_run?: string; message?: string }>('/digest/status')

// ── Project Sort Order ──
export const updateProjectSortOrder = (orders: { id: string; sort_order: number }[]) =>
  api<{ ok: boolean }>('/ap-projects/sort-order', 'PUT', { orders })

// ── Portal Settings ──
export const fetchPortalSettings = () => api<Record<string, any>>('/portal-settings')
export const updatePortalSettings = (settings: Record<string, any>) => api<{ ok: boolean }>('/portal-settings', 'PUT', settings)
export const fetchBotsList = () => api<any[]>('/bots/status')

// ══════════════════════════════════════════════════════════════════
// ── Health Monitoring API ──
// ══════════════════════════════════════════════════════════════════

export interface Monitor {
  id: number
  name: string
  type: 'http' | 'tcp' | 'ping' | 'keyword'
  target: string
  interval_sec: number
  timeout_ms: number
  expected_status: number
  group_name: string
  project_slug: string | null
  enabled: boolean
  paused: boolean
  created_at?: string
  updated_at?: string
}

export interface MonitorUptime {
  monitor_id: number
  name: string
  group_name: string
  target: string
  expected_status: number
  uptime_pct: number
  avg_response_ms: number | null
  last_status: number | null
  last_checked: string | null
  checks_24h: number
  fails_24h: number
}

export interface MonitorHistory {
  snapshot_time: string
  http_status: number
  response_ms: number | null
}

export interface Incident {
  id: number
  monitor_id: number
  monitor_name?: string
  started_at: string
  resolved_at: string | null
  duration_sec: number | null
  cause: string | null
}

export const fetchMonitors = (filters?: { type?: string; group?: string; enabled?: boolean }) => {
  const params = new URLSearchParams()
  if (filters?.type) params.set('type', filters.type)
  if (filters?.group) params.set('group', filters.group)
  if (filters?.enabled !== undefined) params.set('enabled', String(filters.enabled))
  const qs = params.toString()
  return api<Monitor[]>(`/monitors${qs ? `?${qs}` : ''}`)
}

export const fetchMonitorUptime = (days?: number) =>
  api<MonitorUptime[]>(`/monitors/uptime${days ? `?days=${days}` : ''}`)

export const fetchMonitorHistory = (id: number, hours?: number) =>
  api<MonitorHistory[]>(`/monitors/${id}/history${hours ? `?hours=${hours}` : ''}`)

export const createMonitor = (data: Partial<Monitor>) =>
  api<Monitor>('/monitors', 'POST', data)

export const updateMonitor = (id: number, data: Partial<Monitor>) =>
  api<Monitor>(`/monitors/${id}`, 'PUT', data)

export const deleteMonitor = (id: number) =>
  api<{ ok: boolean }>(`/monitors/${id}`, 'DELETE')

export const toggleMonitor = (id: number) =>
  api<{ ok: boolean; enabled: boolean }>(`/monitors/${id}/toggle`, 'POST')

export const fetchIncidents = (options?: { monitor_id?: number; limit?: number; resolved?: boolean }) => {
  const params = new URLSearchParams()
  if (options?.monitor_id) params.set('monitor_id', String(options.monitor_id))
  if (options?.limit) params.set('limit', String(options.limit))
  if (options?.resolved !== undefined) params.set('resolved', String(options.resolved))
  const qs = params.toString()
  return api<Incident[]>(`/incidents${qs ? `?${qs}` : ''}`)
}
