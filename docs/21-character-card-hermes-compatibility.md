# 角色卡与 Hermes 兼容边界

## 角色卡是什么

SillyTavern 角色卡是一个可移植的 Agent 角色描述文件，常见格式为 JSON 或带 `chara` / `ccv3` 文本块的 PNG。它不仅可能包含名称和性格，还可能包含系统提示词、开场白、示例对话、Lorebook 和第三方扩展字段。因此角色卡属于不可信配置输入，不等同于头像，也不能未经确认直接进入 Runtime。

## 能力归属

| 能力 | 当前归属 | 状态 | 说明 |
| --- | --- | --- | --- |
| Agent 名称、身份、性格、场景、系统指引 | Hermes `SOUL.md` | 已支持 | 由 BaiRui `hermes-bridge` 映射并通过 owner-scoped config 应用 |
| `SOUL.md` 重载 | BaiRui Supervisor | 已支持 | 原子替换，仅重启 Hermes 容器，失败恢复旧文件 |
| 开场白、备用问候、示例对话、作者备注 | PostgreSQL + Obsidian Markdown | 已保存、不激活 | 保留来源，不伪造为 Hermes 回复或长期记忆 |
| Character Book / Lorebook | PostgreSQL + Obsidian Markdown | 已保存、不激活 | `hermes_target=none`，等待独立 context adapter |
| PNG 卡片头像 | 对象存储 | 未接入 | 当前不把 PNG 二进制写入 PostgreSQL |
| 角色卡扩展脚本、正则和执行配置 | 无 | 明确忽略 | 不进入浏览器执行链、Runtime 或 Hermes |
| 关键词触发 Lorebook 注入 | BaiRui context adapter | 待设计 | 必须具备命中证据、字符预算、来源标识和注入审计 |

## 映射规则

`description`、`personality`、`scenario`、`system_prompt` 和 `post_history_instructions` 进入受限长度的 `SOUL.md`。`first_mes`、`alternate_greetings`、`mes_example`、`creator_notes` 和 Character Book 条目写为 Obsidian 来源笔记，默认不进入 Hermes `MEMORY.md` 或 `USER.md` 投影。

用户端必须先调用预检，再明确确认角色卡中的提示词会改变当前 Agent 身份。服务端保存来源规范、版本、创建者、内容摘要和导入时间，但总控舰队接口不得返回 `SOUL.md`、角色卡正文或用户设置。

## 补丁策略

1. Hermes 已有稳定公开能力时，直接使用 Hermes，不维护重复实现。
2. BaiLongma 或 SillyTavern 的产品语义与 Hermes 不同但可以组合时，放入 BaiRui adapter 或 `hermes-bridge`。
3. 只有缺口属于通用 Runtime 能力、无法在边界层可靠实现，并且不会引入 BaiRui 私有协议时，才准备最小 Hermes 补丁并向上游提交。
4. 未被上游接受的必要补丁必须维护为可重放 patch queue，记录目标提交、冲突检查、契约测试和移除条件；禁止直接修改 `upstreams/hermes` 后失去同步能力。

## Lorebook 后续接口

未来的 context adapter 应接收标准化会话上下文和只读 Lorebook 索引，返回带来源的候选片段。Runtime Boundary 负责字符预算和最终注入，Control Plane 只能观察命中数量、耗时和错误码，不能读取片段正文或主动触发对话。
