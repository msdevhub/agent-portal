# 后端项目审计报告

审计时间：2026-03-13  
审计范围：`server.js`、`package.json`、`start.sh`、`deploy.sh`、`public/` 目录，以及 `node --check server.js` 结果。

## 1. `server.js` 的完整功能

这是一个单文件的 Node.js + Express 后端，端口固定为 `18820`。主要职责有三类：

1. 提供 JSON API。
2. 提供 `public/` 目录静态文件。
3. 将所有未命中的 GET 请求回退到 `public/index.html`，用于前端单页应用（SPA）。

### 初始化与中间件

- `express.json()`：解析 JSON 请求体。
- `express.static(path.join(__dirname, 'public'))`：把 `public/` 目录作为静态资源根目录。
- `PORT = 18820`：端口写死，未使用环境变量。

### 数据库辅助函数

- `dbQuery(sql)`：
  - 通过 `fetch` 向 `https://db.dora.restry.cn/pg/query` 发起 `POST` 请求。
  - 请求头包含：
    - `apikey: SERVICE_KEY`
    - `Authorization: Bearer SERVICE_KEY`
    - `Content-Type: application/json`
  - 请求体为 `{ query: sql }`
  - 非 2xx 时抛错，并把远端返回文本截断到前 300 个字符。

- `esc(s)`：
  - 把输入转成字符串。
  - 仅将单引号 `'` 替换成 `''`。
  - 这是手工 SQL 转义，不是参数化查询。

### 路由逐项说明

#### `POST /api/init-db`

作用：初始化三张表。

- 创建 `AP_projects`
- 创建 `AP_tasks`
- 创建 `AP_notes`

成功返回：

```json
{ "ok": true, "message": "Tables created" }
```

失败返回 `500` 和 `{ error: e.message }`。

#### `GET /api/stats`

作用：统计仪表盘数据。

- 项目总数
- `active` 项目数
- `completed` 项目数
- 任务总数
- `done` 任务数

返回类似：

```json
{
  "total": 0,
  "active": 0,
  "completed": 0,
  "tasks": 0,
  "tasksDone": 0
}
```

#### `GET /api/projects`

作用：查询所有项目，并附带每个项目的任务统计。

- 返回 `AP_projects` 全字段
- 附带：
  - `task_count`
  - `tasks_done`
- 按 `created_at DESC` 排序

#### `GET /api/projects/:slug`

作用：按项目 `slug` 查询单个项目详情。

流程：

1. 先查 `AP_projects` 中匹配 `slug` 的项目。
2. 若不存在，返回 `404 { error: 'Not found' }`。
3. 若存在，再查该项目下的：
   - `AP_tasks`，按 `priority DESC, created_at ASC`
   - `AP_notes`，按 `created_at DESC`
4. 返回项目对象，并内联 `tasks`、`notes`。

#### `POST /api/projects`

作用：新建项目。

请求体字段：

- `name`
- `description`
- `emoji`
- `stage`

逻辑：

- 从 `name` 自动生成 `slug`
- 默认值：
  - `emoji = '🔬'`
  - `stage = 'question'`

成功返回插入后的项目记录。

#### `PUT /api/projects/:id`

作用：更新项目。

可更新字段：

- `name`
- `description`
- `emoji`
- `stage`
- `status`

附加行为：

- 总会写入 `updated_at = now()`

成功返回更新后的项目记录。

注意：

- 如果传入字段为空，仍会执行 `UPDATE`，但没有对“目标记录不存在”做显式判断。

#### `POST /api/tasks`

作用：新建任务。

请求体字段：

- `project_id`
- `title`
- `description`
- `stage`
- `status`
- `priority`

默认值：

- `description = ''`
- `status = 'pending'`
- `priority = 0`

成功返回插入后的任务记录。

#### `PUT /api/tasks/:id`

作用：更新任务。

可更新字段：

- `title`
- `description`
- `stage`
- `status`
- `priority`

附加行为：

- 总会写入 `updated_at = now()`

成功返回更新后的任务记录。

#### `DELETE /api/tasks/:id`

作用：删除任务。

成功返回：

```json
{ "ok": true }
```

注意：

- 不检查删除前是否存在该任务。

#### `POST /api/notes`

作用：新增项目备注。

请求体字段：

- `project_id`
- `content`
- `type`

默认值：

- `type = 'finding'`

成功返回插入后的备注记录。

#### `GET *`

作用：前端路由兜底。

- 所有未匹配的 GET 请求都会返回 `public/index.html`
- 这意味着前端应该是一个 SPA，由浏览器端路由接管页面切换

## 2. 数据库连接：如何连 Supabase

代码没有使用 `@supabase/supabase-js` SDK，也没有使用连接字符串（如 Postgres DSN）。

实际方式是：

