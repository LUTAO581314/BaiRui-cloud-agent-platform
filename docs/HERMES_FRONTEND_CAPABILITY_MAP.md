# Hermes 前端能力地图

状态：设计基线  
适用仓库：`BaiRui-cloud-agent-platform`、`BaiRui-agent`  
官方审计基线：`NousResearch/hermes-agent@abc22cdf1a5c0fe30bf1a226bfe3caf489e8316e`（2026-07-17）  
百瑞当前 Hermes 基线：`7acaff5ef2bcbaa22bd23b72efe60906123a4f55`（2026-07-10）  
百瑞实现基线：`BaiRui-cloud-agent-platform@8139597215aa64433122c6163995ca7ab678f560`（`v0.1.0-rc.7` 分支）

## 1. 结论

百瑞不能把 Hermes 官方 Dashboard 原样暴露给云用户，也不能只做一个“Provider + Base URL + Model + API Key”表单就宣称完成 Hermes 初始化。

Hermes 官方 Dashboard 是面向单机所有者的安装管理面板，混合了四种权限完全不同的能力：

1. Agent 用户能力：聊天、会话、模型、工具、技能、记忆、任务、文件、渠道。
2. Agent 高级配置：OAuth、Provider 路由、MCP、Profile、Webhook、插件。
3. 主机运维能力：进程、日志、备份、导入、升级、迁移、Doctor、Gateway 重启。
4. 高危本机能力：原始 `.env`、原始 YAML、文件系统、终端、Git 写操作、调试包。

百瑞只保留一套基于 BaiLongma 深度适配的用户前端。Hermes 能力通过百瑞的用户身份、Agent 所有权和策略边界接入，不增加第二套 Hermes Dashboard。百瑞总控层继续只管理机群、部署、版本、资源、健康、命令、备份和发布证据，不读取对话正文、记忆正文或模型密钥。

当前 `rc.7` 已经解决“用户只能看到自己的 Agent”和“首次初始化可填写私有 OpenAI 兼容模型”两个关键问题，但这只是完整 Hermes 前端的第一段安全闭环，不是完整初始化。

## 2. 官方事实基线

本次统计直接来自上述 Hermes 官方提交，不使用二手介绍：

| 官方范围 | 数量 | 说明 |
| --- | ---: | --- |
| 功能文档 | 47 | `website/docs/user-guide/features/*.md` |
| 渠道文档 | 32 | `website/docs/user-guide/messaging/*.md` |
| Bundled Skills 文档 | 73 | 随 Hermes 分发 |
| Optional Skills 文档 | 101 | 用户可选安装 |
| Web Server 路由 | 219 | 92 GET、79 POST、25 PUT、16 DELETE、2 PATCH、5 WebSocket |
| 官方固定 Provider 条目 | 37 | `CANONICAL_PROVIDERS` |
| 自定义端点 | 1 | 作为特殊 Provider 入口 |
| 模型入口合计 | 38 | 37 个固定条目加 Custom Endpoint；插件还可动态扩展 |
| 辅助模型槽位 | 11 | 标题、视觉、压缩、审批、网页提取、技能、MCP、看板等 |

官方证据：

