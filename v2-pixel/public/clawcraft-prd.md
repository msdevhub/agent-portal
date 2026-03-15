# ClawCraft — 产品需求文档 (PRD)

> **版本**: v1.3  
> **日期**: 2026-03-12  
> **作者**: Ottor（研究助手）  
> **设计辩论**: Gemini 3.1 Pro × 10 轮 | GPT-5.4 × 16 轮 | Claude Sonnet × 2 轮  
> **PRD 审查**: R1（完善/合理/可行）+ R2（阶段划分）— GPT-5.4 / Claude / Gemini 三方  
> **状态**: 待 @dora 确认

---

## 1. 产品定位

### 一句话
**ClawCraft 是 OpenClaw 的 RTS 风格图形操作界面 — 用 2.5D 等距游戏世界替代传统的 Channel 对话和 CLI 配置工作。**

### 核心价值（并列，不分主次）
| 价值 | 说明 |
|:--|:--|
| **监控** | 3 秒看懂全局 — "谁在干什么、是否异常" |
| **操控** | 替代 Channel 对话 + CLI 配置 — 对话、指令、会话管理、记忆操作、技能安装、路由配置全在游戏界面完成 |
| **陪伴** | 长开当第二屏，有生活感的"数字鱼缸" |
| **展示** | OpenClaw 品牌资产，一看就懂 Agent 系统在干什么 |

> **设计原则：ClawCraft = OpenClaw 的图形化客户端。** 用户不再需要打开 Telegram/Discord/Mattermost 跟 Agent 对话，也不需要用 CLI 改配置。所有交互都在 RTS 游戏世界里完成。

### 目标用户
**主要用户**: OpenClaw 管理者（如 @dora），同时运行多个 Agent、多个 Channel 的日常使用者。

**用户痛点**:
- 多 Agent 多 Channel 切来切去，缺全局视图
- 文字对话流里找信息效率低
- 配置修改靠 CLI + 手编文件，没有可视化
- 无法直观看到 Agent 工作过程

**ClawCraft 的答案**:
- 一个页面看全局：所有 Agent 的状态、活动、关系一览无余
- 在 RTS 界面里跟任何 Agent 对话（替代 Channel）
- 右键菜单完成所有管理操作（替代 CLI）
- 工作过程动画化，资源消耗可视化

---

## 2. ClawCraft 替代的传统工作流

| 传统方式 | ClawCraft 操作 | 对应游戏元素 |
|:--|:--|:--|
| 打开 Mattermost 发消息给 Agent | 选中探险者 → 对话面板输入 | 领主大厅·信使台 |
| 在 Telegram 群里看 Agent 回复 | 观察卷轴飘出 + 单位卡·产出 Tab | 发光卷轴 |
| 翻聊天记录看历史 | 左键档案馆 → Transcript 时间线 | 战史卷轴 |
| `openclaw gateway restart` | 双击王城 → 确认重启 | 王城操作 |
| `openclaw status` | 直接看地图 — 建筑亮灭、旗帜颜色 | 世界状态 |
| 手编 SOUL.md / AGENTS.md | 右键大厅 → 编辑面板 | 大厅·文书阁 |
| 手编 openclaw.json bindings | 拖旗到大厅 / 治理面板·路由图 | 拖拽连线 |
| `clawhub install <skill>` | 右键科技架 → 商店 → 安装 | 科技树界面 |
| `memory_store / recall / forget` | 右键图书馆 → 操作面板 | 图书馆交互 |
| 切换不同 Channel 看不同 Agent | 全在一张地图上，镜头移动即切换 | 地图导航 |
| 查看 Token 用量 | HUD 资源条 + 历史图表 | 粮草金币 |
| `sessions_send` 跨 Agent 通信 | 拖探险者到目标大厅 → 派信使 | 信使系统 |
| 审批 exec 请求 | HUD 审批队列弹窗 → 批准/拒绝 | 审批队列 |

