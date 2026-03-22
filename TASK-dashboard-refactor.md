# TASK: Dashboard 重构 — Bot 作为唯一入口

## 目标
将 Bot 卡片重构为 Dashboard 的唯一入口。移除独立的 Projects Tab，将项目信息聚合到 Bot 卡片中。

## 设计原则
- **Bot 是唯一入口**：用户从 Bot 卡片进入所有功能
- **分层展开**：列表态(卡片) → 展开态(关键信息) → 详情态(弹窗) → 对话
- **每层只多一点信息**：不要一下全展开

## 交互层级

### Level 1 — 列表态（现有 Bot 卡片）
- 保留现有红绿灯状态
- **新增**：项目进度摘要（如 "7/10 tasks"）

### Level 2 — 展开态（点击卡片展开）
- Runtime 详情 + 项目进度条
- Chat / Details 快捷入口

### Level 3 — 详情弹窗（点击 Details）
- Dialog/Modal 形式
- 复用 ProjectDetailPage 的核心逻辑：任务管理、时间线
- Desktop: 弹窗。Mobile: 全屏

## 具体改动

### DashboardPage.tsx（主要改动文件）
1. 移除 `ProjectsTab` 组件定义和引用
2. 移除 tab bar 中的 "Projects" tab button
3. 在 `BotFleetTab` 中给 Bot 卡片添加展开/收起能力
4. 添加 `BotDetailModal` — 用 Dialog 组件包装项目详情

### ⚠️ 严格约束 — 必须遵守
- **只改 `src/pages/DashboardPage.tsx`**
- **禁止修改以下文件**：
  - `src/main.tsx`
  - `src/App.tsx`
  - `src/components/auth/*`
  - `src/components/portal/shared.tsx`
  - `src/components/portal/CommandBar.tsx`
  - `src/lib/api.ts`
  - `src/index.css`
  - `vite.config.ts`
  - `src/pages/ProjectDetailPage.tsx`
  - `src/pages/ProjectsPage.tsx`
- **不要 import ProjectDetailPageContent** — 用 DashboardPage 内部自己的组件
- **不要动任何 export 签名** — DashboardPage 的 props 接口保持不变
- **不要添加新的外部依赖** — 只用已有的 lucide-react、shadcn/ui 组件
- **必须保留 UserMenu 组件** — 不要删除或移动它

### Props 接口（不要改）
```typescript
{
  dashboard, loading, refreshing, historyPoints, historyBotPoints, historyServerPoints,
  selectedAsOf, onSelectAsOf,
  stats, projects, recentNotes, projectsLoading,
  onCreateProject, onOpenProject,
}
```

## 验收标准
1. 页面能正常打开（不黑屏、不白屏）
2. Dashboard 只剩 Bot Fleet 和 Server Fleet 两个 Tab
3. Bot 卡片可以展开/收起
4. 展开后有 Details 按钮，点击弹出模态框
5. `vite build` 无报错

## 完成后
- 运行 `cd /home/resley/.openclaw/workspace-research-portal/poc/v3-shadcn && npx vite build`
- 运行 `pm2 restart dev-portal`
- 回复改动摘要