- [Quickstart](https://github.com/NousResearch/hermes-agent/blob/abc22cdf1a5c0fe30bf1a226bfe3caf489e8316e/website/docs/getting-started/quickstart.md)
- [Providers](https://github.com/NousResearch/hermes-agent/blob/abc22cdf1a5c0fe30bf1a226bfe3caf489e8316e/website/docs/integrations/providers.md)
- [Configuring Models](https://github.com/NousResearch/hermes-agent/blob/abc22cdf1a5c0fe30bf1a226bfe3caf489e8316e/website/docs/user-guide/configuring-models.md)
- [Web Dashboard](https://github.com/NousResearch/hermes-agent/blob/abc22cdf1a5c0fe30bf1a226bfe3caf489e8316e/website/docs/user-guide/features/web-dashboard.md)
- [Sessions](https://github.com/NousResearch/hermes-agent/blob/abc22cdf1a5c0fe30bf1a226bfe3caf489e8316e/website/docs/user-guide/sessions.md)
- [Memory](https://github.com/NousResearch/hermes-agent/blob/abc22cdf1a5c0fe30bf1a226bfe3caf489e8316e/website/docs/user-guide/features/memory.md)
- [Cron](https://github.com/NousResearch/hermes-agent/blob/abc22cdf1a5c0fe30bf1a226bfe3caf489e8316e/website/docs/user-guide/features/cron.md)
- [Skills](https://github.com/NousResearch/hermes-agent/blob/abc22cdf1a5c0fe30bf1a226bfe3caf489e8316e/website/docs/user-guide/features/skills.md)
- [MCP](https://github.com/NousResearch/hermes-agent/blob/abc22cdf1a5c0fe30bf1a226bfe3caf489e8316e/website/docs/user-guide/features/mcp.md)
- [Security](https://github.com/NousResearch/hermes-agent/blob/abc22cdf1a5c0fe30bf1a226bfe3caf489e8316e/website/docs/user-guide/security.md)
- [Web API source](https://github.com/NousResearch/hermes-agent/blob/abc22cdf1a5c0fe30bf1a226bfe3caf489e8316e/hermes_cli/web_server.py)

## 3. 当前百瑞覆盖情况

### 3.1 已经真实存在

- 用户、组织和 Agent 所有权隔离；非所有者不能读取、初始化、授权或调用目标 Agent。
- BaiLongma 是唯一用户前端，已有聊天、Agent、记忆、技能、渠道、热点、Runs、Jobs、用量和设置视图。
- Hermes 会话创建、列表、消息、分叉和聊天接口已经有 BFF 路由。
- Hermes Run 创建、状态、SSE、审批和停止已经有 Bridge/BFF 基础接口。
- Hermes Job 列表、创建、编辑、暂停、恢复、触发和删除已经有 Bridge 基础接口。
- PostgreSQL 保存百瑞用户、Agent、授权、配置、审计和 Obsidian 兼容 Markdown 记录。
- `rc.7` 首次初始化支持平台模型或 Agent 私有模型；私有密钥按组织、用户和 Agent 加密保存。

### 3.2 只有部分闭环

- 初始化只覆盖 OpenAI 兼容 API Key/Bearer Token，不覆盖 Hermes OAuth、订阅、云凭据、本地模型和完整设置模式。
- 会话有基础接口，但 UI 尚未完整覆盖搜索、重命名、归档、批量清理、导入、导出和上下文迁移。
- 技能页面当前主要是发现和启停偏好，不等于 Hermes Skills Hub 的搜索、预览、安全扫描、安装、升级、卸载和编辑。
- 渠道页面当前主要保存百瑞渠道绑定，不等于 Hermes 官方渠道 onboarding、测试、Pairing、Gateway 状态和真实收发闭环。
- Jobs 已有 CRUD，但缺少官方运行历史、交付目标、Blueprint、脚本模式、模型固定和续聊策略。
- 用量页面依赖百瑞遥测摘要，不等于 Hermes 的会话、模型、工具和技能分析。
- Obsidian 兼容记录与 Hermes `MEMORY.md`、`USER.md` 已有投影设计，但浏览器不能成为唯一同步触发者。

### 3.3 明确缺失

- Provider OAuth、凭据池、模型路由、Fallback、别名、Fast Mode、Reasoning Effort 完整配置。
- 11 个辅助模型槽位和会话内模型切换。
- 工具集配置、工具后端、工具级权限和安装后动作。
- MCP、Webhook、Profile、SOUL、插件、Hook、文件/项目、Git/Checkpoint。
- Voice、STT、TTS、视觉上传、图片生成和视频能力的完整前端。
- 子 Agent、Delegation、Goals、Kanban/Command Center。
- 用户可理解的安全策略、诊断和恢复流程。

### 3.4 Bridge 差距

当前 `BaiRui-agent/packages/core/hermes-bridge/bridge.mjs` 只有 25 个普通操作和 2 个流式操作，主要覆盖健康、发现、Sessions、Runs 和 Jobs。Hermes 官方 219 个 Dashboard 路由中，大部分管理能力尚无百瑞显式 Adapter。

结论：当前页面是可用的产品外壳，但不能作为“完整 Hermes 前端”验收。

## 4. 百瑞唯一用户前端的信息架构

不复制 Hermes 官方 18 个侧边栏入口。BaiLongma 使用五个一级区域，两侧栏均可收起：

| 一级区域 | 放入的 Hermes 能力 | 默认可见性 |
| --- | --- | --- |
| 对话 | 聊天、会话、模型快速切换、推理强度、工具状态、审批、附件、Artifacts | 所有 Agent 用户 |
| 工作区 | 文件、项目、上下文引用、记忆、Checkpoint、Git 只读/受控写操作 | 按 Agent 能力和策略 |
| 自动化 | Jobs/Cron、运行历史、交付目标、Goals、Delegation、Kanban | 按套餐和 Agent 能力 |
| 能力中心 | 工具、技能、MCP、渠道、Webhook、语音/视觉/图片能力 | Agent 所有者 |
| Agent 设置 | 初始化、Provider、模型、Profile/SOUL、安全、用量、诊断 | Agent 所有者 |

百瑞管理员界面保持独立构建和独立权限：机群、用户归属、部署、版本、资源、健康、命令、发布、备份、审计摘要。管理员可以看状态和计量，但默认不能看用户对话、记忆正文、文件正文或原始凭据。

## 5. 完整初始化流程

Hermes 官方新安装提供 Quick Setup、Full Setup 和 Blank Slate。百瑞应映射成用户能理解的三种模式：

| 百瑞模式 | Hermes 对应 | 默认行为 |
| --- | --- | --- |
| 推荐配置 | Quick Setup | 平台模型或受支持 OAuth，启用百瑞推荐的安全工具和记忆策略 |
| 自定义配置 | Full Setup | 用户逐项选择 Provider、模型、工具、技能、记忆、渠道和高级策略 |
| 最小配置 | Blank Slate | 只启用模型、受限文件操作和受限终端，其余全部关闭 |

初始化必须是可恢复的状态机，而不是一次性弹窗：

1. **确认 Agent**：名称、用途、Profile、工作区、时区和语言。
2. **选择模型来源**：平台模型、个人 Provider、OAuth/订阅、云账号、自定义端点、本地模型。
3. **完成认证**：API Key、Bearer、OAuth Device Code、浏览器 OAuth、AWS/IAM、Vertex Service Account、外部 CLI 登录或无密钥本地端点。
4. **验证 Provider**：由服务端测试认证、端点、模型可用性、最低上下文和工具调用能力；浏览器不直接请求模型供应商。
5. **选择主模型**：只显示已经认证且符合策略的 Provider/Model。
6. **选择辅助模型**：默认 `auto`，高级用户可配置 11 个槽位。
7. **选择能力预设**：推荐、自定义、最小；明确工具、技能、记忆、Cron、MCP 和渠道的启停结果。
8. **配置记忆**：`MEMORY.md`、`USER.md` 写入策略；百瑞 Obsidian 投影是否启用；外部记忆 Provider 可选。
9. **配置渠道**：可跳过；OAuth/扫码/Token、Pairing 和收发测试必须是独立步骤。
10. **准备检查**：Hermes 健康、Provider 实测、数据库、工作区、记忆、Gateway 和必需工具全部给出真实状态。
11. **创建首个会话**：只有准备检查通过后才进入聊天；失败保留已加密凭据并允许从失败步骤继续。

初始化前端必须显示状态：`draft -> validating -> provisioning -> configuring -> verifying -> ready`，以及 `failed` 的明确失败步骤。不能把“配置已保存”显示成“Agent 已可用”。

## 6. Provider 与模型前端

### 6.1 必须支持的认证形态

| 认证形态 | 官方例子 | 百瑞前端形态 |
| --- | --- | --- |
| API Key | OpenRouter、OpenAI API、Fireworks、DeepSeek 等 | 密钥输入、掩码状态、替换、吊销、服务端验证 |
| 浏览器/设备 OAuth | Nous、OpenAI Codex、GitHub Copilot、MiniMax、xAI、Qwen | 开始授权、展示设备码/跳转、轮询、取消、断开 |
| 订阅账号 | Nous Portal、ChatGPT/Codex、Claude Max、Copilot | 明确账号类型、授权状态、套餐限制和到期/刷新状态 |
| 云身份 | AWS Bedrock、Vertex、Azure Foundry | 受控字段或凭据文件上传；禁止把主机全局凭据暴露给其他 Agent |
| 外部进程 | Copilot ACP 等 | 仅私有部署或受信任执行环境；云共享主机默认禁用 |
| 自定义端点 | vLLM、SGLang、Ollama、OpenAI 兼容中转 | HTTPS URL、协议、模型、上下文、认证、健康验证 |
| 本地模型 | LM Studio、Ollama/self-hosted | 仅允许 Agent 网络边界内可达地址；阻止 SSRF 和内网越权 |
| 凭据池 | 多个 OpenRouter/Anthropic 等账号 | 添加、优先级、健康、请求数、轮换策略；不回显完整 Token |

### 6.2 模型设置

| 功能 | 前端要求 | 当前状态 | 优先级 |
| --- | --- | --- | --- |
| Provider 发现与认证状态 | 按官方 catalog 动态渲染，不硬编码四个 Provider | 部分，当前硬编码预设 | P0 |
| Provider 验证 | 实际调用 Hermes 验证接口并显示结构化失败 | 缺失 | P0 |
| 主模型 | 设置新会话默认模型 | 部分 | P0 |
| 会话模型 | 当前会话内热切换并提示上下文压缩和缓存成本 | 缺失 | P0 |
| 11 个辅助模型 | `auto`、逐槽覆盖、全部重置、批量指定 | 缺失 | P1 |
| 模型能力 | 上下文、视觉、工具调用、Reasoning、可用状态 | 发现接口有基础，UI 缺失 | P0 |
| Reasoning Effort | 会话级选择，按模型能力限制选项 | 缺失 | P0 |
| Fast Mode | 会话级快速模式和实际状态 | 缺失 | P1 |
| 别名 | 用户自己的模型别名 | 缺失 | P2 |
| Fallback | 主模型和辅助任务的有序回退链 | 缺失 | P1 |
| Provider Routing | 速度、成本、吞吐、白名单、黑名单、参数要求 | 缺失 | P2 |
| MoA | 参考模型组合与聚合模型 | 缺失，默认不开放 | P2/实验 |

密钥永远由 Platform BFF 接收后加密，按 `organization_id + user_id + agent_id` 作用域保存。前端只能得到 `configured`、掩码、认证方式、最近验证状态和更新时间。

## 7. 全部用户能力映射

状态定义：`已接` 表示当前存在真实端到端接口；`部分` 表示只有部分操作或尚未生产验证；`界面` 表示页面存在但底层闭环不足；`缺失` 表示尚无百瑞显式 Adapter；`不接` 表示不向普通用户开放。

### 7.1 对话、流式运行与审批

| 官方能力 | BaiLongma 前端 | 当前 | 需要的百瑞接口/约束 | 验收 |
| --- | --- | --- | --- | --- |
| 新建对话、流式回答 | 中间聊天框 | 部分 | Owner-scoped session SSE | 真模型连续多轮，刷新后可恢复 |
| 工具调用过程 | 消息内折叠步骤 | 部分 | 标准化 tool start/result/error 事件 | 工具名、参数摘要、结果和耗时完整 |
| Reasoning 展示 | 可折叠推理状态，不泄露供应商不允许的原始 CoT | 缺失 | 只转发官方可显示 reasoning summary | 不展示隐藏思维链 |
| 审批 | 消息内审批卡 | 部分 | `once/session/always/deny`，策略限制 `always` | 批准后 Run 真正继续，拒绝后终止 |
| 停止 | Composer 停止按钮 | 部分 | 必须调用 `runs.stop`，不能只中止浏览器 SSE | 后端 Run 变为 cancelled |
| 打断并追加指令 | 当前对话输入 | 缺失 | Hermes interrupt/queue 语义显式适配 | 长任务可被新指令接管 |
| 附件/图片 | Composer 上传与预览 | 缺失 | Agent 私有对象存储、病毒/类型/大小检查 | 图像模型可真实识别上传图片 |
| 语音输入/播报 | Composer 麦克风、消息播报 | 缺失 | STT/TTS Adapter 和用户许可 | 真实录音转写与回复播放 |
| Slash Commands | `/` 命令选择器 | 缺失 | 只公开适合 Web 的命令 | 命令列表与当前 Agent 能力一致 |
| Artifacts/交付物 | 右侧预览、下载、版本 | 缺失 | Agent 文件引用，不转发任意主机路径 | 文档/图片/代码可预览和下载 |

### 7.2 会话生命周期

| 官方能力 | 前端位置 | 当前 | 优先级 | 验收 |
| --- | --- | --- | --- | --- |
| 列表、分页、恢复 | 左侧会话栏 | 部分 | P0 | 只显示本用户当前 Agent 会话 |
| 搜索 | 会话栏搜索 | 缺失 | P0 | 标题与正文命中，严格 Agent 隔离 |
| 重命名 | 会话菜单 | 部分接口、UI 不完整 | P0 | 刷新后保留 |
| 分叉 | 消息/会话菜单 | 有接口，UI 不完整 | P1 | 父子关系正确，原会话不变 |
| 归档/删除 | 会话菜单 | 删除接口基础 | P0 | 二次确认、可审计、不可跨 Agent |
| 批量删除、空会话清理、Prune | 会话管理抽屉 | 缺失 | P2 | 预览影响范围后执行 |
| 导入/导出 | 会话管理抽屉 | 缺失 | P1 | 支持 Hermes 格式，导入前校验和去重 |
| 最新后代/续接 | 会话树 | 缺失 | P1 | 分叉后能定位活跃后代 |
| 会话统计 | 会话管理 | 缺失 | P2 | 数量、来源和消息统计真实 |

### 7.3 工具与工具集

| 官方能力 | 前端位置 | 当前 | 安全边界 | 优先级 |
| --- | --- | --- | --- | --- |
| 工具集发现/启停 | 能力中心 > 工具 | 发现有基础，管理缺失 | 受平台许可和 Agent 策略双重限制 | P0 |
| 会话级工具开关 | 对话右栏 | 缺失 | 只能收紧全局权限，不能扩大 | P1 |
| Toolset Provider/Model | 工具配置抽屉 | 缺失 | 只列已授权 Provider | P1 |
| Toolset 密钥/参数 | 工具配置抽屉 | 缺失 | 加密保存，不回显 | P1 |
| Post-setup | 安装进度 | 缺失 | 只运行 Hermes 声明且平台允许的动作 | P1 |
| Terminal Backend | Agent 设置 > 执行环境 | 缺失 | 云端默认容器沙箱；禁止任意宿主机 shell | P0 |
| Computer Use | 能力中心 | 缺失 | 独占会话、显式授权、全程审计 | P2 |
| Browser/Web Search | 工具中心与聊天状态 | 部分，百瑞另有适配器 | 统一能力入口，避免 Hermes/Firecrawl 重复配置 | P1 |

### 7.4 Skills Hub 与学习

| 官方能力 | 前端位置 | 当前 | 安全边界 | 优先级 |
| --- | --- | --- | --- | --- |
| 已安装技能、启停 | 能力中心 > 技能 | 部分 | 只作用于当前 Agent/Profile | P0 |
| Hub 搜索、来源过滤 | 技能市场 | 缺失 | 展示来源和信任等级 | P1 |
| 预览与安全扫描 | 安装确认页 | 缺失 | 扫描结论和高危项必须可见 | P1 |
| 安装、升级、卸载 | 技能详情 | 缺失 | Owner 操作，写入 Agent 私有目录 | P1 |
| Bundles | 技能组合 | 缺失 | 组合只引用已允许技能 | P2 |
| 自建/编辑技能 | 高级编辑器 | 缺失 | 默认需要写入审批和版本记录 | P2 |
| `/learn` 从资料学习 | 对话动作 | 缺失 | 展示将生成的 Skill diff 并审批 | P2 |
| Agent 自动写技能 | 审批卡 | 缺失 | 遵守 `skills.write_approval` | P1 |

### 7.5 记忆与 Obsidian

| 官方能力 | 前端位置 | 当前 | 设计决定 | 优先级 |
| --- | --- | --- | --- | --- |
| `MEMORY.md` | 记忆 > 长期记忆 | 部分投影 | Hermes 是运行时真相，PG 保存投影状态 | P0 |
| `USER.md` | 记忆 > 用户偏好 | 部分投影 | 与 Agent 长期记忆分开 | P0 |
| 写入审批 | 对话审批/记忆设置 | 缺失 | 展示 diff、目标和来源 | P0 |
| 容量与压缩 | 记忆状态 | 缺失 | 展示容量、最后整理时间和失败 | P1 |
| 重置 memory/user/all | 记忆高级设置 | 缺失 | 强确认、备份点、审计 | P1 |
| 外部 Memory Provider | 能力中心 > 记忆后端 | 缺失 | Provider 配置按 Agent 隔离 | P2 |
| Obsidian Markdown | 记忆节点/编辑器 | 已接 PG 格式 | YAML frontmatter、标签、`[[wikilink]]` | P0 |
| 后台投影协调 | 无需用户手动触发 | 部分 | 必须由服务端队列保证，不依赖浏览器 | P0 |

“底层记忆用 Obsidian”需要精确定义：百瑞当前是 PostgreSQL 保存 Obsidian 兼容 Markdown，并投影到 Hermes `MEMORY.md`/`USER.md`，不是一个直接挂载给所有用户的 Obsidian Vault。多用户云环境中应继续以 PG 为权威业务存储，以每 Agent 的文件投影供 Hermes 使用。

### 7.6 Cron、Jobs 与自动化

| 官方能力 | 前端位置 | 当前 | 优先级 | 验收 |
| --- | --- | --- | --- | --- |
| 创建、编辑、暂停、恢复、触发、删除 | 自动化 > 任务 | 部分 | P0 | 真实 Gateway 执行并回写结果 |
| 自然语言/cron schedule builder | 任务表单 | 部分基础 | P0 | 时区和下次执行时间正确 |
| Skills 附加 | 任务表单 | 缺失 | P1 | 按顺序加载多个技能 |
| Provider/Model 固定 | 任务表单 | 缺失 | P0 | 全局模型变化时按官方语义 fail closed |
| 运行历史 | 任务详情 | 缺失 | P0 | claimed/running/completed/failed/unknown 可追溯 |
| Delivery targets | 任务表单 | 缺失 | P1 | 只能选择当前 Agent 已连接渠道 |
| Continuable delivery | 任务高级设置 | 缺失 | P2 | 回复可进入正确会话 |
| Script-only | 高级任务 | 缺失 | P2 | 沙箱、超时、输出和无 LLM 计费明确 |
| Blueprints/Suggestions | 自动化模板 | 缺失 | P2 | 实例化前预览全部配置 |

### 7.7 MCP

| 官方能力 | 前端位置 | 当前 | 安全边界 | 优先级 |
| --- | --- | --- | --- | --- |
| Server 列表、启停、测试、删除 | 能力中心 > MCP | 缺失 | Owner-scoped allowlist | P1 |
| Catalog 安装 | MCP 市场 | 缺失 | 只允许审核目录或明确风险确认 | P1 |
| HTTP/stdio | 新建表单 | 缺失 | 云共享主机默认禁用任意 stdio command | P1 |
| OAuth | MCP 授权弹窗 | 缺失 | BFF 保存 flow state，回调绑定 Agent | P1 |
| 环境变量 | MCP 配置 | 缺失 | 加密、掩码、最小注入 | P1 |
| Tool filter | MCP 配置 | 缺失 | allowlist 优先，支持工具级禁用 | P1 |
| Reload/Discovery | MCP 状态 | 缺失 | 不重启整个机群 | P2 |
| mTLS | 高级配置 | 缺失 | 私有部署优先，证书按 Agent 隔离 | P2 |

### 7.8 文件、项目、上下文、Git 与 Checkpoint

| 官方能力 | 前端位置 | 当前 | 安全边界 | 优先级 |
| --- | --- | --- | --- | --- |
| 文件列表、预览、上传、下载、新建目录、删除 | 工作区 > 文件 | 缺失 | 路径必须限制在 Agent workspace | P0 |
| Context references | Composer `@` 选择器 | 缺失 | 只引用当前 Agent 可读文件 | P1 |
| 项目/CWD | 工作区 > 项目 | 缺失 | 平台分配逻辑项目根，不接受任意主机路径 | P1 |
| Git 状态、diff、分支 | 工作区 > 版本 | 缺失 | 默认只读 | P2 |
| Stage/commit/push/PR | 受控 Git 操作 | 缺失 | 显式授权、仓库凭据隔离、操作审计 | P2 |
| Revert/删除 worktree | 不默认开放 | 不接 | 高危操作需要管理员策略和强确认 | 后置 |
| Checkpoint 列表/清理 | 工作区 > 恢复点 | 缺失 | 用户只能管理自己 Agent 的恢复点 | P1 |

绝不能把 Hermes `/api/fs/*` 和 `/api/git/*` 原样代理。百瑞必须使用逻辑文件 ID、项目 ID 和受控动作，服务端解析为 Agent 私有路径。

### 7.9 Profile、SOUL、人格和角色卡

| 官方能力 | 前端位置 | 当前 | 映射 | 优先级 |
| --- | --- | --- | --- | --- |
| Profile 列表/创建/复制/重命名/删除 | Agent 设置 > 身份 | 缺失 | 一个百瑞 Agent 默认一个 Hermes Profile | P1 |
| SOUL | Agent 设置 > 人格 | 角色卡有部分设计 | 角色卡 persona -> SOUL，边界与系统策略分开 | P0 |
| 描述自动生成 | 人格设置 | 缺失 | 用户确认后写入 | P2 |
| Profile Model | 身份设置 | 缺失 | 复用已授权模型选择器 | P1 |
| 多 Profile 会话 | 高级模式 | 缺失 | 不得突破百瑞 Agent 所有权 | P2 |
| Profile Distribution | 模板市场/导入 | 缺失 | 安全扫描、来源、版本、差异确认 | P2 |

白龙马“角色卡”不是额外运行核心。它是用户可编辑的人格、背景、说话风格、开场语和示例对话输入，应投影到 Hermes Profile/SOUL/会话指令；工具权限、系统安全策略和模型密钥不能由角色卡覆盖。

### 7.10 渠道、Pairing、Gateway 与 Webhook

| 官方能力 | 前端位置 | 当前 | 安全边界 | 优先级 |
| --- | --- | --- | --- | --- |
| 渠道目录和配置 | 能力中心 > 渠道 | 界面/存储 | 密钥按 Agent 隔离 | P0 |
| OAuth/扫码 onboarding | 渠道向导 | 缺失 | 临时 flow state、过期和取消 | P1 |
| 收发测试 | 渠道详情 | 缺失 | 必须验证入站、Runtime、出站和回执 | P0 |
| Pairing 待审批/批准/撤销 | 渠道安全 | 缺失 | 只允许 Agent 所有者操作 | P1 |
| Home channel | 渠道详情 | 缺失 | 用于通知和 Cron delivery | P1 |
| Gateway 状态 | 渠道总览 | 部分总控状态 | 用户只看自己 Agent Gateway 摘要 | P0 |
| Gateway start/stop/restart | Agent 生命周期 | 缺失 | 转成总控固定命令，不直调 Hermes 主机操作 | P1 |
| Webhook 订阅 | 能力中心 > Webhook | 缺失 | 事件 allowlist、密钥只显示一次、重放保护 | P1 |

Hermes 官方 32 份渠道文档不意味着百瑞首版要做 32 个渠道。前端必须由渠道 manifest 动态生成，先把一个渠道做成真实模板，再扩展飞书、微信、QQ 等百瑞目标渠道。

### 7.11 Voice、Vision、图片和视频

| 官方能力 | 前端位置 | 当前 | 优先级 | 验收 |
| --- | --- | --- | --- | --- |
| 图片粘贴/上传和 Vision | Composer | 缺失 | P1 | 视觉辅助模型真实处理图片 |
| STT | Composer 麦克风 | 缺失 | P1 | 录音权限、时长、语言、失败重试完整 |
| TTS | 消息操作/设置 | 缺失 | P2 | Edge/本地/云 Provider 可选，费用可见 |
| Voice Mode | 对话设置 | 缺失 | P2 | 中断、静音、自动播放状态稳定 |
| Image Generation/Edit | 对话和 Artifact | 缺失 | P1 | 模型/比例/质量/编辑源图完整 |
| Video Provider | Artifact 工具 | 缺失 | P2 | 异步任务、进度、结果和费用完整 |

### 7.12 Delegation、后台任务、Goals 和 Kanban

| 官方能力 | 前端位置 | 当前 | 优先级 | 验收 |
| --- | --- | --- | --- | --- |
| 单个/批量 Delegation | 对话任务树 | 缺失 | P1 | 父子 Run、模型和工具边界可见 |
| 后台任务 | 对话/自动化 | 缺失 | P1 | 关闭页面后继续，完成后可通知 |
| `/agents` 监控 | 任务树 | 缺失 | P1 | 只显示当前用户 Agent 的子任务 |
| Goals | 自动化 > 目标 | 缺失 | P2 | 状态、进展、阻塞和停止真实 |
| Kanban/Command Center | 自动化 > 看板 | 缺失 | P2 | 任务分解、依赖、执行车道和审批闭环 |
| 多 Agent 协作 | 高级编排 | 缺失 | P2 | 每个子 Agent 身份和数据边界明确 |

### 7.13 用量、Analytics、限额和账单

| 官方能力 | 前端位置 | 当前 | 设计决定 | 优先级 |
| --- | --- | --- | --- | --- |
| Token、请求、延迟、失败 | 用量 | 部分遥测 | Hermes 运行事实与百瑞计量对账 | P0 |
| 按模型/日期 | 用量图表 | 缺失 | 用户只看自己的 Agent | P0 |
| 工具/技能使用 | 用量明细 | 缺失 | 不上传参数和正文 | P1 |
| Provider 账号限额/credits | Provider 设置 | 缺失 | 官方能获取时显示，不能猜测 | P1 |
| 平台配额/账单 | 用量 > 百瑞账单 | 缺失 | 百瑞 Platform 是计费权威 | P1 |
| 成本估算 | 用量 | 部分 | 标记估算/供应商实账/平台结算三种来源 | P1 |

### 7.14 安全、策略、审批和诊断

| 官方能力 | 前端位置 | 当前 | 权限 | 优先级 |
| --- | --- | --- | --- | --- |
| Approval mode | Agent 设置 > 安全 | 部分运行审批 | Owner 可在平台上限内收紧 | P0 |
| 工具/命令 deny rules | 安全策略 | 缺失 | 平台强制规则不可由用户关闭 | P0 |
| Sandbox | 执行环境 | 缺失 | 云端由部署策略强制 | P0 |
| Skills/MCP 安全扫描 | 安装确认 | 缺失 | 结果留审计 | P1 |
| Security audit | 诊断 | 缺失 | 用户看到结构化结论，不看原始主机输出 | P1 |
| Doctor | 诊断 | 缺失 | 映射为无密钥、无路径泄露的检查结果 | P0 |
| 日志 | 诊断 | 缺失 | 用户只看自己 Agent 的脱敏运行日志 | P1 |
| 支持包 | 支持 | 缺失 | 用户主动触发、预览范围、服务端脱敏 | P2 |

### 7.15 插件、Hooks 和 Dashboard 扩展

| 官方能力 | 前端位置 | 当前 | 处理方式 | 优先级 |
| --- | --- | --- | --- | --- |
| Agent Plugins 列表/启停 | 能力中心 > 扩展 | 缺失 | 只允许平台批准来源 | P2 |
| 安装/升级/卸载 | 扩展详情 | 缺失 | 先扫描、再审批、固定版本、可回滚 | P2 |
| Hooks | 自动化 > 事件动作 | 缺失 | 禁止任意 shell；只允许声明式动作 | P2 |
| Dashboard 插件页面/slot | 不直接继承 | 不接 | BaiLongma 需建立自己的受控扩展协议 | 后置 |
| Themes/Fonts | 外观设置 | BaiLongma 自己控制 | 不调用 Hermes theme API | 后置 |

### 7.16 系统、更新、备份和迁移

| 官方能力 | 用户前端 | 管理员/总控 | 处理方式 |
| --- | --- | --- | --- |
| Health/ready/version | 显示 Agent 摘要 | 显示完整机群状态 | 用户 P0、总控 P0 |
| Gateway 进程 | 只显示自己 Agent 状态 | 固定生命周期命令 | 不直接代理进程接口 |
| Hermes update/check | 只显示可用版本提示 | 候选、测试、发布、回滚 | 只能由总控发布流程执行 |
| Backup/import | 用户可申请自己的数据导出/恢复 | 总控执行、审计和保留策略 | 不暴露任意 archive path |
| Config migration | 不显示原始动作 | 发布流程自动执行 | 失败自动阻断/回滚 |
| System stats | 只显示 Agent 配额 | 管理员看主机/容器资源 | 严格分离租户和主机指标 |
| Raw logs/dump/debug | 不直接开放 | 受控支持流程 | 默认脱敏、最小范围 |

## 8. 明确不向普通用户暴露

以下 Hermes 官方接口不能直接进入 BaiLongma：

- 原始 `/api/env` 的读取、写入、删除和 reveal。
- 原始 `/api/config/raw` YAML 读取和写入。
- 任意 `/api/fs/*` 主机文件系统访问。
- `/api/console`、`/api/pty` 和任意宿主机终端。
- 不受控的 Git revert、push、worktree 删除和任意仓库操作。
- `/api/hermes/update`、配置迁移、Gateway 进程控制。
- 任意路径的 backup/import/download。
- 原始日志、dump、debug-share 和可能包含密钥的诊断输出。
- 任意 Plugin、Hook、MCP stdio command 或安装脚本。
- `HERMES_API_SERVER_KEY`、`BAIRUI_RUNTIME_SHARED_SECRET`、Server Agent Token、数据库密码、许可证私钥。

这些能力要么完全隐藏，要么转换成百瑞总控的固定、可验证、可审计动作。前端隐藏按钮不是权限控制；对应 BFF 路由必须不存在或服务端强制拒绝。

## 9. 需要新增的后端边界

### 9.1 运行数据面

继续使用当前 Hermes API Server（当前目标端口 `8642`）处理：

- Sessions、Messages、Runs、Events、Approvals、Stop。
- Jobs/Cron 的用户操作和运行结果。
- 模型与能力发现。

### 9.2 Owner-scoped Management Bridge

新增独立管理 Bridge，只实现百瑞明确允许的操作族：

```text
provider.*       model.*          toolset.*
skill.*          memory.*         cron.*
mcp.*            profile.*        channel.*
pairing.*        webhook.*        file.*
checkpoint.*     analytics.*      diagnostics.*
```

每个操作必须具备：

- 固定 operation name 和 JSON Schema；禁止任意 path 透传。
- `organization_id + user_id + agent_id` 所有权检查。
- Capability/License/Policy 检查。
- 密钥字段单独加密和写入；普通配置与密钥分离。
- 输入长度、URL、文件路径、命令和枚举验证。
- 幂等键、审计事件、超时和结构化错误。
- 对 Hermes 版本的兼容测试。

### 9.3 Runtime 形态待决策

官方 Dashboard 管理接口主要由 `hermes dashboard`/`hermes serve` 侧的 `web_server.py` 提供，当前百瑞运行路径主要依赖 `gateway run` 加 API Server。接入管理能力前必须通过 Spike 确认：

1. `hermes serve` 是否能作为每 Agent 的受控管理 sidecar。
2. 它与 Gateway、API Server 是否共用同一 Profile、配置和文件锁。
3. 多 Agent 容器中如何分配端口、认证和生命周期。
4. 是否存在无需启动完整官方 Dashboard 的 Python service factory。
5. 更新 Hermes 后 219 个路由中的目标子集是否保持契约。

在该决策完成前，不允许把 219 个路由反向代理到公网。

## 10. Contract 扩展顺序

`@bairui/contracts` 必须先于页面调用扩展，建议按以下能力包版本化：

1. `hermes-onboarding-v1`：setup state、Provider catalog、OAuth flow、validate、model selection、readiness。
2. `hermes-chat-v1`：session、message、stream event、tool event、approval、stop、attachment。
3. `hermes-models-v1`：main/session/auxiliary、reasoning、fallback、routing、credential pools。
4. `hermes-capabilities-v1`：toolsets、skills、MCP、memory、profiles。
5. `hermes-automation-v1`：cron、history、delivery、delegation、goals、kanban。
6. `hermes-workspace-v1`：logical files、projects、context refs、artifacts、checkpoints、controlled Git。
7. `hermes-channels-v1`：platform manifests、onboarding、pairing、gateway state、webhooks。
8. `hermes-observability-v1`：usage、diagnostics、redacted logs、health summaries。

Agent 与 Platform 必须依赖同一固定 contracts 版本，CI 运行跨仓兼容矩阵。不能继续在 Platform 和 Agent 各自手写相似但不同的 operation 字符串。

## 11. 交付优先级

### P0：用户可以真实完成 Agent 全流程

- 完整可恢复初始化、Provider 验证、主模型和首个真实会话。
- 对话 SSE、工具事件、审批、后端停止、附件/图片基础。
- 会话列表、恢复、搜索、重命名、删除。
- 工具集与沙箱基础策略。
- Hermes 记忆与 PG/Obsidian 后台可靠投影。
- Cron CRUD、模型固定、运行历史和真实 Gateway 执行。
- Agent 所有权、诊断、健康和真实用量。

### P1：Hermes 主要能力完整产品化

- OAuth/订阅/云 Provider、辅助模型、Fallback、Reasoning。
- Skills Hub、MCP、文件/项目、Profile/SOUL。
- 渠道 onboarding、Pairing、真实收发、Webhook。
- Vision、STT、图片生成。
- Delegation 和后台任务。

### P2：高级编排和扩展生态

- Provider Routing、凭据池、MoA、模型别名。
- Goals、Kanban、Multi-Agent。
- 受控 Git、插件、Hooks、外部记忆 Provider、Voice/TTS/Video。
- 自动化 Blueprint、Profile Distribution、用户数据迁移。

优先级不是删减范围。它表示实现和验收顺序，最终成品仍以本文件全部适用项完成为目标。

## 12. 完整验收标准

### 12.1 初始化

- 新用户可以选择平台模型、API Key Provider、OAuth Provider 和自定义端点至少各一种并完成真实对话。
- Provider 认证失败、模型不存在、上下文不足、网络不可达和工具调用不支持都有可执行错误。
- 刷新或重新登录后能从失败步骤继续，密钥不需要重复输入且永不回显。
- 另一个用户无法看到 Agent、初始化状态、Provider 掩码或任何管理结果。

### 12.2 核心使用

- 真实 PostgreSQL、真实 Hermes、真实模型完成多轮对话、工具调用、审批、停止和恢复。
- 浏览器关闭后，后台任务、记忆投影和 Cron 不丢失。
- 会话、文件、记忆、技能、MCP、渠道和任务全部按 Agent 隔离。
- 移动端和桌面端无内容溢出、侧栏可收起、审批和初始化弹窗层级正确。

### 12.3 总控与安全

- 管理员能看到每个 Agent 的版本、健康、资源、部署、Gateway、错误摘要和用量摘要。
- 管理员默认看不到聊天正文、记忆正文、文件正文和原始 Provider 凭据。
- 用户前端和网络请求中不存在原始 env、YAML、主机路径、Runtime Secret 或 Server Token。
- Hermes 更新通过固定 commit/image digest、契约测试、预发布 E2E、发布门禁和自动回滚。

### 12.4 上游兼容

- 对目标 Hermes commit 运行 Management Bridge contract suite。
- 每次 Hermes upstream 更新自动生成路由和 schema 差异报告。
- 删除、改名或语义变化的目标接口阻断发布。
- 未登记的新官方路由不会自动成为百瑞公网接口。

## 13. 对当前 PR 的决定

`rc.7`/PR #43 的 Agent 所有权隔离和 OpenAI 兼容 BYOK 初始化是正确的安全增量，应保留。不要删除这部分，也不要把它描述为完整 Hermes 初始化。

下一次实现应先完成 `hermes-onboarding-v1` contract 和 Management Bridge 技术 Spike，再把当前硬编码 Provider 表单升级为官方 catalog 驱动的多认证向导。之后按 P0 闭环扩展 BaiLongma，不另造第二套前端。