---

## 3. 视觉设计

### 风格
**2.5D 等距像素风（Isometric Pixel Art）**，致敬帝国时代 2。赛博中世纪色调：石砌建筑 + 服务器蓝光。

### 地图布局
固定等距大地图，中心是王城（Gateway），周围分布各 Agent 的领地。

```
        [前哨塔-Node]
            |
    [港口-Channel] ─── [王城-Gateway] ─── [港口-Channel]
            |               |
    [Agent领地-A]    [Agent领地-B]    [Agent领地-C]
     ├ 大厅              ├ 大厅            ├ 大厅
     ├ 图书馆(Memory)    ├ 工坊群(Tool)   ├ ...
     ├ 作坊群(Tool)      ├ 科技架(Skill)
     ├ 碑塔(Compaction)  └ 档案馆(Transcript)
     └ 科技架(Skill)
```

### 素材策略
**统一美术方向**：采用单一风格基础资产（如 Kenney Tiny Swords 系列），通过**颜色、光效、文字 Label** 区分不同实体。避免从不同开源包拼凑导致画风不统一。

- AI 辅助概念图，统一后制作 spritesheet
- 所有素材需 CC0/MIT 许可，集中归档管理
- MVP 阶段使用简单几何体 + 颜色（白模），验证后再换精细素材

### 开发者滤镜（Developer Vision）
一键切换：
- **游戏模式**：完整 RTS 视觉隐喻
- **开发者模式**：所有实体显示真实技术标签（如 "Tool: web_search"），建筑简化为带状态色方块

---

## 4. 核心概念映射

### 世界元素（地图上的实体）

| # | OpenClaw 概念 | RTS 对应 | 视觉表现 | 状态表达 |
|:--|:--|:--|:--|:--|
| 1 | **Gateway** | 🏰 王城 | 中央堡垒 + 全图光圈 | 绿=运行 / 黄=重启中 / 红=停止 |
| 2 | **Agent** | 🏛️ 领主大厅 | 独立城池 + 英雄旗帜 | 旗色=persona / 冒烟=忙碌 |
| 3 | **Session** | ⚔️ 探险者 | 单兵单位，背卷轴 | 血条=context 余量 / Zzz=idle |
| 4 | **Run** | 🎯 出征 | 头顶进度环 | 蓝=思考 / 橙=工具 / 白=发言 / 灰=结束 |
| 5 | **Sub-Agent** | 🗡️ 雇佣英雄 | 分叉小队 | 深度徽章 + 链标 |
| 6 | **Tool** | 🔨 作坊群 | 铁匠铺/马厩/风车等 | 亮=可用 / 锁=禁用 / 沙漏=忙 |
| 7 | **Skill** | 📜 科技卷轴 | 书架 + 科技树节点 | 已学=亮 / 可学=虚 / 过时=橙 |
| 8 | **Memory** | 📚 图书馆 | 书库 + 记忆水晶 | 热记忆发光 / 旧记忆蒙尘 |
| 9 | **Channel/Account** | ⚓ 港口使馆 | 平台旗帜码头 | 在线=绿 / 掉线=灰 / 未授=锁 |
| 10 | **Node** | 🗼 前哨塔 | 地图边缘盟点 | 心跳脉冲 / 离线=灰 |
| 11 | **Compaction** | 🪦 编年碑 | 广场石碑 | 卷轴汇流刻入碑塔 |
| 12 | **Transcript** | 📖 战史卷轴 | 档案长卷 | 新墨迹高亮 |
| 13 | **Token Usage** | 💰 粮草金币 | HUD 资源条 | 超耗红闪 |

### HUD/面板元素（不做成游戏建筑）

