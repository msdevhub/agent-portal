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
  production?: { url: string; status: number } | null
  dev?: { url: string; status: number } | null
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
    throw new Error(message)
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
  }
}

export const fetchStats = () => api<Stats>('/stats')
export const fetchProjects = async () => (await api<Project[]>('/projects')).map(normalizeProject)
export const fetchProject = async (slug: string) => normalizeProject(await api<Project>(`/projects/${slug}`))
export const fetchDashboard = async () => normalizeDashboardData(await api<DashboardData>('/dashboard'))
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

// ── Portal Ops APIs ──

export interface OpsPost {
  id: string
  channel_id: string
  user_id: string
  message: string
  create_at: number
  update_at: number
  type?: string
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

export const getOpsMessages = (channelId: string, since?: number) => {
  let path = `/ops/messages?channel_id=${encodeURIComponent(channelId)}`
  if (since) path += `&since=${since}`
  return api<OpsMessagesResult>(path)
}
