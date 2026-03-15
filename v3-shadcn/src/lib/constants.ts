export const STAGES = [
  { id: 'idea',  label: '想法', icon: '💡', desc: '明确研究想法' },
  { id: 'plan',  label: '方案', icon: '📋', desc: '形成研究方案' },
  { id: 'build', label: '验证', icon: '🔨', desc: '搭建并验证方案' },
  { id: 'ship',  label: '落地', icon: '🚀', desc: '沉淀并推进落地' },
] as const;

export type StageId = typeof STAGES[number]['id'];

export const STATUS_LABELS: Record<string, string> = {
  active: '进行中', paused: '暂停', completed: '已完成', archived: '归档',
  pending: '待办', in_progress: '进行中', done: '已完成', blocked: '阻塞',
};

export const NOTE_TYPES = [
  { id: 'finding',  label: '发现', icon: '🔍', color: 'text-cyan-400' },
  { id: 'decision', label: '决策', icon: '🎯', color: 'text-emerald-400' },
  { id: 'blocker',  label: '阻塞', icon: '🚧', color: 'text-red-400' },
  { id: 'idea',     label: '想法', icon: '💡', color: 'text-amber-400' },
] as const;

export const ARTIFACT_TYPES = [
  { id: 'doc', label: '文档' },
  { id: 'code', label: '代码' },
  { id: 'data', label: '数据' },
  { id: 'link', label: '链接' },
  { id: 'image', label: '图片' },
] as const;

export const TIMELINE_EVENT_LABELS: Record<string, string> = {
  stage_change: '阶段变更',
  status_change: '状态变更',
  task_done: '任务完成',
  note_added: '新增笔记',
  artifact_added: '新增产出物',
};

export function getStageIndex(id: string) {
  return STAGES.findIndex(s => s.id === id);
}

export function getStageLabel(id: string) {
  return STAGES.find(s => s.id === id)?.label || id;
}

export function getArtifactTypeLabel(id: string) {
  return ARTIFACT_TYPES.find(t => t.id === id)?.label || id;
}