| OpenClaw 概念 | HUD 表现 |
|:--|:--|
| Context Window | 探险者脚下视野圈（逼近上限红边） |
| Auth Profiles | 治理面板·印玺（金有效/灰过期/红错） |
| Sandbox | 治理面板·结界卡（蓝罩/红裂） |
| Tool Policy | 治理面板·权限表（绿勾/红禁） |
| Exec Approvals | 审批队列弹窗（黄待批/绿批/红拒） |
| Presence | 前哨塔/港口灯火（亮/闪/灭） |
| Plugin | 治理面板·齿轮工坊状态 |
| Cron/Heartbeat | 钟楼摆钟 + 滴答脉冲 |
| Bindings | 治理面板·路由图（节点连线） |
| Workspace Files | 治理面板·文件柜（改动蓝/冲突红） |

---

## 5. 动画与视觉流程

### 事件→动画映射

| 事件 | 游戏动画 | 工具分类 |
|:--|:--|:--|
| lifecycle:start | 探险者出城门 | — |
| thinking stream | 原地蓄力 + 光环 + 思绪符文 | — |
| web_search/fetch/browser | 工匠奔向搜索作坊（风车亮起） | gather |
| read | 图书馆翻阅 | observe |
| write/edit | 挖矿-建造动画 | build |
| exec/process | 工坊锻造（火花四溅） | forge |
| memory_* | 档案馆书卷操作 | memory |
| message/tts | 信使塔放鸽 | message |
| sessions_spawn | 兵营召唤分身 | spawn |
| assistant stream | 发光卷轴从窗口飘出 | — |
| lifecycle:end | 探险者回城交付 | — |
| error | 红闪 + 眩晕 + 断链图标 | — |

### 知识产出完整流程（10 步）

1. **信使到达** — 城门号角响，信使骑马冲进大厅，Run 旗升起
2. **思考蓄力** — 大厅法阵聚光，英雄静止蓄力，头顶思绪符文盘旋
3. **搜索出发** — 工匠奔向搜索作坊，web_search 风车齿轮启动
4. **结果返回** — 结果箱沿轨道滑回广场
5. **整理组织** — 英雄法阵边重排、归类、连线
6. **卷轴飘出** — 发光答复卷轴从窗口飞出
7. **归档 Transcript** — 副本卷轴收入档案馆
8. **存入 Memory** — 抄写员摘要送入图书馆压成册页
9. **资源消耗** — HUD 粮草火炬递减
10. **追问续战** — 新 Run 开始，英雄先去图书馆抽旧册

### Compaction 流程
僧侣出场 → 散对话摘成短札 → 搬入碑塔刻字 → 旧文折叠入库 → 视野圈先收缩再稳定展开

### Memory 操作
- **store**: 新书贴金边标签，整塔柔光扩散
- **recall**: 检索鸟叼书飞到探险者脚边
- **forget**: 焚毁动画
- **update**: 重写封皮

### 拥挤降级策略
- **>10 同类实体**: 折叠为"军团图标" + 数字角标（⚔️×12）
- **>5 同时 Tool Call**: 工匠合并为队列条
- 点击军团图标展开为列表浮窗

### 挂机 Battle Log
右下角持久化事件日志：
- 自动记录：error、Gateway 变化、Session 生命周期、Compaction
- 红色高亮未读错误，最近 50 条可滚动
- 错误在地图留"废墟标记"直到手动确认

---

## 6. 对话系统（替代 Channel 交互）

### 对话入口
- **选中探险者** → 单位卡·对话 Tab → 聊天输入框
- **右键大厅** → "新建对话" → 创建 Session + 聊天面板
- **双击大厅** → 最近活跃 Session 的对话面板

### 对话面板
```
┌──────────────────────────────────┐
│ 🏛️ Researcher · Session abc     │
│ ──────────────────────────────── │
│ [历史消息滚动区域]                │
│   user: 帮我查一下...            │
│   🔨 tool: web_search           │
│   assistant: 根据搜索结果...      │
│ ──────────────────────────────── │
│ [输入框]  [发送]  [附件]  [语音] │
└──────────────────────────────────┘
```

