# 前端项目审计报告

审计时间：2026-03-13（UTC）
审计工具：Codex (gpt-5.4)
项目路径：`v3-shadcn/`

## 1. 项目结构

```
v3-shadcn/
├── src/
│   ├── App.tsx (760行) — 当前主入口，含项目总览/详情/新建
│   ├── main.tsx — 挂载 App
│   ├── components/
│   │   ├── App.tsx (86行) — 旧版App（未引用，死代码）
│   │   ├── HUD.tsx — 顶部统计栏（仅旧版用）
│   │   ├── ProjectLane.tsx — 看板泳道（仅旧版用）
│   │   ├── ProjectDrawer.tsx (324行) — 右侧抽屉详情（仅旧版用）
│   │   ├── CreateProjectDialog.tsx — 新建对话框（仅旧版用）
│   │   └── ui/ — shadcn组件 ×12
│   └── lib/
│       ├── api.ts — API层，10个接口封装
│       ├── constants.ts — 阶段/状态/笔记类型常量
│       └── utils.ts — cn() 工具
├── dist/ — 构建产物（2026-03-11 05:01 UTC）
└── package.json
```

## 2. 技术栈

| 依赖 | 版本 |
|------|------|
| React | 19.2.4 |
| TypeScript | 5.9.3 |
| Vite | 7.3.1 |
| Tailwind CSS | 4.2.1 |
| shadcn (base-ui) | 4.0.2 |
| lucide-react | 0.577.0 |

## 3. App.tsx 状态

- **功能**: 项目列表、统计摘要、阶段总览、项目详情侧栏、任务管理、笔记管理、新建项目
- **`npx tsc --noEmit`**: ✅ 通过
- **`npx vite build`**: ⚠️ `vite.config.ts` 用了 `__dirname`，ESM模式下报错（但2天前的dist产物证明旧版可以构建）

### Bug/风险

1. **API层 `api()` 无条件 `res.json()`** — `DELETE`/`init-db` 返回空body时会崩
2. **零错误处理** — 所有API调用无 try/catch，后端异常=白屏
3. **N+1查询** — `reload()` 先列表再逐个查详情
4. **两套App共存** — `src/App.tsx` vs `src/components/App.tsx`，维护混乱
5. **`__dirname` 兼容** — `vite.config.ts` 需改为 `import.meta.dirname`

## 4. 组件完成度

| 组件 | 完成度 | 使用状态 |
|------|--------|----------|
| `src/App.tsx` (主入口) | ✅ 完成 | 当前使用 |
| `src/components/App.tsx` (旧版) | ✅ 完成 | ❌ 未引用 |
| `HUD.tsx` | ✅ 完成 | ❌ 仅旧版 |
| `ProjectLane.tsx` | ✅ 完成 | ❌ 仅旧版 |
| `ProjectDrawer.tsx` | ✅ 完成 | ❌ 仅旧版 |
| `CreateProjectDialog.tsx` | ✅ 完成 | ❌ 仅旧版 |
| shadcn/ui ×12 | ✅ 完成 | 部分使用 |

## 5. API层 (`lib/api.ts`)

连接 `/api` → Vite代理 → `http://localhost:3002`

| 方法 | 路径 | 用途 |
|------|------|------|
| GET | /api/stats | 统计 |
| GET | /api/projects | 项目列表 |
| GET | /api/projects/:slug | 项目详情 |
| POST | /api/projects | 新建项目 |
| PUT | /api/projects/:id | 更新项目 |
| POST | /api/tasks | 新建任务 |
| PUT | /api/tasks/:id | 更新任务 |
| DELETE | /api/tasks/:id | 删除任务 |
| POST | /api/notes | 新建笔记 |
| POST | /api/init-db | 初始化数据库 |

## 6. 总结

**状态: POC半成品，可演示但不稳健**

- 功能层面: 项目管理CRUD基本完整
- 代码质量: TypeScript通过，但零错误处理+零加载状态
- 架构: 两套App共存，需要清理
- 构建: dist/存在旧产物，当前vite.config有ESM兼容问题
- 缺失: 错误处理、Loading状态、Empty状态、表单验证、API重试