- 直接向 `https://db.dora.restry.cn/pg/query` 发 HTTP `POST`
- 请求体里传原始 SQL：`{ query: sql }`
- 使用同一个 `SERVICE_KEY` 同时作为：
  - `apikey`
  - `Authorization: Bearer <SERVICE_KEY>`

### 连接参数

- URL：`https://db.dora.restry.cn`
- Query endpoint：`https://db.dora.restry.cn/pg/query`
- 认证方式：硬编码的 service role 风格 JWT

### 审计结论

- 代码注释和变量名把它称作 Supabase。
- 但从接入方式看，它不是标准的 Supabase JavaScript SDK 用法，而是通过一个自定义的 HTTP SQL 查询端点访问数据库。
- 密钥直接写在源码里，没有走环境变量。

## 3. API 端点清单

| 方法 | 路径 | 功能 |
| --- | --- | --- |
| `POST` | `/api/init-db` | 创建项目、任务、备注三张表 |
| `GET` | `/api/stats` | 获取项目/任务统计数据 |
| `GET` | `/api/projects` | 获取项目列表及任务统计 |
| `GET` | `/api/projects/:slug` | 获取单个项目详情、任务、备注 |
| `POST` | `/api/projects` | 创建项目 |
| `PUT` | `/api/projects/:id` | 更新项目 |
| `POST` | `/api/tasks` | 创建任务 |
| `PUT` | `/api/tasks/:id` | 更新任务 |
| `DELETE` | `/api/tasks/:id` | 删除任务 |
| `POST` | `/api/notes` | 创建备注 |
| `GET` | `*` | 所有未命中的 GET 请求回退到 `public/index.html` |

### 缺失的常见端点

当前 API 不完整，至少缺少这些常见能力：

- `DELETE /api/projects/:id`
- `GET /api/tasks/:id`
- `DELETE /api/notes/:id`
- 备注更新接口
- 健康检查接口，如 `/health`
- 鉴权相关接口
- 数据校验接口/中间件

## 4. 静态文件服务

配置方式：

- `app.use(express.static(path.join(__dirname, 'public')))`
- 说明 `public/` 是 Web 根目录
- 任何存在于 `public/` 的文件都可以被直接访问

前端兜底方式：

- `app.get('*', ...)` 返回 `public/index.html`
- 这适合 React/Vite 这类 SPA 发布产物

### `public/` 当前内容

- `public/index.html`
- `public/vite.svg`
- `public/assets/index-C-t5cuwC.js`
- `public/assets/index-DkhPGvm1.css`
- `public/brainstorm-v2.md`
- `public/brainstorm.html`
- `public/clawcraft-debate.html`
- `public/clawcraft-prd.html`
- `public/clawcraft-prd.md`

### 审计结论

- `public/index.html` 明显是 Vite 构建产物入口，引用了 `assets/index-C-t5cuwC.js` 和 `assets/index-DkhPGvm1.css`。
- 除了前端构建产物，还暴露了若干 `.html` 与 `.md` 文档文件。
- `public-v2-backup/` 与 `public.v2-backup/` 不在静态服务路径内，不会被 Express 直接对外提供。

## 5. 依赖：`package.json`

当前 `package.json` 很小：

- 名称：`agent-portal-pixel`
- 版本：`1.0.0`
- 描述：`Pixel-style research project management dashboard`
- 入口：`server.js`
- 脚本：
  - `npm start` -> `node server.js`
- 运行时依赖：
  - `express@^4.21.0`

### 审计结论

- 没有 `devDependencies`
- 没有测试框架
- 没有 `dotenv`
- 没有 `@supabase/supabase-js`
- 没有安全中间件，如 `helmet`
- 没有日志中间件，如 `morgan`
- 没有校验库，如 `zod`、`joi`

## 6. 启动方式：`start.sh` 和 `deploy.sh`

### `start.sh`

内容逻辑：

1. `cd` 到脚本所在目录
2. 执行 `npm install`
3. 执行 `node server.js`

使用方式：

```bash
bash start.sh
```

特点：

- 每次启动都会重新执行 `npm install`
- 不适合高频重启或生产场景
- 不读取环境变量配置

### `deploy.sh`

内容逻辑：

1. 进入 `/tmp`
2. 删除旧目录 `project-management`
3. 从 GitHub 克隆 `https://github.com/bochub/project-management.git`
4. `npm install`
5. `npx vite build`
6. 将构建出的 `dist` 复制到当前项目的 `public/`
7. 杀掉占用 `18820` 端口的进程
8. 在当前项目目录后台执行 `node server.js`

使用方式：

```bash
bash deploy.sh
```

### 审计结论

- `deploy.sh` 部署的是前端构建产物，不是从当前仓库构建前端。
- 它把外部仓库 `project-management` 的 `dist/` 覆盖到本项目 `public/`。
- 然后再重启本项目的 `server.js`。
- 也就是说，这个“部署”脚本本质上是：
  - 从另一个仓库构建前端
  - 将构建结果塞进当前后端目录
  - 启动当前 Node 服务