### 地图与对话联动
- 发消息 → 地图信使骑马冲入大厅 → Run 旗升起
- 思考中 → 探险者蓄力 + 面板 "thinking..."
- Tool 调用 → 工匠奔作坊 + 面板显示工具名
- 回复 → 卷轴飘出 + 面板流式显示
- 两者实时同步，可同时观看

---

## 7. 操作设计（替代 CLI 配置）

### 完整操作体系

| 操作 | RTS 手势 | 真实 API | 安全 |
|:--|:--|:--|:--|
| **对话类** ||||
| 发消息给 Agent | 选中 → 对话面板输入 | `sessions_send` / chat | 🟢 |
| 查看对话历史 | 左键探险者 → 时间线 | `sessions_history` | 🟢 |
| 查看 Run 事件流 | Space 跟随 | `onAgentEvent` SSE | 🟢 |
| **查看类** ||||
| 查看 Agent 信息 | 左键大厅 | `agents.list` | 🟢 |
| 查看 Memory | 左键图书馆 | `memory_recall` | 🟢 |
| 查看 Transcript | 左键档案馆 | `sessions.history` | 🟢 |
| 查看工具/技能 | 左键作坊/科技架 | `tools.catalog` | 🟢 |
| 查看 Node | 左键前哨塔 | `nodes.status` | 🟢 |
| **会话管理** ||||
| 新建会话 | 右键大厅 → /new | `sessions.reset` | 🟡 |
| 压缩对话 | 右键大厅 → /compact | `sessions.compact` | 🟡 |
| 重置会话 | 右键大厅 → /reset | `sessions.reset` | 🟠 |
| **记忆管理** ||||
| 存储记忆 | 右键图书馆 → /store | `memory_store` | 🟡 |
| 更新记忆 | 右键图书馆 → /update | `memory_update` | 🟡 |
| 删除记忆 | 右键图书馆 → /forget | `memory_forget` | 🟠 |
| **配置管理** ||||
| 编辑 SOUL.md | 右键大厅 → 性格编辑 | 文件 API | 🟡 |
| 编辑 AGENTS.md | 右键大厅 → 行为规则 | 文件 API | 🟡 |
| 改路由绑定 | 拖旗到大厅 / 治理面板 | `config.patch` | 🟠 |
| **技能管理** ||||
| 浏览技能商店 | 右键科技架 → 商店 | `clawhub search` | 🟢 |
| 安装/升级技能 | 科技树 → 操作 | `clawhub install/update` | 🟡 |
| **系统管理** ||||
| 重启 Gateway | 双击王城 | `openclaw gateway restart` | 🟠 |
| 跨 Agent 通信 | 拖探险者到目标大厅 | `sessions_send` | 🟠 |
| 审批 Exec | HUD 队列 → 批准/拒绝 | `exec.approval` | 🟡 |

### 安全控制
- 🟢 Green: 即时执行
- 🟡 Yellow: 确认对话框（操作说明 + 影响范围）
- 🟠 Orange: 二次确认（影响/成本/回滚）+ 审计日志

### UX 设计
- **左键选中** → 底栏"单位卡"：5 Tab（概览 / 对话 / 时间线 / 产出 / 动作）
- **右键** → 6 宫格命令轮盘
- **拖拽** → 关系操作（幽灵线 + 合法落点高亮）
- **快捷键**: Tab 切换, Space 跟随, Enter 对话, C/N/R/M/T 快捷操作, Esc 取消

---

## 8. 技术架构

### 技术栈

