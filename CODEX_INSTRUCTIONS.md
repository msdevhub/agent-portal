# Agent Portal 优化 — Wave 4: 研究工作台

## 目标
把 Agent Portal 从展示面板改成**研究管理工作台**。核心用户需求：
1. 查看项目进度/状态/产出物 + **模型交互上下文和记忆**（最重要）
2. 直接编辑产出内容/上下文/记忆文件

## 前端改动 (v3-shadcn)

### 1. Markdown 弹窗查看器/编辑器
- 安装 `react-markdown` + `remark-gfm` + `rehype-raw`
- 点击 `.md` 类型的产出物 → 弹窗全屏显示 Markdown 渲染内容
- 弹窗右上角有"编辑"按钮，点击切换为 textarea 编辑模式
- 编辑后点"保存"→ PUT `/api/doc/:slug/:path` 写回文件
- 弹窗样式：暗色背景 `bg-[#0d1019]`，内容区白色文字，代码块有高亮背景

### 2. 新增"上下文 & 记忆"区块（在项目详情面板里）
这是最重要的功能。每个项目应该展示：

#### a. 工作区上下文文件
从 `/api/context` 获取，展示：
- `SOUL.md` — Agent 身份定义
- `AGENTS.md` — 工作流程定义
- `USER.md` — 用户信息
- `HEARTBEAT.md` — 心跳周期配置
- `TOOLS.md` — 工具说明
- `IDENTITY.md` — 身份信息

每个文件显示为一行，可点击打开 Markdown 弹窗查看/编辑。

#### b. 记忆文件
从 `/api/memory` 获取，展示 `memory/` 目录下的所有 `.md` 文件。
按日期倒序排列，可点击打开查看/编辑。

#### c. 项目 CONTEXT
项目的 `CONTEXT.md` 是最重要的上下文，在每个项目详情顶部显示"项目上下文"按钮。

### 3. UI 布局调整
- 项目详情面板的区块顺序：
  1. 研究阶段 & 产出物（已有，保持不变）
  2. **上下文 & 记忆**（新增 — 最重要）
  3. 阶段任务
  4. 研究笔记
  5. 研究时间线
- `.custom-scrollbar` 样式已在 index.css 中定义

## 后端改动 (v2-pixel/server.js)

### 1. 新增 API 端点

```
GET  /api/context
```
返回工作区顶层 `.md` 文件列表：
```json
[
  { "name": "SOUL.md", "path": "SOUL.md", "size": 1125, "mtime": "2026-03-10" },
  ...
]
```

```
GET  /api/memory
```
返回 `memory/` 目录下所有 `.md` 文件：
```json
[
  { "name": "2026-03-13.md", "path": "memory/2026-03-13.md", "size": 4096, "mtime": "2026-03-13" },
  ...
]
```

```
GET  /api/workspace/:path
```
读取工作区任意文件内容（Markdown）。`path` 可以是 `SOUL.md` 或 `memory/2026-03-13.md`。
返回纯文本 Markdown。

```
PUT  /api/workspace/:path
```
写入文件内容。请求体 `{ "content": "..." }`。
写入成功返回 `{ "ok": true }`。

同时也支持：
```
PUT  /api/doc/:slug/:path
```
写入项目目录下的文件。

### 2. 环境变量
- `WORKSPACE_ROOT` — 工作区根目录（默认 `../../..` 相对于 server.js）

## 约束
- 保持暗色主题 (`bg-[#0a0b14]`)
- 保持现有功能不变（项目 CRUD、任务、笔记、产出物）
- 不要改变现有 API 的行为
- TypeScript 必须通过 `npx tsc --noEmit`
- 构建必须通过 `npx vite build`
- Markdown 弹窗中编辑区用等宽字体
- 代码最后通过以下验证：
  ```bash
  cd v3-shadcn && npx tsc --noEmit
  cd v3-shadcn && npx vite build
  node --check v2-pixel/server.js
  ```

## 文件结构
```
v3-shadcn/
  src/
    App.tsx           ← 主应用（大部分改动在这里）
    lib/api.ts        ← API 调用函数
    lib/constants.ts  ← 常量定义
    lib/utils.ts      ← 工具函数
    index.css         ← 全局样式（已有 custom-scrollbar）
v2-pixel/
  server.js           ← Express 后端（所有 API）
```