### 风险与问题

- 强依赖外部 GitHub 仓库可访问。
- 强依赖本机安装 `git`、`npm`、`npx`、`lsof`。
- 会直接 `rm -rf $V2/public`，部署失败时可能导致静态资源目录为空。
- 没有回滚机制。
- 没有进程管理器，如 `pm2`、`systemd`、`supervisor`。

## 7. `node --check server.js` 语法检查

已执行：

```bash
node --check server.js
```

结果：

- 无输出
- 退出码为 `0`

结论：

- `server.js` 语法层面通过

补充：

- 当前环境 `node -v` 为 `v22.22.0`
- 因此 `server.js` 使用的全局 `fetch` 在本环境中可用

## 8. 错误处理和安全性

### 错误处理现状

优点：

- 每个 API 路由基本都包了 `try/catch`
- 出错时会返回 `500` 和 JSON：`{ error: e.message }`

不足：

- 没有统一错误处理中间件
- 没有请求日志
- 没有错误分级
- 没有超时控制
- 没有数据库重试机制
- 直接把 `e.message` 返回给客户端，可能泄漏内部实现细节

### 安全性现状

存在明显高风险问题：

1. **数据库高权限密钥硬编码在源码中**
   - `SERVICE_KEY` 直接写死在 `server.js`
   - 一旦代码泄露，相当于数据库高权限凭据泄露

2. **SQL 直接字符串拼接**
   - 所有 SQL 都是模板字符串拼接
   - `esc()` 只替换单引号，不是可靠的参数化查询方案
   - 存在 SQL 注入与语句构造脆弱性风险

3. **没有任何鉴权**
   - 所有 API 默认公开可访问
   - 尤其是 `POST /api/init-db` 风险很高，外部可直接触发表创建

4. **没有输入校验**
   - 没有校验必填字段、字段长度、枚举值、UUID 格式
   - 非法输入可能直接打到数据库层

5. **没有安全中间件**
   - 无 `helmet`
   - 无 `cors` 显式策略
   - 无 rate limiting
   - 无 CSRF 防护

6. **端口与配置硬编码**
   - 端口、数据库地址、认证信息都写死
   - 无法按环境切换

### 数据完整性问题

- `PUT`/`DELETE` 操作不判断目标是否存在
- 新建项目时 `slug` 由 `name` 派生，但未处理重名冲突的友好提示
- 缺少事务控制
- 缺少迁移系统

## 9. 总结：后端目前是什么状态？能正常运行吗？API 完整吗？

### 当前状态

这是一个“能表达业务原型”的极简后端，不是成熟后端。

它已经具备：

- 基础项目/任务/备注 API
- 基础统计 API
- 表初始化 API
- 静态文件托管
- SPA 路由回退

但它仍然停留在原型或内部演示阶段，主要原因是：

- 凭据硬编码
- 无鉴权
- 无参数化查询
- 无输入校验
- 无统一错误处理
- 无测试
- 无配置分层
- 部署脚本耦合外部仓库

### 能否正常运行

结论要分层看：

1. **语法层面**
   - 可以，`node --check server.js` 通过。

2. **运行时依赖层面**
   - 在 Node 18+ 环境下，`fetch` 可用。
   - 当前审计环境是 `Node v22.22.0`，这一点没问题。

3. **实际启动层面**
   - 我在当前沙箱环境尝试 `node server.js` 时，因环境不允许监听端口而报 `EPERM: operation not permitted 0.0.0.0:18820`。
   - 这更像是审计环境限制，不足以证明代码本身无法启动。

4. **数据库联通层面**
   - 我没有在本次审计中实际打通远端数据库请求。
   - 因此无法实证确认 `https://db.dora.restry.cn/pg/query` 当前是否可访问、认证是否仍有效、表结构是否兼容。

综合判断：

- **这份代码大概率可以在合适的 Node 环境中启动起来。**
- **但数据库相关 API 是否能真实可用，仍取决于远端 `db.dora.restry.cn` 服务是否在线、该 service key 是否有效、数据库权限是否允许这些 SQL。**

### API 是否完整

不完整。

它只覆盖了最基本的 CRUD 子集，仍缺少：

- 项目删除
- 备注更新/删除
- 单任务查询
- 健康检查
- 鉴权
- 参数校验
- 分页、过滤、搜索
- 统一版本化和错误码设计

## 最终判断

如果把它定义为“原型后端”：

- 基本可用
- 结构简单
- 便于快速演示

如果把它定义为“可上线后端”：

- 目前不达标

上线前至少应完成：

1. 把数据库 URL 和密钥移到环境变量。
2. 移除源码中的 service role key。
3. 改为参数化查询或受控的数据访问层。
4. 给写接口加鉴权。
5. 禁止公开暴露 `/api/init-db`。
6. 增加输入校验、日志、健康检查和测试。
7. 重构部署方式，去掉对外部仓库的强耦合。
