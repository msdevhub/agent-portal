# Agent Portal — 项目上下文

## 项目概况
研究项目管理平台 — 网页版查看和管理 Ottor 所有研究项目、任务、产出物、上下文和时间线。

## 当前状态
- 阶段: 🔨 验证 (build)
- 版本: v3.8
- 进度: 10/12 任务完成 (83%)
- 线上: https://agent-project.clawlines.net

## 最近更新 (2026-03-14 12:10 UTC)

### v3.8 — 轻量拆分 + 单文档收口
- 前端把 `App.tsx` 拆成主入口 + `HomePage` + `ProjectDetailPage`，公共 UI/工具提取到 `components/portal/shared.tsx`
- 保持拆分克制：只抽页面和公共块，不做过度组件化
- 删除项目根 `README.md`，项目文档只保留 `CONTEXT.md` 作为单一事实源
- 上下文 Tab 只保留 `CONTEXT.md` 卡片，移除 README 重复入口
- 后端 `PROJECT_REGISTRY` 改为展示 `CONTEXT.md`、`research/architecture.md`、`DEPLOY.md`
- `GET /api/artifacts` 新增可用性过滤，自动隐藏已删除文档留下的坏产出物链接

### v3.7e — 模型上下文面板 + CONTEXT.md 预览
- 后端新增 `GET /api/model-context/:slug` — 返回 3 层文件列表 + token 估算
- 上下文 Tab 顶部新增"模型上下文"面板（紫色主题，~3777 tokens / 3%）
- CONTEXT.md 与 README 以可点击卡片展示，点击弹出 Markdown 预览
- 修复 WORKSPACE_ROOT 路径错误（少一层 ../）导致上下文/记忆 API 返回空
- 修复 file:// 路径产出物无法预览（新增 WORKSPACE_PREFIX 解析）
- 修复 nullable project prop 导致 useEffect 崩溃黑屏
- 移除产出物三点菜单，整个卡片可直接点击打开

### v3.6 — 移动端 UX 迭代 2 (Codex)
- 删除 SYSTEM ONLINE 横幅
- 详情页顶部简化：select 藏入编辑弹窗
- 时间线紧凑化 ~100px → ~44px
- 已完成任务默认折叠
- Accordion 摘要 + 产出物图标区分

## 架构决策
- Q2 认证: 先搁置
- Q4 多 agent: 只需要一个 agent，不加 agent_id
- 4 阶段模型: idea/plan/build/ship + 前端兼容层

## 技术备忘
- 前端: Vite 7.3.1 + React 19 + shadcn/ui + Tailwind
- 后端: Express v5.2.1 (v2-pixel/server.js) port 3002
- WORKSPACE_ROOT: `path.resolve(__dirname, '../../../..')` (4 层)
- Build: npx tsc --noEmit && npx vite build
- Deploy: cp dist/* → ../v2-pixel/public/

## 待办
- id=6: 产出物与项目说明自动同步 (pending)
- id=7: 迭代 2/3 移动端优化循环 (pending)
