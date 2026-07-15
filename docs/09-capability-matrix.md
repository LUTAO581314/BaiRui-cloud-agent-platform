# bairui-agent 能力与接口矩阵

更新日期：2026-07-15

## 当前总体数量

| 范围 | 数量 | 说明 |
| --- | ---: | --- |
| 登记 upstream | 11 | 10 个 git submodule，1 个 registry-only |
| Agent 后端入口 | 3 | health、Runtime、服务集成调用 |
| Platform 业务 API | 26 | 不含静态资源和 HTML 页面 |
| Platform 系统/页面入口 | 12 | 2 个探针、6 个静态资源、4 个 HTML 导航入口 |
| 前端页面 | 3 | 登录、用户工作区、管理员总控 |
| 前端功能视图/面板 | 14 | 登录 1、用户视图 3、管理员面板 10 |

## 11 个集成项目

| 项目 | 角色 | 当前真实状态 | 下一步条件 |
| --- | --- | --- | --- |
| Hermes Agent | 核心运行层 | Runtime Bridge 已连接 | 配置真实模型供应商并做生产对话验收 |
| OpenClaw | 服务集成层 | 已导入、已登记 | 定义工具/插件适配器 |
| BaiLongma | 渠道桥接 + UI | 聊天和热点交互已适配 | 后续接渠道桥接，不复制硬编码凭据 |
| EverOS | 服务集成层 | 已导入、已登记 | 明确与 Hermes 记忆的所有权边界 |
| MinerU | 服务集成层 | 已导入、已登记 | 定义文档产物协议 |
| FunASR | 服务集成层 | 已导入、已登记 | 定义音频输入输出协议 |
| TrendRadar | 服务集成层 | NewsNow 热点适配器已实现 | 部署后验证来源可用性和定时任务 |
| MiroFish | 服务集成层 | 已导入、已登记 | 定义仿真任务和结果协议 |
| SearXNG | 服务集成层 | 适配器已实现，registry-only | 部署 Linux 服务后做健康验证 |
| Sonic | 服务集成层 | 已导入、已登记 | 定义索引归属和同步策略 |
| Firecrawl | 服务集成层 | 页面提取适配器已实现 | 配置 API key，用于热点正文补全 |

## Agent 后端入口（3）

| 方法 | 路径 | 调用者 | 用途 |
| --- | --- | --- | --- |
| GET | `/health` | 总控/部署探针 | Runtime Boundary 健康检查 |
| POST | `/v1/runtime/requests` | Platform 服务端 | 签名调用 Hermes Runtime |
| POST | `/v1/integrations/requests` | Platform 服务端 | 签名调用 TrendRadar、Firecrawl、SearXNG 等适配器 |

两个 POST 接口都使用 Runtime Shared Secret 的时间戳、nonce 和 HMAC
签名；浏览器不能直接调用。

## Platform 业务 API（26）

| 模块 | 数量 | 能力 |
| --- | ---: | --- |
| 认证/身份 | 4 | 登录、注册、退出、当前身份 |
| 用户工作区/对话 | 4 | 工作区、建会话、读消息、发消息 |
| 热点 | 2 | 用户读取最新榜单、管理员触发采集 |
| Obsidian 记忆 | 2 | 用户列出和保存 Markdown 笔记 |
| 管理总览/成员 | 3 | 总览、成员列表、角色修改 |
| 总控/集成 | 2 | 总控快照、集成目录和运行记录 |
| Provider 设置 | 2 | 平台管理员读取掩码状态、加密更新配置 |
| 许可证 | 2 | 列表、签发 |
| 服务器 | 2 | 列表、登记 |
| 发布 | 2 | 列表、创建 |
| 内部上报 | 1 | Agent 总控快照 ingest |

## 前端功能视图/面板（14）

| 区域 | 数量 | 内容 |
| --- | ---: | --- |
| 登录 | 1 | 品牌登录页 |
| 用户工作区 | 3 | Hermes 对话、真实热点榜单、Obsidian 记忆 |
| 管理员总控 | 10 | 指标、模块快照、Provider 设置、集成目录、集成运行、成员、服务器、许可证、发布、审计 |

普通用户只能进入用户工作区。`org_admin` 可看组织范围总控，但看不到
Provider 密钥设置。只有 `platform_admin` 可以修改 Provider 配置；API 只返回
`****` 加末四位的掩码，密钥使用 AES-256-GCM 密封后存 PostgreSQL。

## 热点数据链路

```text
TrendRadar / NewsNow
  -> BaiRui TrendRadar Adapter（来源白名单、HTTPS 和域名校验、统一字段）
  -> 签名 Integration API
  -> Platform PostgreSQL（integration_runs + hotspot_items）
  -> 用户热点前端

Firecrawl -> 文章正文补全（已具备适配器，待配置 key）
SearXNG   -> 搜索兜底（已具备适配器，待部署服务）
```

白龙马原版热点代码会请求 haotechs、xxapi、TianAPI、TikHub、HotData 和
自定义 URL，并使用 30 分钟内存缓存。百瑞没有复制其中硬编码的 HotData
公共 key，也没有复制地区关注度、预警、置信度等缺少真实后端依据的指标。

## 记忆和数据库边界

- PostgreSQL 是用户、权限、会话、审计、采集批次、热点和笔记索引的权威数据库。
- PostgreSQL 是以后新增百瑞业务数据的默认生产数据库；内存 repository 仅用于测试或一次性本地运行。
- upstream 内部使用 SQLite 时必须留在 adapter 边界后面，不能替代百瑞平台 PG 主库。
- Obsidian 是用户可读的 Markdown 交换格式，包含 YAML frontmatter、标签和 `[[wikilink]]`。
- Hermes 的 `MEMORY.md`、`USER.md` 和运行会话仍由 Hermes 管理。
- 当前已实现 PG 内的 Obsidian Markdown 记录；文件系统 Vault 双向同步属于后续 adapter，不直接修改 Hermes 内部记忆。

## Provider 配置边界

- 网页设置的是模型供应商 `provider / base URL / model / API key`。
- `HERMES_API_SERVER_KEY` 是 Runtime 到 Hermes 的机器认证，网页不可见。
- `BAIRUI_RUNTIME_SHARED_SECRET` 是 Platform 到 Runtime 的签名密钥，网页不可见。
- 保存 Provider 配置后状态为 `pending`。总控部署流程将配置应用到 Hermes
  model route 并重启/滚动更新后，才能标记为 `applied`；平台不会谎报已生效。