| 层 | 技术 | 说明 |
|:--|:--|:--|
| 后端 | **OpenClaw Plugin** (TypeScript) | in-process，事件原生 |
| 前端渲染 | **React + PixiJS** (原生) | MVP 用白模简形，逐步替换精细素材 |
| 状态管理 | **Zustand** | SSE→store→渲染 单向数据流 |
| UI 组件 | **shadcn/ui + Tailwind CSS** | HUD / 面板 / 对话框 |
| 构建 | **Vite + TypeScript** | |
| 部署 | **Caddy** 反向代理 | 静态 + /clawcraft/* 代理 |

> **关键决策（审查共识）：MVP 直接用 PixiJS 白模，跳过 CSS/SVG 阶段。** 原因：DOM Y-sorting 是等距视图大坑；CSS→PixiJS 迁移成本 = 推倒重来；白模用简单几何体 + 颜色即可验证。

### 数据流

```
Gateway hooks + onAgentEvent
        ↓
  StateManager（内存 Map 聚合）
        ↓
  /clawcraft/state   (全量快照)
  /clawcraft/events  (SSE 增量)
  /clawcraft/chat    (对话代理)
  /clawcraft/action  (操作代理)
        ↓
  Zustand Store (entities + animations + chat)
        ↓
  PixiJS WorldCanvas     React HUD         Chat Panel
  (地图/建筑/角色)      (资源/面板/弹窗)   (对话/消息)
```

### 插件架构

```
clawcraft-plugin/
├── src/
│   ├── index.ts              # 入口
│   ├── state-manager.ts      # 状态聚合
│   ├── sse-handler.ts        # SSE 流
│   ├── http-routes.ts        # REST 端点
│   └── chat-proxy.ts         # 对话代理
└── package.json
```

**展示端点**：`GET /health` · `/state` · `/events`  
**对话端点**：`POST /chat` · `GET /chat/:sessionKey/history`  
**操作端点**：`POST /action { type, target, params }`（独立错误域）

### 插件稳定性保护

| 措施 | 说明 |
|:--|:--|
| 错误隔离 | try-catch 包裹，不中断 Gateway |
| 事件采样 | thinking/assistant 500ms 采样 |
| 异步缓冲 | hook→StateManager 异步队列 |
| 超时保护 | HTTP 30s 超时 |
| 熔断器 | POST /action 3 次失败 → 熔断 60s |
| 内存监控 | 60s 自检，20MB LRU 淘汰 |
| 三域分离 | 展示 / 对话 / 操作 独立错误域 |

### 前端组件

```
AppShell (React)
├── StateStore (Zustand)
├── HUDLayer (shadcn/ui)
│   ├── ResourceBar           # 粮草/人口
│   ├── UnitCard              # 5 Tab（概览/对话/时间线/产出/动作）
│   ├── ChatPanel             # 对话（替代 Channel）
│   ├── CommandWheel          # 右键轮盘
│   ├── BattleLog             # 事件日志
│   ├── GovernancePanel       # 治理面板
│   └── ConfigEditor          # 配置编辑器
├── ControlLayer              # 倍速/暂停/滤镜
└── WorldCanvas (PixiJS)
    ├── BackgroundLayer       # 等距底图
    ├── BuildingLayer         # 建筑
    ├── UnitLayer             # 单位
    ├── FXLayer               # 特效/粒子
    └── DebugOverlay
```

### 动画系统
- per-session FIFO 队列，同时只播 1 个主动画
- 不同 Session 可并行
- 最小动画时长 1s
- 时间缩放 1x/2x/4x
- 对话联动：消息→信使，回复→卷轴

### 状态模型

```typescript
interface SessionState {
  sessionKey: string;
  sessionId: string;
  agentId: string;
  status: 'idle' | 'thinking' | 'tooling' | 'responding' | 'blocked' | 'ended';
  currentTool?: string;
  currentToolCategory?: 'gather' | 'build' | 'forge' | 'memory' | 'message' | 'observe' | 'spawn' | 'other';
  lastAssistantPreview?: string;   // 200-400 chars
  lastThinkingPreview?: string;
  runCount: number;
  toolCallCount: number;
  errorCount: number;
}

interface AgentState {
  agentId: string;
  name: string;
  model: string;
  status: 'online' | 'offline' | 'unknown';
  soulSummary?: string;
  toolNames: string[];
  skillIds: string[];
  sessionKeys: string[];
}

interface ChatMessage {
  id: string;
  sessionKey: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  timestamp: number;
  toolName?: string;
}
```

### 内存管理
- preview 200-400 chars，不存全文
- 32 事件/session，60s 淘汰完成 Run
- 10min 清空 idle preview，20MB LRU 上限
- 对话历史按需加载

---

## 9. 部署方案

### 网络拓扑
```
浏览器 (443) → Caddy (craft.dora.restry.cn)
  ├── /           → 静态文件
  ├── /clawcraft/ → 127.0.0.1:18789 (Plugin)
  └── /events     → 127.0.0.1:18789 (SSE)
```
18789 不公网暴露，只走 443。

### 认证
| 阶段 | 方案 |
|:--|:--|
| MVP | Caddy BasicAuth |
| Wave 2+ | Portal 统一登录 + HttpOnly cookie |
| 始终 | 前端不存 Gateway token |

### 断线恢复
1. SSE 自动重连 + 指数退避（1s→2s→4s→8s→30s max）
2. 重连后 `/state` 全量恢复
3. `serverInstanceId` 变化 → 清空队列重建世界
4. HUD 显示 Reconnecting + 世界灰化

### 版本兼容
- `/health` 返回 API 版本号
- 前端校验版本，不兼容显示升级提示
- Plugin 校验 `api.runtime.version` 最低版本
- 状态模型版本化迁移

---

## 10. 体验推演

### 场景 1：首次启动（空白世界）
打开 ClawCraft，正中一座 researcher 领主大厅，旗帜轻摆。作坊地基在但没点灯。HUD：1 Agent / 0 Session。安静如刚苏醒的城。

### 场景 2：通过 ClawCraft 对话（替代 Mattermost）
双击 researcher 大厅 → 对话面板打开 → 输入"帮我查一下 PixiJS 最新版本" → 信使骑马入城 → 探险者蓄力 → 工匠奔搜索作坊 → 卷轴飘出 + 面板流式显示。全程动画与文字同步。

### 场景 3：日常成熟形态
8:00 钟楼敲响三城亮起 → 10:00 直接在 ClawCraft 给 coder 布置任务 → 14:00 Compaction 碑塔动画 → 16:00 右键图书馆查看新记忆 → 18:00 科技树安装新 Skill → 20:00 挂机看鱼缸。

### 场景 4：配置管理（替代 CLI）
右键 assistant 大厅 → 命令轮盘 → "编辑性格" → SOUL.md 编辑器弹出 → 修改保存 → 旗帜变色动画。不需要打开终端。

### 场景 5：Gateway 危机
王城闪红 → 全灭 → 探险者失联定格 → HUD Reconnecting → Battle Log 记录时间线 → 恢复 → 回常态。废墟标记留到确认。

### 场景 6：挂机后回来
Battle Log 显示错误/compaction/session 完成 → 废墟标记 → 点击查看 → 确认后消失。

---

## 11. 开发阶段

> §1-§10 是完整产品愿景。以下是实现路径，每个阶段交付独立可用版本。
> 
> **每阶段一个验证假设**（审查共识）：MVP=看懂+能对话 → W1=观赏级世界 → W2=能操作替代CLI → W3=可运营产品

### MVP（2 周）— "看懂 + 能对话"

**验证假设**: 用户是否愿意用 RTS 界面替代 Channel 跟 Agent 对话？

**后端**：
- [ ] 插件框架（register + activate）
- [ ] StateManager（SessionState/AgentState 聚合）
- [ ] 展示端点（health / state / events）
- [ ] 对话端点（POST /chat, GET /chat/history）
- [ ] SSE + 15s 心跳 + 断线重连
- [ ] 事件采集 + 错误隔离 + 事件采样

**前端**：
- [ ] PixiJS 白模等距世界（4 核心：Gateway / Agent / Session / Tool）
  - 白模 = 简单几何体 + 状态颜色 + 文字标签
  - 基础动画：生成/位移/状态切换（PixiJS tween）
- [ ] **对话面板**（发消息 → 看流式回复，替代 Channel）
- [ ] HUD 资源条 + 简版单位卡（3 Tab：概览/对话/时间线）
- [ ] 事件 Ticker（最近 5 条，简版 Battle Log）
- [ ] 断线重连 + 灰化提示
- [ ] 开发者滤镜
- [ ] 3-5 个基础音效（悬停、生成、错误、通知、完成）

**部署**：
- [ ] Caddy + BasicAuth + craft.dora.restry.cn

**成功标准**：
| 指标 | 目标 |
|:--|:--|
| 首次理解时间 | <10s 看懂 Agent/Session/Tool 关系 |
| 对话可用 | 能通过 ClawCraft 完成一次完整对话 |
| 挂机意愿 | @dora 愿意开着看 |

### Wave 1（3-4 周）— "观赏级世界"

**验证假设**: 视觉品质提升后，停留时长和可读性是否显著提高？

- [ ] 白模 → 精细 spritesheet 替换（4 核心元素优先）
- [ ] 完整动画集（idle/walk/cast/error/return）
- [ ] 剩余 9 个世界元素逐步上线（按优先级：Memory > Compaction > Skill > Channel > Sub-Agent > Node > Transcript > Run环 > Token）
- [ ] Memory/Compaction 专属动画流程
- [ ] per-session FIFO 动画队列
- [ ] 拥挤降级（军团图标）
- [ ] Battle Log 完整版（50 条 + 废墟标记）
- [ ] 基础音效扩展（工具声、卷轴声、号角声）

**成功标准**：
| 指标 | 目标 |
|:--|:--|
| 日均使用时长 | >30 min |
| 状态识别 | 80%+ 准确率 |
| 10 Session 流畅 | 无卡顿 |

### Wave 2（3-4 周）— "能操作，替代 CLI"

**验证假设**: 用户是否愿意通过 ClawCraft 替代 CLI 管理 OpenClaw？

- [ ] 右键命令轮盘（Green + Yellow 操作）
- [ ] POST /action 端点上线
- [ ] 会话管理（新建/压缩/重置）
- [ ] Memory 操作（store/update/forget）
- [ ] 配置编辑器（SOUL.md / AGENTS.md / workspace files）
- [ ] Orange 操作（二次确认 + 审计日志）
- [ ] 最小审计日志（Battle Log 内显示操作记录）
- [ ] 倍速播放（1x/2x/4x）
- [ ] Portal 统一登录替代 BasicAuth

**成功标准**：
| 指标 | 目标 |
|:--|:--|
| Channel 替代率 | >50% |
| CLI 替代率 | >30% |
| 操作成功率 | >95% |
| 30+ Session 流畅 | 无卡顿 |

### Wave 3（4-6 周）— "可运营产品"

**验证假设**: ClawCraft 能否作为 OpenClaw 的主力管理界面？

- [ ] 技能管理（浏览/安装/升级/卸载 via 科技树）
- [ ] Transcript 时间线浏览
- [ ] Sub-agent 分身生成/回收可视化
- [ ] 完整治理面板（Tool Policy / Sandbox / Exec Approvals）
- [ ] 拖拽改 Bindings（可视化路由编辑）
- [ ] Gateway 管理操作
- [ ] Node 操作（前哨塔）
- [ ] 完整审计面板
- [ ] 战争迷雾（可选）
- [ ] 多 Gateway 实例切换（可选）

**成功标准**：
| 指标 | 目标 |
|:--|:--|
| Channel 替代率 | >80% |
| CLI 替代率 | >60% |
| 故障发现时间 | <10s |

### 总体路线图

```
MVP (2周)           Wave 1 (3-4周)      Wave 2 (3-4周)      Wave 3 (4-6周)
看懂+对话           观赏级世界           能操作替代CLI         可运营产品
4元素白模+聊天      13元素精细+动画      命令轮盘+编辑器       科技树+治理+拖拽
PixiJS基础          spritesheet          操作端点+审计         完整管理界面
─────────────────────────────────────────────────────────────────────────
                    总计 12-16 周（AI 辅助，单人）
```

---

## 12. 成功标准汇总

| 指标 | MVP | Wave 1 | Wave 2 | Wave 3 |
|:--|:--|:--|:--|:--|
| 首次理解 | <10s | <5s | — | — |
| 日均时长 | — | >30min | >1hr | >2hr |
| Channel 替代 | 能对话 | — | >50% | >80% |
| CLI 替代 | — | — | >30% | >60% |
| 故障发现 | — | <30s | <15s | <10s |
| Session 流畅 | 5 | 10 | 30+ | 50+ |
| 操作成功率 | — | — | >95% | >98% |

---

## 13. 辩论与审查索引

| 阶段 | 参与者 | 内容 | 文件 |
|:--|:--|:--|:--|
| 头脑风暴 R1-R10 | Ottor × Gemini | 视觉/映射/交互 | brainstorm.md |
| 架构辩论 R1-R10 | Ottor × GPT-5.4 | 后端/状态/渲染/部署 | debate-log.md |
| 概念映射 R1-R6 | Ottor × GPT-5.4 | 映射/审计/推演 | concept-debate-log.md |
| PRD 审查 R1 | 三方 | 完善/合理/可行 | prd-review-r1.md |
| PRD 审查 R2 | 三方 | 阶段划分 | prd-review-r2.md |
| API 研究 | Ottor | Plugin API 源码实证 | api-surface.md |

---

## 附录 A：关键技术决策

| 决策 | 选择 | 理由 |
|:--|:--|:--|
| 后端 | OpenClaw Plugin | 事件原生，低延迟 |
| 实时传输 | SSE | 单向推送，自动重连 |
| 渲染 | PixiJS 原生（跳过 CSS/SVG） | 审查共识：DOM Y-sorting 是等距大坑，CSS→Pixi 迁移 = 推倒重来 |
| MVP 渲染 | PixiJS 白模（几何体+颜色） | 最快验证 + 无迁移成本 |
| 状态 | Zustand | 轻量 |
| 地图 | 固定大图 | 避免 Tilemap |
| 寻路 | 预设路径 + Bezier | 避免 A* |
| 认证 | 服务端注入 token | 安全 |
| 三域分离 | 展示/对话/操作 | 互不影响 |

## 附录 B：Plugin API

详见 `api-surface.md`。关键：
- 事件：session_start/end, before/after_tool_call, subagent_spawned/ended, onAgentEvent
- HTTP：registerHttpRoute (auth: 'gateway')
- 服务：registerService (start/stop)
- 查询：getSession, getSessionMessages, loadConfig
- 操作：enqueueSystemEvent, runCommandWithTimeout

## 附录 C：修订记录

| 版本 | 日期 | 变更 |
|:--|:--|:--|
| v1.0 | 2026-03-12 | 初版 |
| v1.1 | 2026-03-12 | R1 审查：开发者滤镜、Battle Log、拥挤降级、Plugin 稳定性、量化标准 |
| v1.2 | 2026-03-12 | @dora 反馈：定位从"监控为主"改为"替代 Channel+CLI"，新增对话系统 §6、工作流替代表 §2 |
| v1.3 | 2026-03-12 | R2 审查整合：跳过 CSS/SVG 直接 PixiJS 白模、MVP 加基础音效、阶段重新定义（每阶段单一验证假设）、功能重排（Battle Log 完整版→W1、命令轮盘→W2、拖拽→W3）、工时调整 12-16 周 |
