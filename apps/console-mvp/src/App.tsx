import {
  Activity,
  CheckCircle2,
  Bell,
  Bot,
  Boxes,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  ClipboardCheck,
  Clock3,
  Cloud,
  Code2,
  Copy,
  Database,
  Download,
  Eye,
  FileCode2,
  FileText,
  Gauge,
  GitBranch,
  Globe2,
  LayoutDashboard,
  Menu,
  MessageSquare,
  MoreHorizontal,
  PackagePlus,
  Pencil,
  Plus,
  Power,
  KeyRound,
  RefreshCw,
  Search,
  Server,
  Settings,
  ShieldCheck,
  Sparkles,
  Square,
  Terminal,
  TrendingDown,
  TrendingUp,
  TriangleAlert,
  Users,
  User,
  Wrench,
  X,
  Zap,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { fetchAgents, fetchUsage, type UsagePayload } from './api';

type NavKey = 'overview' | 'agents' | 'conversations' | 'deploy' | 'api' | 'approvals' | 'observability' | 'knowledge' | 'tools' | 'skills' | 'roles';
type WorkspaceTab = 'templates' | 'projects' | 'runs' | 'settings';
export type AgentStatus = 'running' | 'deploying' | 'initializing';
type DashboardRange = 'today' | '7d' | '30d';
type ModelConnectionState = 'unconfigured' | 'validating';
type ApiConnectionStatus = 'verified' | 'pending' | 'disabled';
type ConversationStatus = 'active' | 'closed' | 'error';
type ConversationMessageRole = 'user' | 'agent' | 'system' | 'tool';
type ConversationView = 'overview' | 'agent' | 'detail';
type AgentView = 'workspace' | 'config';
type DeployView = 'list' | 'detail';
type DeploymentStatus = 'pending' | 'building' | 'published' | 'failed';

interface NavItem {
  key: NavKey;
  label: string;
  icon: LucideIcon;
  badge?: string;
  tone?: 'danger' | 'warning';
}

interface Metric {
  label: string;
  value: string;
  trend: string;
  trendTone: 'up' | 'down';
  tone: 'blue' | 'green' | 'orange';
  icon: LucideIcon;
  comparison?: string;
}

interface Template {
  name: string;
  description: string;
  tags: string[];
  icon: LucideIcon;
  color: 'blue' | 'violet' | 'cyan' | 'orange' | 'green' | 'red';
}

export interface Agent {
  id: string;
  name: string;
  description: string;
  status: AgentStatus;
  model: string;
  stats: { label: string; value: string }[];
  channels: string[];
  icon: LucideIcon;
  color: 'blue' | 'violet' | 'orange' | 'green';
  host: string;
}

interface ApiConnection {
  id: string;
  name: string;
  provider: string;
  baseUrl: string;
  keyHint: string;
  models: string[];
  status: ApiConnectionStatus;
  lastValidated: string;
  requests: string;
}

interface ApiConnectionDraft {
  name: string;
  provider: string;
  baseUrl: string;
  models: string[];
}

interface ConversationToolCall {
  id: string;
  name: string;
  status: 'success' | 'error';
  duration: string;
  request: string;
  result: string;
}

interface ConversationMessage {
  id: string;
  role: ConversationMessageRole;
  content: string;
  time: string;
  tools?: ConversationToolCall[];
}

interface Conversation {
  id: string;
  title: string;
  preview: string;
  agentId: string;
  agentName: string;
  channel: string;
  startedAt: string;
  lastActiveAt: string;
  lastActiveLabel: string;
  messageCount: number;
  totalTokens: string;
  duration: string;
  status: ConversationStatus;
  messages: ConversationMessage[];
  errorSummary?: string;
  failedStep?: string;
}

interface DeploymentRecord {
  id: string;
  agentId: string;
  agentName: string;
  status: DeploymentStatus;
  sha: string;
  trigger: string;
  createdAt: string;
  version: string;
  duration: string;
  summary: string;
}

const navGroups: { title: string; items: NavItem[] }[] = [
  { title: '工作台', items: [{ key: 'overview', label: '总览仪表盘', icon: LayoutDashboard }, { key: 'agents', label: '智能体 Agents', icon: Bot, badge: '4' }, { key: 'conversations', label: '会话管理', icon: MessageSquare }] },
  { title: '开发与部署', items: [{ key: 'deploy', label: '部署发布', icon: PackagePlus }, { key: 'api', label: 'API 配置', icon: KeyRound, badge: '3' }, { key: 'approvals', label: '审批中心', icon: ClipboardCheck, badge: '2', tone: 'danger' }, { key: 'observability', label: '可观测', icon: Activity }] },
  { title: '资源库', items: [{ key: 'knowledge', label: '知识库', icon: Database }, { key: 'tools', label: '工具 Tools', icon: Wrench }, { key: 'skills', label: '技能 Skill', icon: Zap }, { key: 'roles', label: '角色卡 Role', icon: Sparkles }] },
];

const agentMetrics: Metric[] = [
  { label: '运行中智能体', value: '3', trend: '+12.5%', trendTone: 'up', tone: 'blue', icon: Bot },
  { label: '今日调用量', value: '12.8K', trend: '+38.2%', trendTone: 'up', tone: 'green', icon: Zap },
  { label: '平均响应延迟', value: '386ms', trend: '-5.4%', trendTone: 'up', tone: 'blue', icon: Gauge },
  { label: '待审批事项', value: '2', trend: '+1', trendTone: 'down', tone: 'orange', icon: ShieldCheck },
];

const dashboardMetrics: Record<DashboardRange, Metric[]> = {
  today: [
    { label: '总会话数', value: '86', trend: '+12.5%', trendTone: 'up', tone: 'blue', icon: MessageSquare, comparison: '较昨日' },
    { label: '今日调用量', value: '12.8K', trend: '+38.2%', trendTone: 'up', tone: 'green', icon: Zap, comparison: '较昨日' },
    { label: '平均响应延迟', value: '386ms', trend: '-5.4%', trendTone: 'up', tone: 'blue', icon: Gauge, comparison: '较昨日' },
    { label: '调用成功率', value: '99.2%', trend: '+0.8%', trendTone: 'up', tone: 'orange', icon: Activity, comparison: '较昨日' },
  ],
  '7d': [
    { label: '总会话数', value: '512', trend: '+18.6%', trendTone: 'up', tone: 'blue', icon: MessageSquare, comparison: '较前 7 天' },
    { label: '今日调用量', value: '72.4K', trend: '+24.1%', trendTone: 'up', tone: 'green', icon: Zap, comparison: '较前 7 天' },
    { label: '平均响应延迟', value: '401ms', trend: '-3.1%', trendTone: 'up', tone: 'blue', icon: Gauge, comparison: '较前 7 天' },
    { label: '调用成功率', value: '98.9%', trend: '+0.4%', trendTone: 'up', tone: 'orange', icon: Activity, comparison: '较前 7 天' },
  ],
  '30d': [
    { label: '总会话数', value: '2,348', trend: '+26.7%', trendTone: 'up', tone: 'blue', icon: MessageSquare, comparison: '较前 30 天' },
    { label: '今日调用量', value: '298.6K', trend: '+31.4%', trendTone: 'up', tone: 'green', icon: Zap, comparison: '较前 30 天' },
    { label: '平均响应延迟', value: '418ms', trend: '-7.2%', trendTone: 'up', tone: 'blue', icon: Gauge, comparison: '较前 30 天' },
    { label: '调用成功率', value: '98.7%', trend: '+0.6%', trendTone: 'up', tone: 'orange', icon: Activity, comparison: '较前 30 天' },
  ],
};

const rangeLabels: Record<DashboardRange, string> = { today: '今日', '7d': '近 7 天', '30d': '近 30 天' };
const rangeAxisLabels: Record<DashboardRange, string[]> = {
  today: ['00:00', '04:00', '08:00', '12:00', '16:00', '20:00', '现在'],
  '7d': ['08-06', '08-07', '08-08', '08-09', '08-10', '08-11', '今日'],
  '30d': ['07-13', '07-18', '07-23', '07-28', '08-02', '08-07', '今日'],
};

const templates: Template[] = [
  { name: '客服助手', description: '多轮对话 + 工单流转，自动转接人工，支持企业知识库检索', tags: ['RAG', '多渠道'], icon: MessageSquare, color: 'blue' },
  { name: '数据分析 Copilot', description: '连接 MySQL / ClickHouse，自然语言生成 SQL 与图表', tags: ['SQL', 'Tool'], icon: Activity, color: 'violet' },
  { name: '内容创作 Agent', description: '文案撰写、AIGC 配图、多语言翻译与 SEO 优化', tags: ['AIGC'], icon: FileCode2, color: 'orange' },
  { name: '代码审查助手', description: '接入 GitHub PR，自动扫漏洞 + 生成代码审查意见', tags: ['DevOps'], icon: Code2, color: 'green' },
  { name: 'HR 招聘助理', description: 'JD 发布、简历解析、自动邀约面试、候选人评分', tags: ['HR', 'RAG'], icon: Users, color: 'cyan' },
  { name: '运维 SRE Copilot', description: '告警聚合分析、根因定位、runbook 自动化执行', tags: ['SRE', 'Tool'], icon: TriangleAlert, color: 'red' },
];

const frameworks: Template[] = [
  { name: 'OpenAI Agents SDK', description: '官方 Agents SDK，function calling + handoff 原生支持', tags: ['官方'], icon: Bot, color: 'green' },
  { name: 'LangGraph', description: '图编排循环工作流，支持状态持久化与人机协同', tags: ['Python', 'TS'], icon: GitBranch, color: 'blue' },
  { name: 'CrewAI', description: '角色扮演多 Agent 协作，process + task 建模', tags: ['Python'], icon: Users, color: 'orange' },
  { name: 'Claude Tools', description: 'Anthropic 原生工具调用，长上下文稳定可靠', tags: ['Anthropic'], icon: Sparkles, color: 'violet' },
];

const MOCK_AGENTS: Agent[] = [
  { id: 'agent-cs-01', name: '客服 Agent #1', description: '接入飞书、微信、官网三个渠道，覆盖售前咨询与售后工单', status: 'running', model: 'DeepSeek V3', stats: [{ value: '24', label: '活跃会话' }, { value: '1.2K', label: '今日消息' }], channels: ['飞书', '微信', '官网'], icon: MessageSquare, color: 'blue', host: 'agent-agent-cs-01.bairui.app' },
  { id: 'agent-asst', name: '助手 Agent', description: '组织内知识库问答 + 日程/邮件工具，员工效率助手', status: 'running', model: 'Claude 3.5', stats: [{ value: '8', label: '活跃会话' }, { value: '326', label: '今日消息' }], channels: ['钉钉', '官网'], icon: Bot, color: 'violet', host: 'agent-agent-asst.bairui.app' },
  { id: 'agent-data', name: '数据分析 Agent', description: 'BI 场景，连接 ClickHouse + StarRocks，支持可视化输出', status: 'deploying', model: 'GPT-4o', stats: [{ value: '-', label: '活跃会话' }, { value: '-', label: '今日消息' }], channels: ['官网', 'API'], icon: Activity, color: 'orange', host: 'agent-agent-data.bairui.app' },
  { id: 'agent-cs-02', name: '客服 Agent #2', description: '独立部署于客户 SRV-GZ-03，专属客户定制能力', status: 'initializing', model: 'Qwen Max', stats: [{ value: '-', label: '活跃会话' }, { value: '-', label: '今日消息' }], channels: ['微信'], icon: MessageSquare, color: 'green', host: 'agent-agent-cs-02.bairui.app' },
];

const initialApiConnections: ApiConnection[] = [
  { id: 'conn-deepseek', name: 'DeepSeek 主连接', provider: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', keyHint: 'sk-••••••••a1b2', models: ['deepseek-chat', 'deepseek-reasoner'], status: 'verified', lastValidated: '今天 09:42', requests: '8.4K' },
  { id: 'conn-anthropic', name: 'Anthropic 备用连接', provider: 'Anthropic', baseUrl: 'https://api.anthropic.com', keyHint: 'sk-ant-••••••c3d4', models: ['claude-3-5-sonnet', 'claude-3-5-haiku'], status: 'verified', lastValidated: '昨天 18:06', requests: '3.1K' },
  { id: 'conn-openrouter', name: 'OpenRouter 多模型', provider: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', keyHint: 'sk-or-••••••e5f6', models: ['qwen/qwen-2.5-72b-instruct', 'google/gemini-2.0-flash'], status: 'pending', lastValidated: '尚未验证', requests: '—' },
];

const initialDeployments: DeploymentRecord[] = [
  { id: 'dep-20260812-04', agentId: 'agent-cs-01', agentName: '客服 Agent #1', status: 'published', sha: '8f3a91c', trigger: 'GitHub 推送', createdAt: '今天 10:08', version: 'v1.8', duration: '2 分 18 秒', summary: 'Web 与飞书渠道已更新。' },
  { id: 'dep-20260812-03', agentId: 'agent-asst', agentName: '助手 Agent', status: 'failed', sha: 'c712e4b', trigger: 'GitHub 推送', createdAt: '今天 09:36', version: 'v2.4', duration: '1 分 04 秒', summary: '构建校验未通过：邮件工具配置缺少授权范围。' },
  { id: 'dep-20260811-02', agentId: 'agent-data', agentName: '数据分析 Agent', status: 'pending', sha: 'b4e6d20', trigger: 'GitHub 推送', createdAt: '昨天 18:20', version: 'v1.3', duration: '—', summary: '等待确认发布到默认环境。' },
  { id: 'dep-20260811-01', agentId: 'agent-cs-02', agentName: '客服 Agent #2', status: 'building', sha: 'a29f5d6', trigger: '首次配置', createdAt: '昨天 16:42', version: 'v1.0', duration: '进行中', summary: '正在构建当前配置版本。' },
];

const initialConversations: Conversation[] = [
  {
    id: 'conv_01J1Z8HQ3W6FJ9Q2ZK4M7R8T5A', title: '咨询企业版知识库接入', preview: '我们已有飞书文档，接入后是否支持按部门检索？', agentId: 'agent-cs-01', agentName: '客服 Agent #1', channel: '官网 Web', startedAt: '2026-08-12 09:18:22', lastActiveAt: '2026-08-12T10:16:00', lastActiveLabel: '8 分钟前', messageCount: 8, totalTokens: '4,286', duration: '2 分 14 秒', status: 'active',
    messages: [
      { id: 'msg-001', role: 'user', content: '我们已有飞书文档，接入后是否支持按部门检索？', time: '2026-08-12 09:18:22' },
      { id: 'msg-002', role: 'agent', content: '支持。您可以在知识库同步时绑定部门标签，并在 Agent 的检索策略中限制可访问范围。', time: '2026-08-12 09:18:24', tools: [{ id: 'tool-001', name: 'knowledge_base.search', status: 'success', duration: '286ms', request: '{"query":"飞书文档 部门检索","topK":3}', result: '{"hits":3,"source":"product-docs"}' }] },
      { id: 'msg-003', role: 'user', content: '同步频率和增量更新是怎样的？', time: '2026-08-12 09:19:08' },
      { id: 'msg-004', role: 'agent', content: '默认每小时执行增量同步；也支持在文档变更事件到达后触发同步。完整配置需要在 Agent 项目中启用对应的知识库连接。', time: '2026-08-12 09:19:11' },
      { id: 'msg-005', role: 'system', content: '会话保持中，等待用户继续输入。', time: '2026-08-12 10:16:00' },
    ],
  },
  {
    id: 'conv_01J1Z7ZP2F9M4N6Q8R3S5T7U9V', title: '查询本月华南区域销售额', preview: '请按城市汇总本月华南区域销售额，并给出环比。', agentId: 'agent-data', agentName: '数据分析 Agent', channel: '官网 Web', startedAt: '2026-08-12 10:02:03', lastActiveAt: '2026-08-12T10:12:00', lastActiveLabel: '12 分钟前', messageCount: 6, totalTokens: '6,912', duration: '18 秒', status: 'closed',
    messages: [
      { id: 'msg-101', role: 'user', content: '请按城市汇总本月华南区域销售额，并给出环比。', time: '2026-08-12 10:02:03' },
      { id: 'msg-102', role: 'agent', content: '已按城市汇总完成，广州、深圳和佛山环比均为正增长。', time: '2026-08-12 10:02:21', tools: [{ id: 'tool-101', name: 'analytics.query', status: 'success', duration: '1.8s', request: '{"metric":"sales","region":"华南","groupBy":"city"}', result: '{"rows":12,"currency":"CNY"}' }] },
      { id: 'msg-103', role: 'system', content: '会话已由用户结束。', time: '2026-08-12 10:12:00' },
    ],
  },
  {
    id: 'conv_01J1Z5D8K6L4P2Q7R9S3T8U1V0', title: '售后工单进度查询', preview: '订单 BR-240812-019 的退货申请目前处理到哪一步？', agentId: 'agent-cs-01', agentName: '客服 Agent #1', channel: '微信', startedAt: '2026-08-12 08:47:12', lastActiveAt: '2026-08-12T09:36:00', lastActiveLabel: '52 分钟前', messageCount: 5, totalTokens: '2,108', duration: '4 秒', status: 'closed',
    messages: [
      { id: 'msg-201', role: 'user', content: '订单 BR-240812-019 的退货申请目前处理到哪一步？', time: '2026-08-12 08:47:12' },
      { id: 'msg-202', role: 'agent', content: '退货申请已通过审核，当前等待仓库签收。预计 1 至 2 个工作日完成退款。', time: '2026-08-12 08:47:16', tools: [{ id: 'tool-201', name: 'ticket.get_status', status: 'success', duration: '392ms', request: '{"orderId":"BR-240812-019"}', result: '{"status":"等待仓库签收","refund":"pending"}' }] },
    ],
  },
  {
    id: 'conv_01J1Z4A7B5C3D8E6F2G9H1J0K4', title: '生成周报摘要', preview: '根据本周项目进展生成面向管理层的周报摘要。', agentId: 'agent-asst', agentName: '助手 Agent', channel: '钉钉', startedAt: '2026-08-12 08:03:44', lastActiveAt: '2026-08-12T08:09:00', lastActiveLabel: '今天 08:09', messageCount: 7, totalTokens: '5,734', duration: '1 分 06 秒', status: 'error', errorSummary: '邮件工具返回权限不足，未能将生成的周报发送至指定邮箱。', failedStep: 'send_email',
    messages: [
      { id: 'msg-301', role: 'user', content: '根据本周项目进展生成面向管理层的周报摘要，并发送到我的邮箱。', time: '2026-08-12 08:03:44' },
      { id: 'msg-302', role: 'agent', content: '周报摘要已生成，正在尝试发送邮件。', time: '2026-08-12 08:04:12' },
      { id: 'msg-303', role: 'tool', content: '工具调用失败：邮件服务拒绝了当前授权范围。', time: '2026-08-12 08:04:16', tools: [{ id: 'tool-301', name: 'send_email', status: 'error', duration: '1.1s', request: '{"template":"weekly-summary","recipient":"current-user"}', result: '{"code":"FORBIDDEN","message":"邮件服务授权不足"}' }] },
      { id: 'msg-304', role: 'agent', content: '抱歉，周报已生成但未能发送。请检查该 Agent 的邮件工具授权后重试新的会话。', time: '2026-08-12 08:04:17' },
    ],
  },
  {
    id: 'conv_01J1Z2K9L7M5N3P8Q6R4S0T1U2', title: '渠道接入能力咨询', preview: 'QQ 机器人和微信公众号能否使用同一个 Agent？', agentId: 'agent-cs-02', agentName: '客服 Agent #2', channel: '官网 Web', startedAt: '2026-08-11 17:26:15', lastActiveAt: '2026-08-11T17:31:00', lastActiveLabel: '昨天 17:31', messageCount: 4, totalTokens: '1,824', duration: '5 秒', status: 'closed',
    messages: [
      { id: 'msg-401', role: 'user', content: 'QQ 机器人和微信公众号能否使用同一个 Agent？', time: '2026-08-11 17:26:15' },
      { id: 'msg-402', role: 'agent', content: '可以。一个 Agent 项目可绑定多个渠道，并共享模型、知识库与工具配置；渠道的鉴权信息需要分别维护。', time: '2026-08-11 17:26:20' },
    ],
  },
];

const conversationStatusCopy: Record<ConversationStatus, string> = { active: '进行中', closed: '已结束', error: '异常' };
const conversationRoleCopy: Record<ConversationMessageRole, string> = { user: '用户', agent: 'Agent', system: '系统', tool: '工具' };

const ConsoleNavigationContext = createContext<{ goToAgents: () => void; goToDeployments: () => void; goToOverview: () => void; goToConversationOverview: () => void }>({ goToAgents: () => undefined, goToDeployments: () => undefined, goToOverview: () => undefined, goToConversationOverview: () => undefined });

const AgentsContext = createContext<Agent[]>(MOCK_AGENTS);
const useAgents = () => useContext(AgentsContext);

const statusCopy: Record<AgentStatus, string> = { running: '运行中', deploying: '部署中', initializing: '初始化' };
const pageCopy: Record<Exclude<NavKey, 'agents'>, { title: string; description: string; icon: LucideIcon }> = {
  overview: { title: '总览仪表盘', description: '查看平台运行状态、智能体健康与最近操作记录。', icon: LayoutDashboard },
  conversations: { title: '会话管理', description: '统一检索智能体会话与执行记录。', icon: MessageSquare },
  deploy: { title: '部署发布', description: '管理环境、部署包与发布历史。', icon: PackagePlus },
  api: { title: 'API 配置', description: '管理模型连接、可用模型和验证状态。', icon: KeyRound },
  approvals: { title: '审批中心', description: '处理高风险操作与发布审批。', icon: ClipboardCheck },
  observability: { title: '可观测', description: '查看调用链路、指标和异常告警。', icon: Activity },
  knowledge: { title: '知识库', description: '管理 Agent 引用的知识库、文档与向量检索。', icon: Database },
  tools: { title: '工具 Tools', description: '配置 Agent 可调用的外部工具与 MCP 连接。', icon: Wrench },
  skills: { title: '技能 Skill', description: '启用或编排 Agent 的能力模块与技能包。', icon: Zap },
  roles: { title: '角色卡 Role', description: '管理 Agent 的人设角色卡与行为约束。', icon: Sparkles },
};

export function App() {
  const [activeNav, setActiveNav] = useState<NavKey>('overview');
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('templates');
  const [isSidebarOpen, setSidebarOpen] = useState(false);
  const [isCreateDialogOpen, setCreateDialogOpen] = useState(false);
  const [isModelDialogOpen, setModelDialogOpen] = useState(false);
  const [dashboardRange, setDashboardRange] = useState<DashboardRange>('today');
  const [modelConnectionState, setModelConnectionState] = useState<ModelConnectionState>('unconfigured');
  const [apiConnections, setApiConnections] = useState<ApiConnection[]>(initialApiConnections);
  const [activeApiConnectionId, setActiveApiConnectionId] = useState(initialApiConnections[0].id);
  const [isApiDialogOpen, setApiDialogOpen] = useState(false);
  const [conversations, setConversations] = useState<Conversation[]>(initialConversations);
  const [conversationAgentFilter, setConversationAgentFilter] = useState('all');
  const [conversationQuery, setConversationQuery] = useState('');
  const [conversationStatus, setConversationStatus] = useState<'all' | ConversationStatus>('all');
  const [conversationRange, setConversationRange] = useState<DashboardRange>('today');
  const [conversationPage, setConversationPage] = useState(1);
  const [activeConversationId, setActiveConversationId] = useState(initialConversations[0].id);
  const [conversationView, setConversationView] = useState<ConversationView>('overview');
  const [highlightedAgentId, setHighlightedAgentId] = useState<string | null>(null);
  const [agentView, setAgentView] = useState<AgentView>('workspace');
  const [agents, setAgents] = useState<Agent[]>(MOCK_AGENTS);
  const [agentsError, setAgentsError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetchAgents()
      .then((data) => {
        if (!cancelled && data.length > 0) setAgents(data);
      })
      .catch((err) => {
        if (!cancelled) setAgentsError(err instanceof Error ? err.message : '加载失败');
      });
    return () => {
      cancelled = true;
    };
  }, []);
  const [configuredAgentId, setConfiguredAgentId] = useState(MOCK_AGENTS[0].id);
  const [deployments, setDeployments] = useState<DeploymentRecord[]>(initialDeployments);
  const [deployView, setDeployView] = useState<DeployView>('list');
  const [activeDeploymentId, setActiveDeploymentId] = useState(initialDeployments[0].id);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<'all' | AgentStatus>('all');
  const [toast, setToast] = useState('');
  const filteredAgents = useMemo(() => agents.filter((agent) => (status === 'all' || agent.status === status) && (!query.trim() || `${agent.name} ${agent.description} ${agent.channels.join(' ')}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))), [query, status]);

  function notify(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(''), 2600);
  }

  function openAgentConversations(agent: Agent) {
    setConversationAgentFilter(agent.id);
    setConversationPage(1);
    setConversationStatus('all');
    setConversationQuery('');
    setConversationView('agent');
    setActiveNav('conversations');
  }

  function returnToAgent(agentId: string) {
    setActiveTab('projects');
    setHighlightedAgentId(agentId);
    setAgentView('workspace');
    setActiveNav('agents');
  }

  function openAgentConfig(agent: Agent) {
    setConfiguredAgentId(agent.id);
    setAgentView('config');
    setActiveNav('agents');
  }

  function openDeploymentsForAgent(agentId: string) {
    setConfiguredAgentId(agentId);
    setDeployView('list');
    setActiveNav('deploy');
  }

  function createDeployment(record: DeploymentRecord) {
    setDeployments((items) => [record, ...items]);
    setActiveDeploymentId(record.id);
    setDeployView('detail');
  }

  return <ConsoleNavigationContext.Provider value={{ goToAgents: () => { setAgentView('workspace'); setActiveNav('agents'); }, goToDeployments: () => { setDeployView('list'); setActiveNav('deploy'); }, goToOverview: () => setActiveNav('overview'), goToConversationOverview: () => { setConversationView('overview'); setActiveNav('conversations'); } }}><AgentsContext.Provider value={agents}><div className="app-shell">
    <Header onMenuClick={() => setSidebarOpen((value) => !value)} />
    <div className="workspace-shell">
      <Sidebar activeNav={activeNav} apiConnectionCount={apiConnections.length} isOpen={isSidebarOpen} onSelect={(key) => { setActiveNav(key); if (key === 'agents') setAgentView('workspace'); if (key === 'conversations') setConversationView('overview'); if (key === 'deploy') setDeployView('list'); setSidebarOpen(false); }} />
      <main className="main-content">
        {activeNav === 'overview' ? <OverviewDashboard dashboardRange={dashboardRange} modelConnectionState={modelConnectionState} onConfigureModel={() => setModelDialogOpen(true)} onCreate={() => setCreateDialogOpen(true)} onNavigate={setActiveNav} onRangeChange={setDashboardRange} /> : null}
        {activeNav === 'agents' && agentView === 'workspace' ? <AgentWorkspace activeTab={activeTab} agents={filteredAgents} highlightedAgentId={highlightedAgentId} onConfigure={openAgentConfig} onCreate={() => setCreateDialogOpen(true)} onManageConversations={openAgentConversations} onNotify={notify} onQueryChange={setQuery} onStatusChange={setStatus} query={query} setActiveTab={setActiveTab} status={status} /> : null}
        {activeNav === 'agents' && agentView === 'config' ? <AgentConfigPage agent={agents.find((agent) => agent.id === configuredAgentId) ?? agents[0]} onCancel={() => setAgentView('workspace')} onOpenDeployments={openDeploymentsForAgent} onSave={(agent) => { setDeployments((items) => [{ id: `dep-config-${Date.now()}`, agentId: agent.id, agentName: agent.name, status: 'pending', sha: '本地草稿', trigger: '配置保存', createdAt: '刚刚', version: 'v1.9', duration: '—', summary: '配置版本已保存，等待确认发布。' }, ...items]); setAgentView('workspace'); notify('配置已保存，已生成 v1.9 待发布记录。'); }} /> : null}
        {activeNav === 'conversations' ? <ConversationWorkspace activeConversationId={activeConversationId} agentId={conversationAgentFilter} conversationPage={conversationPage} conversations={conversations} onBackToAgent={() => setConversationView('agent')} onBackToOverview={() => { setConversationView('overview'); setConversationPage(1); }} onCloseConversation={(id) => { setConversations((items) => items.map((item) => item.id === id ? { ...item, status: 'closed', lastActiveLabel: '刚刚', lastActiveAt: '2026-08-12T10:24:00', messages: [...item.messages, { id: `msg-close-${Date.now()}`, role: 'system', content: '会话已由管理员结束。', time: '2026-08-12 10:24:00' }] } : item)); notify('会话已结束。'); }} onNavigateAgent={returnToAgent} onNotify={notify} onOpenAgent={(id) => { setConversationAgentFilter(id); setConversationQuery(''); setConversationStatus('all'); setConversationPage(1); setConversationView('agent'); }} onPageChange={setConversationPage} onQueryChange={(value) => { setConversationQuery(value); setConversationPage(1); }} onRangeChange={(value) => { setConversationRange(value); setConversationPage(1); }} onSelectConversation={(id) => { setActiveConversationId(id); setConversationView('detail'); }} onStatusChange={(value) => { setConversationStatus(value); setConversationPage(1); }} query={conversationQuery} range={conversationRange} status={conversationStatus} view={conversationView} /> : null}
        {activeNav === 'api' ? <ApiConfigWorkspace activeConnectionId={activeApiConnectionId} connections={apiConnections} onAdd={() => setApiDialogOpen(true)} onNotify={notify} onSelect={setActiveApiConnectionId} onToggle={(id) => setApiConnections((items) => items.map((item) => item.id === id ? { ...item, status: item.status === 'disabled' ? 'pending' : 'disabled', lastValidated: item.status === 'disabled' ? '等待验证' : item.lastValidated } : item))} onValidate={(id) => setApiConnections((items) => items.map((item) => item.id === id ? { ...item, status: 'pending', lastValidated: '验证请求已提交' } : item))} /> : null}
        {activeNav === 'deploy' ? <DeploymentWorkspace activeDeploymentId={activeDeploymentId} agentId={configuredAgentId} deployments={deployments} onBackToList={() => setDeployView('list')} onConfigure={openAgentConfig} onCreateDeployment={createDeployment} onOpenDetail={(id) => { setActiveDeploymentId(id); setDeployView('detail'); }} onSelectAgent={setConfiguredAgentId} view={deployView} /> : null}
        {activeNav !== 'overview' && activeNav !== 'agents' && activeNav !== 'conversations' && activeNav !== 'api' && activeNav !== 'deploy' ? <ScopePlaceholder keyName={activeNav} onReturn={() => setActiveNav('agents')} /> : null}
      </main>
    </div>
    {isCreateDialogOpen ? <CreateDialog onClose={() => setCreateDialogOpen(false)} onSubmit={() => { setCreateDialogOpen(false); notify('已提交：下一步配置模型'); }} /> : null}
    {isModelDialogOpen ? <ModelConnectionDialog onClose={() => setModelDialogOpen(false)} onSubmit={() => { setModelDialogOpen(false); setModelConnectionState('validating'); notify('模型连接已提交，等待后端验证。'); }} /> : null}
    {isApiDialogOpen ? <ApiConnectionDialog onClose={() => setApiDialogOpen(false)} onSubmit={(draft) => { const newConnection: ApiConnection = { id: `conn-${Date.now()}`, ...draft, keyHint: '已提交，等待服务端保存', status: 'pending', lastValidated: '尚未验证', requests: '—' }; setApiConnections((items) => [newConnection, ...items]); setActiveApiConnectionId(newConnection.id); setApiDialogOpen(false); notify('连接已创建，等待后端验证。'); }} /> : null}
    {toast ? <div className="toast" role="status">{toast}</div> : null}
  </div></AgentsContext.Provider></ConsoleNavigationContext.Provider>;
}

function Header({ onMenuClick }: { onMenuClick: () => void }) {
  return <header className="topbar">
    <div className="brand-cluster"><button className="mobile-menu" type="button" title="展开导航" aria-label="展开导航" onClick={onMenuClick}><Menu /></button><a className="brand" href="#top"><span className="brand-mark">BR</span><span className="brand-name">百瑞云</span><span className="brand-divider" /><span className="brand-product">控制台</span></a><button className="product-switch" type="button"><Boxes />产品<ChevronDown /></button><nav className="top-nav" aria-label="主导航"><a className="active" href="#top">控制台</a><a href="#product">产品</a><a href="#solutions">解决方案</a><a href="#pricing">定价</a><a href="#docs">文档</a><a href="#developers">开发者</a></nav></div>
    <div className="top-actions"><label className="global-search"><Search /><input aria-label="全局搜索" placeholder="搜索产品、文档、Agent 项目..." /></label><button className="region" type="button"><Globe2 />广州<ChevronDown /></button><button className="icon-button" type="button" title="消息" aria-label="消息"><Bell /><i /></button><button className="icon-button help" type="button" title="帮助" aria-label="帮助"><CircleHelp /></button><button className="icon-button ticket" type="button" title="工单" aria-label="工单"><FileText /></button><button className="account-menu" type="button" aria-label="打开账户菜单"><span><strong>用户</strong><small>当前用户</small></span><User /></button></div>
  </header>;
}

function Sidebar({ activeNav, apiConnectionCount, isOpen, onSelect }: { activeNav: NavKey; apiConnectionCount: number; isOpen: boolean; onSelect: (key: NavKey) => void }) {
  return <aside className={`sidebar ${isOpen ? 'open' : ''}`} aria-label="控制台导航">{navGroups.map((group) => <section className="nav-group" key={group.title}><h2>{group.title}</h2>{group.items.map((item) => { const Icon = item.icon; const badge = item.key === 'api' ? String(apiConnectionCount) : item.badge; return <button className={`nav-item ${activeNav === item.key ? 'active' : ''}`} type="button" key={item.key} onClick={() => onSelect(item.key)}><Icon /><span>{item.label}</span>{badge ? <em className={item.tone ?? ''}>{badge}</em> : null}</button>; })}</section>)}</aside>;
}

function OverviewDashboard({ dashboardRange, modelConnectionState, onConfigureModel, onCreate, onNavigate, onRangeChange }: { dashboardRange: DashboardRange; modelConnectionState: ModelConnectionState; onConfigureModel: () => void; onCreate: () => void; onNavigate: (key: NavKey) => void; onRangeChange: (range: DashboardRange) => void }) {
  const isModelPending = modelConnectionState === 'validating';
  const [usage, setUsage] = useState<UsagePayload | null>(null);
  const [usageError, setUsageError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setUsageError(false);
    fetchUsage(dashboardRange)
      .then((payload) => { if (!cancelled) setUsage(payload); })
      .catch(() => { if (!cancelled) setUsageError(true); });
    return () => { cancelled = true; };
  }, [dashboardRange]);

  const summary = usage?.summary;
  const metrics: Metric[] = summary ? [
    { label: '总会话数', value: summary.totalConversations.toLocaleString(), trend: '—', trendTone: 'up', tone: 'blue', icon: MessageSquare, comparison: rangeLabels[dashboardRange] },
    { label: '总调用量', value: summary.totalCalls.toLocaleString(), trend: '—', trendTone: 'up', tone: 'green', icon: Zap, comparison: rangeLabels[dashboardRange] },
    { label: '平均响应延迟', value: `${Math.round(summary.avgLatencyMs)}ms`, trend: '—', trendTone: 'up', tone: 'blue', icon: Gauge, comparison: rangeLabels[dashboardRange] },
    { label: '调用成功率', value: `${(summary.successRate * 100).toFixed(1)}%`, trend: '—', trendTone: 'up', tone: 'orange', icon: Activity, comparison: rangeLabels[dashboardRange] },
  ] : dashboardMetrics[dashboardRange];

  const axisLabels = rangeAxisLabels[dashboardRange];
  const series = usage?.series ?? [];
  const maxCalls = series.reduce((max, point) => Math.max(max, point.calls), 0) || 1;
  const modelBreakdown = usage?.modelBreakdown ?? [];
  const ringColors = ['var(--tc-primary)', 'var(--tc-accent-2)', 'var(--tc-success)', 'var(--tc-warning)', 'var(--tc-text-3)'];
  const ringGradient = modelBreakdown.length
    ? (() => { let acc = 0; const stops = modelBreakdown.map((slice, index) => { const start = acc * 100; acc += slice.share; const end = acc * 100; return `${ringColors[index % ringColors.length]} ${start.toFixed(1)}% ${end.toFixed(1)}%`; }); return `conic-gradient(${stops.join(', ')})`; })()
    : undefined;
  const updatedLabel = usage?.updatedAt ? `数据更新于 ${new Date(usage.updatedAt).toLocaleString('zh-CN', { hour12: false })}` : '数据加载中…';
  const activities = [
    { title: '会话调用完成', detail: summary ? `已完成 ${summary.totalCalls.toLocaleString()} 次模型响应，平均耗时 ${Math.round(summary.avgLatencyMs)}ms` : '正在加载用量数据', time: '实时', icon: MessageSquare, tone: 'blue' },
    { title: '调用趋势已更新', detail: `已同步${rangeLabels[dashboardRange]}的调用与延迟汇总`, time: '实时', icon: RefreshCw, tone: 'green' },
    { title: '模型连接需要处理', detail: isModelPending ? '配置已提交，正在等待后端验证' : '尚未完成模型服务连接配置', time: isModelPending ? '刚刚' : '今天 09:12', icon: KeyRound, tone: 'orange' },
  ];

  return <><Breadcrumb items={['工作台', '总览仪表盘']} /><section className="page-heading overview-heading"><div><p>工作台 / 总览</p><h1>总览仪表盘</h1><span>汇总查看会话、调用表现和近期活动，详细 Agent 配置请前往智能体页面。</span></div><div className="heading-actions"><small>{usageError ? '用量数据加载失败，显示示例' : updatedLabel}</small><button className="button secondary" type="button" onClick={onConfigureModel}><KeyRound />模型连接</button><button className="button primary" type="button" onClick={onCreate}><Plus />创建 Agent</button></div></section><section className="overview-toolbar"><div className="range-switcher" aria-label="统计时间范围" role="tablist">{(Object.keys(rangeLabels) as DashboardRange[]).map((range) => <button className={dashboardRange === range ? 'active' : ''} type="button" key={range} role="tab" aria-selected={dashboardRange === range} onClick={() => onRangeChange(range)}>{rangeLabels[range]}</button>)}</div><span>所有指标按所选时间范围统计</span></section><section className={`connection-notice ${isModelPending ? 'pending' : ''}`}><span><KeyRound /></span><div><strong>{isModelPending ? '模型连接等待验证' : '完成模型连接后即可开始调用'}</strong><p>{isModelPending ? '本地配置草稿已提交；服务端接入后将返回最终验证结果。' : '设置 Provider、Base URL、模型和 API Key。密钥不会在浏览器中保存。'}</p></div><button className="button secondary" type="button" onClick={onConfigureModel}>{isModelPending ? '查看配置' : '开始配置'}<ChevronRight /></button></section><section className="metric-grid" aria-label="总览指标">{metrics.map((metric) => <MetricCard key={metric.label} metric={metric} />)}</section><section className="overview-main-grid"><article className="chart-card overview-trend"><header><strong><i className="blue-dot" />调用趋势</strong><span><b />调用量</span></header><div className="line-chart" aria-label={`${rangeLabels[dashboardRange]}调用量趋势`} role="img"><div className="chart-grid-lines" />{series.length ? <div className="chart-bars">{series.map((point) => <span key={point.bucketStart} style={{ height: `${Math.max(2, Math.round((point.calls / maxCalls) * 100))}%` }} title={`${point.bucketStart}：${point.calls} 次调用`} />)}</div> : <div className={`chart-wave range-${dashboardRange}`} />}<footer>{axisLabels.map((label) => <span key={label}>{label}</span>)}</footer></div></article><article className="chart-card model-chart"><header><strong><i className="violet-dot" />模型调用分布</strong><span>{rangeLabels[dashboardRange]}</span></header><div aria-label={modelBreakdown.length ? modelBreakdown.map((slice) => `${slice.model} 占 ${Math.round(slice.share * 100)}%`).join('，') : '暂无模型调用数据'} role="img"><div className="ring" style={ringGradient ? { background: ringGradient } : undefined}><span><strong>{summary ? summary.totalCalls.toLocaleString() : '—'}</strong><small>调用次数</small></span></div><ul aria-hidden="true">{modelBreakdown.length ? modelBreakdown.map((slice) => { const dotTone = slice.model.includes('DeepSeek') ? 'blue-dot' : slice.model.includes('Claude') ? 'violet-dot' : slice.model.includes('GPT') ? 'green-dot' : 'orange-dot'; return <li key={slice.model}><i className={dotTone} />{slice.model} <b>{Math.round(slice.share * 100)}%</b></li>; }) : <li><i className="orange-dot" />暂无数据 <b>—</b></li>}</ul></div></article></section><section className="overview-bottom-grid"><article className="activity-panel"><header><div><h2>最近活动</h2><p>仅展示当前工作区的聚合事件</p></div><button className="text-button" type="button" onClick={() => onNavigate('conversations')}>查看全部<ChevronRight /></button></header><ol>{activities.map((activity) => { const Icon = activity.icon; return <li key={activity.title}><span className={activity.tone}><Icon /></span><div><strong>{activity.title}</strong><p>{activity.detail}</p></div><time>{activity.time}</time></li>; })}</ol></article><article className="quick-actions-panel"><header><div><h2>快捷操作</h2><p>从总览进入常用工作流</p></div></header><div><button type="button" onClick={onCreate}><span><Plus /></span><strong>创建 Agent</strong><small>从模板或空白项目开始</small><ChevronRight /></button><button type="button" onClick={onConfigureModel}><span><KeyRound /></span><strong>配置模型连接</strong><small>管理模型服务与验证状态</small><ChevronRight /></button><button type="button" onClick={() => onNavigate('agents')}><span><Bot /></span><strong>进入智能体</strong><small>查看项目与详细配置</small><ChevronRight /></button></div></article></section></>;
}

function AgentWorkspace({ activeTab, agents: visibleAgents, highlightedAgentId, onConfigure, onCreate, onManageConversations, onNotify, onQueryChange, onStatusChange, query, setActiveTab, status }: { activeTab: WorkspaceTab; agents: Agent[]; highlightedAgentId: string | null; onConfigure: (agent: Agent) => void; onCreate: () => void; onManageConversations: (agent: Agent) => void; onNotify: (message: string) => void; onQueryChange: (value: string) => void; onStatusChange: (value: 'all' | AgentStatus) => void; query: string; setActiveTab: (tab: WorkspaceTab) => void; status: 'all' | AgentStatus }) {
  const tabs: { key: WorkspaceTab; label: string; badge?: string }[] = [{ key: 'templates', label: '快速开始', badge: '6' }, { key: 'projects', label: '我的项目', badge: '4' }, { key: 'runs', label: '运行记录' }, { key: 'settings', label: '接入配置' }];
  return <><Breadcrumb items={['工作台', '智能体 Agents']} /><section className="page-heading"><div><p>工作台 / 智能体</p><h1>智能体管理</h1><span>查看项目运行状态、近期调用和待处理事项，并从这里创建新的智能体项目。</span></div><div className="heading-actions"><span>共 4 个项目</span><button className="button primary" type="button" onClick={onCreate}><Plus />新建 Agent 项目</button></div></section><section className="metric-grid" aria-label="智能体指标">{agentMetrics.map((metric) => <MetricCard key={metric.label} metric={metric} />)}</section><section className="workspace-panel"><div className="tabs" role="tablist">{tabs.map((tab) => <button className={activeTab === tab.key ? 'active' : ''} type="button" key={tab.key} role="tab" aria-selected={activeTab === tab.key} onClick={() => setActiveTab(tab.key)}>{tab.label}{tab.badge ? <span>{tab.badge}</span> : null}</button>)}</div><div className="tab-content">{activeTab === 'templates' ? <TemplatePanel onCreate={onCreate} /> : null}{activeTab === 'projects' ? <AgentPanel agents={visibleAgents} highlightedAgentId={highlightedAgentId} onConfigure={onConfigure} onCreate={onCreate} onManageConversations={onManageConversations} onNotify={onNotify} onQueryChange={onQueryChange} onStatusChange={onStatusChange} query={query} status={status} /> : null}{activeTab === 'runs' ? <RunsPanel /> : null}{activeTab === 'settings' ? <SettingsPanel onNotify={onNotify} /> : null}</div></section>{activeTab === 'templates' ? <><ReferenceAlert onNotify={onNotify} /><ObservabilityPanels /></> : null}</>;
}

function Breadcrumb({ items }: { items: string[] }) { const { goToAgents, goToConversationOverview, goToDeployments, goToOverview } = useContext(ConsoleNavigationContext); return <nav className="breadcrumb" aria-label="面包屑">{items.map((item, index) => { const isCurrent = index === items.length - 1; const onClick = item === '工作台' ? goToOverview : item === '会话管理' ? goToConversationOverview : item === '智能体 Agents' ? goToAgents : item === '部署发布' ? goToDeployments : undefined; return <span key={item}>{index ? <i>/</i> : null}{onClick && !isCurrent ? <button type="button" onClick={onClick}>{item}</button> : <b className={isCurrent ? 'current' : ''}>{item}</b>}</span>; })}</nav>; }
function MetricCard({ metric }: { metric: Metric }) { const Icon = metric.icon; const TrendIcon = metric.trendTone === 'up' ? TrendingUp : TrendingDown; return <article className={`metric-card ${metric.tone}`}><div className="metric-head"><span>{metric.label}</span><i><Icon /></i></div><strong>{metric.value}</strong><small><em className={metric.trendTone}><TrendIcon />{metric.trend}</em><span>{metric.comparison ?? '较上周同期'}</span></small></article>; }

function TemplatePanel({ onCreate }: { onCreate: () => void }) { return <><TemplateSection heading="精选模板 · 一键启动" action="查看全部 120+ 模板" items={templates} onCreate={onCreate} /><TemplateSection heading="按框架分类" items={frameworks} onCreate={onCreate} variant="framework" /></>; }
function TemplateSection({ action, heading, items, onCreate, variant }: { action?: string; heading: string; items: Template[]; onCreate: () => void; variant?: 'framework' }) { return <section className={`template-section ${variant ?? ''}`}><div className="section-heading"><h2>{heading}</h2>{action ? <button className="text-button" type="button" onClick={() => onCreate()}>{action}<ChevronRight /></button> : null}</div><div className="template-grid">{items.map((template) => { const Icon = template.icon; return <button className="template-card" key={template.name} type="button" onClick={onCreate}><span className={`template-icon ${template.color}`}><Icon /></span><strong>{template.name}</strong><p>{template.description}</p><span className="template-meta">{template.tags.map((tag) => <i key={tag}>{tag}</i>)}</span></button>; })}</div></section>; }

function AgentPanel({ agents: visibleAgents, highlightedAgentId, onConfigure, onCreate, onManageConversations, onNotify, onQueryChange, onStatusChange, query, status }: { agents: Agent[]; highlightedAgentId: string | null; onConfigure: (agent: Agent) => void; onCreate: () => void; onManageConversations: (agent: Agent) => void; onNotify: (message: string) => void; onQueryChange: (value: string) => void; onStatusChange: (value: 'all' | AgentStatus) => void; query: string; status: 'all' | AgentStatus }) { return <><div className="toolbar"><div className="toolbar-left"><label className="field-search"><Search /><input value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="搜索智能体名称、ID、渠道..." /></label><select value={status} onChange={(event) => onStatusChange(event.target.value as 'all' | AgentStatus)} aria-label="筛选智能体状态"><option value="all">全部状态</option><option value="running">运行中</option><option value="deploying">部署中</option><option value="initializing">初始化</option></select><select aria-label="筛选开发框架"><option>全部框架</option><option>OpenAI Agents</option><option>LangGraph</option><option>CrewAI</option></select></div><div className="toolbar-right"><button className="button secondary" type="button" onClick={() => onNotify('导入功能将在后端接入后开放。')}><Download />导入</button><button className="button primary" type="button" onClick={onCreate}><Plus />新建 Agent 项目</button></div></div><div className="agent-grid">{visibleAgents.map((agent) => <AgentCard agent={agent} highlighted={agent.id === highlightedAgentId} key={agent.id} onConfigure={onConfigure} onManageConversations={onManageConversations} onNotify={onNotify} />)}</div>{!visibleAgents.length ? <div className="empty-state"><Search /><strong>没有匹配的智能体</strong><span>调整搜索词或状态筛选后重试。</span></div> : null}</>; }
function AgentCard({ agent, highlighted, onConfigure, onManageConversations, onNotify }: { agent: Agent; highlighted: boolean; onConfigure: (agent: Agent) => void; onManageConversations: (agent: Agent) => void; onNotify: (message: string) => void }) { const Icon = agent.icon; const openChat = () => { const agentName = new URLSearchParams({ agent: agent.name }); window.open(`/agent-chat.html?${agentName.toString()}`, '_blank', 'noopener,noreferrer'); }; return <article className={`agent-card ${highlighted ? 'highlighted' : ''}`}><header><div className="agent-info"><span className={`agent-icon ${agent.color}`}><Icon /></span><div><strong>{agent.name}</strong><p>{agent.description}</p></div></div><span className={`status-pill ${agent.status}`}><b />{statusCopy[agent.status]}</span></header><div className="agent-body"><div className="agent-stats">{agent.stats.map((stat) => <div key={stat.label}><strong>{stat.value}</strong><span>{stat.label}</span></div>)}<div><strong>{agent.model}</strong><span>当前模型</span></div></div><footer><div className="channel-list">{agent.channels.map((channel) => <i key={channel}>{channel}</i>)}</div><div className="agent-actions"><button type="button" onClick={() => onNotify(`已打开 ${agent.name} 的运行观测。`)}><Eye />监控</button><button type="button" onClick={() => onConfigure(agent)}><Settings />配置</button><button type="button" onClick={() => onManageConversations(agent)}><MessageSquare />会话管理</button><button type="button" onClick={openChat}><MessageSquare />对话</button></div></footer></div></article>; }

function ReferenceAlert({ onNotify }: { onNotify: (message: string) => void }) { return <section className="reference-alert"><span><TriangleAlert /></span><div><strong>检测到服务器 SRV-GZ-03 版本漂移</strong><p>期望版本 v0.1.0-rc.7，实际 v0.1.0-rc.6，建议尽快修复以避免功能缺失。最近心跳：2 小时前。</p></div><aside><button className="button primary" type="button" onClick={() => onNotify('修复请求已加入本地 mock 队列。')}>立即修复</button><button className="button secondary" type="button" onClick={() => onNotify('已标记为稍后处理。')}>稍后处理</button></aside></section>; }
function ObservabilityPanels() { return <section className="chart-grid"><article className="chart-card"><header><strong><i className="blue-dot" />智能体调用趋势（近 7 日）</strong><span><b />请求数 <b className="muted-dot" />Token 消耗</span></header><div className="line-chart"><div className="chart-grid-lines" /><div className="chart-wave" /><div className="chart-wave secondary" /><footer><span>08-01</span><span>08-02</span><span>08-03</span><span>08-04</span><span>08-05</span><span>08-06</span><span>今日</span></footer></div></article><article className="chart-card model-chart"><header><strong><i className="violet-dot" />模型调用分布</strong></header><div><div className="ring"><span><strong>12.8K</strong><small>总调用次数</small></span></div><ul><li><i className="blue-dot" />DeepSeek V3 <b>42%</b></li><li><i className="violet-dot" />Claude 3.5 <b>31%</b></li><li><i className="green-dot" />GPT-4o <b>18%</b></li><li><i className="orange-dot" />其他模型 <b>9%</b></li></ul></div></article></section>; }

function RunsPanel() { const runs = [['RUN_20260806_0012', '客服 Agent #1', '每日自动知识库同步', '定时任务', '2026-08-06 09:00', '2分14秒', '成功'], ['RUN_20260806_0011', '数据分析 Agent', 'SQL query: 销售月报', 'user@demo.com', '2026-08-06 08:42', '18秒', '成功'], ['RUN_20260805_0889', '助手 Agent', '工具调用: 发送邮件', '张三', '2026-08-05 18:20', '3秒', '工具异常'], ['RUN_20260805_0888', '客服 Agent #2', '初始化流程', '管理员', '2026-08-05 17:30', '-', '进行中 65%']]; return <div className="table-wrap"><table><thead><tr><th>运行 ID</th><th>智能体</th><th>任务</th><th>触发人</th><th>开始时间</th><th>耗时</th><th>状态</th><th aria-label="操作" /></tr></thead><tbody>{runs.map((run) => <tr key={run[0]}>{run.map((cell, index) => <td className={index === 0 || index === 5 ? 'mono' : ''} key={`${run[0]}-${cell}`}>{index === 6 ? <span className={`status-pill ${cell === '成功' ? 'running' : cell.includes('进行') ? 'deploying' : 'initializing'}`}><b />{cell}</span> : cell}</td>)}<td><button className="table-button" type="button">Trace</button></td></tr>)}</tbody></table></div>; }
function SettingsPanel({ onNotify }: { onNotify: (message: string) => void }) { return <div className="settings-grid"><article className="setting-card"><header><span><Cloud /></span><div><h2>模型网关 API Key</h2><p>管理模型提供商与接入凭证。</p></div></header><dl><div><dt>sk-****a1b2</dt><dd>DeepSeek</dd><dd><span className="status-pill running"><b />启用</span></dd></div><div><dt>sk-****c3d4</dt><dd>Anthropic</dd><dd><span className="status-pill running"><b />启用</span></dd></div></dl><button className="button primary" type="button" onClick={() => onNotify('新增密钥仅作前端演示。')}>新增密钥</button></article><article className="setting-card"><header><span className="violet"><GitBranch /></span><div><h2>GitHub 推送部署</h2><p>连接仓库，自动构建并发布 Agent。</p></div></header><dl><div><dt>仓库地址</dt><dd className="mono">agents-workspace</dd></div><div><dt>默认分支</dt><dd>main</dd></div></dl><button className="button secondary" type="button" onClick={() => onNotify('GitHub 连接仅作前端演示。')}>管理配置</button></article></div>; }

const apiStatusCopy: Record<ApiConnectionStatus, string> = { verified: '已验证', pending: '待验证', disabled: '已停用' };

function ConversationWorkspace({ activeConversationId, agentId, conversationPage, conversations, onBackToAgent, onBackToOverview, onCloseConversation, onNavigateAgent, onNotify, onOpenAgent, onPageChange, onQueryChange, onRangeChange, onSelectConversation, onStatusChange, query, range, status, view }: { activeConversationId: string; agentId: string; conversationPage: number; conversations: Conversation[]; onBackToAgent: () => void; onBackToOverview: () => void; onCloseConversation: (id: string) => void; onNavigateAgent: (id: string) => void; onNotify: (message: string) => void; onOpenAgent: (id: string) => void; onPageChange: (page: number) => void; onQueryChange: (value: string) => void; onRangeChange: (value: DashboardRange) => void; onSelectConversation: (id: string) => void; onStatusChange: (value: 'all' | ConversationStatus) => void; query: string; range: DashboardRange; status: 'all' | ConversationStatus; view: ConversationView }) {
  const agents = useAgents();
  const rangeStart: Record<DashboardRange, number> = { today: new Date('2026-08-12T00:00:00').getTime(), '7d': new Date('2026-08-06T00:00:00').getTime(), '30d': new Date('2026-07-13T00:00:00').getTime() };
  const rangedConversations = useMemo(() => conversations.filter((conversation) => new Date(conversation.lastActiveAt).getTime() >= rangeStart[range]), [conversations, range]);
  const selectedAgent = agents.find((agent) => agent.id === agentId);
  const agentConversations = useMemo(() => rangedConversations.filter((conversation) => conversation.agentId === agentId), [agentId, rangedConversations]);
  const activeConversation = agentConversations.find((conversation) => conversation.id === activeConversationId);

  if (view === 'overview') return <ConversationOverview conversations={rangedConversations} onOpenAgent={onOpenAgent} onRangeChange={onRangeChange} range={range} />;
  if (!selectedAgent) return <ConversationEmpty onBack={onBackToOverview} />;
  if (view === 'detail') return activeConversation ? <ConversationDetail conversation={activeConversation} onBack={onBackToAgent} onCloseConversation={onCloseConversation} onNavigateAgent={onNavigateAgent} onNotify={onNotify} /> : <ConversationEmpty onBack={onBackToAgent} />;
  return <AgentConversationPage agent={selectedAgent} conversations={agentConversations} onBack={onBackToOverview} onPageChange={onPageChange} onQueryChange={onQueryChange} onRangeChange={onRangeChange} onSelectConversation={onSelectConversation} onStatusChange={onStatusChange} page={conversationPage} query={query} range={range} status={status} />;
}

function ConversationOverview({ conversations, onOpenAgent, onRangeChange, range }: { conversations: Conversation[]; onOpenAgent: (id: string) => void; onRangeChange: (range: DashboardRange) => void; range: DashboardRange }) {
  const agents = useAgents();
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<'all' | AgentStatus>('all');
  const summaries = agents.map((agent) => {
    const items = conversations.filter((conversation) => conversation.agentId === agent.id);
    const latest = [...items].sort((a, b) => new Date(b.lastActiveAt).getTime() - new Date(a.lastActiveAt).getTime())[0];
    return { agent, conversationCount: items.length, activeCount: items.filter((item) => item.status === 'active').length, errorCount: items.filter((item) => item.status === 'error').length, messageCount: items.reduce((total, item) => total + item.messageCount, 0), latest };
  }).filter((summary) => (status === 'all' || summary.agent.status === status) && (!query.trim() || `${summary.agent.name} ${summary.agent.id}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())));
  return <><Breadcrumb items={['工作台', '会话管理']} /><section className="page-heading conversation-heading"><div><p>工作台 / 会话管理</p><h1>会话管理</h1><span>按智能体汇总对话会话，进入后查看会话记录、工具调用与异常上下文。</span></div><div className="heading-actions"><small>{summaries.length} 个智能体</small></div></section><section className="conversation-toolbar overview"><label className="field-search"><Search /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索智能体名称或 ID" /></label><select value={status} onChange={(event) => setStatus(event.target.value as 'all' | AgentStatus)} aria-label="筛选智能体运行状态"><option value="all">全部运行状态</option><option value="running">运行中</option><option value="deploying">部署中</option><option value="initializing">初始化</option></select><div className="range-switcher compact" aria-label="会话时间范围" role="tablist">{(Object.keys(rangeLabels) as DashboardRange[]).map((item) => <button className={range === item ? 'active' : ''} type="button" key={item} role="tab" aria-selected={range === item} onClick={() => onRangeChange(item)}>{rangeLabels[item]}</button>)}</div></section><section className="conversation-agent-list" aria-label="智能体会话概览">{summaries.map((summary) => <button className="conversation-agent-row" type="button" key={summary.agent.id} onClick={() => onOpenAgent(summary.agent.id)}><span className={`agent-icon ${summary.agent.color}`}><summary.agent.icon /></span><div className="conversation-agent-name"><strong>{summary.agent.name}</strong><small className="mono">{summary.agent.id}</small><span className={`status-pill ${summary.agent.status}`}><b />{statusCopy[summary.agent.status]}</span></div><dl><div><dt>会话总数</dt><dd>{summary.conversationCount}</dd></div><div><dt>进行中</dt><dd>{summary.activeCount}</dd></div><div><dt>近 24 小时消息</dt><dd>{summary.messageCount}</dd></div><div><dt>异常会话</dt><dd className={summary.errorCount ? 'danger' : ''}>{summary.errorCount}</dd></div></dl><div className="conversation-agent-latest"><span>最新活跃</span><strong>{summary.latest?.lastActiveLabel ?? '暂无会话'}</strong></div><ChevronRight /></button>)}{!summaries.length ? <ConversationEmpty /> : null}</section></>;
}

function AgentConversationPage({ agent, conversations, onBack, onPageChange, onQueryChange, onRangeChange, onSelectConversation, onStatusChange, page, query, range, status }: { agent: Agent; conversations: Conversation[]; onBack: () => void; onPageChange: (page: number) => void; onQueryChange: (value: string) => void; onRangeChange: (value: DashboardRange) => void; onSelectConversation: (id: string) => void; onStatusChange: (value: 'all' | ConversationStatus) => void; page: number; query: string; range: DashboardRange; status: 'all' | ConversationStatus }) {
  const filtered = useMemo(() => conversations.filter((conversation) => (status === 'all' || conversation.status === status) && (!query.trim() || `${conversation.title} ${conversation.preview} ${conversation.id}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))).sort((a, b) => new Date(b.lastActiveAt).getTime() - new Date(a.lastActiveAt).getTime()), [conversations, query, status]);
  const pageSize = 20;
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pageItems = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const latest = filtered[0];
  return <><Breadcrumb items={['工作台', '会话管理', agent.name]} /><section className="agent-conversation-hero"><button className="text-button" type="button" onClick={onBack}><ChevronRight className="previous" />返回会话管理</button><div><span className={`agent-icon ${agent.color}`}><agent.icon /></span><div><p>Agent 会话详情</p><h1>{agent.name}</h1><span className={`status-pill ${agent.status}`}><b />{statusCopy[agent.status]}</span></div></div><dl><div><dt>会话总数</dt><dd>{conversations.length}</dd></div><div><dt>进行中</dt><dd>{conversations.filter((item) => item.status === 'active').length}</dd></div><div><dt>消息数</dt><dd>{conversations.reduce((total, item) => total + item.messageCount, 0)}</dd></div><div><dt>异常会话</dt><dd className={conversations.some((item) => item.status === 'error') ? 'danger' : ''}>{conversations.filter((item) => item.status === 'error').length}</dd></div><div><dt>最新活跃</dt><dd>{latest?.lastActiveLabel ?? '暂无'}</dd></div></dl></section><section className="conversation-toolbar agent"><label className="field-search"><Search /><input value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="搜索会话标题、首句或会话 ID" /></label><select value={status} onChange={(event) => onStatusChange(event.target.value as 'all' | ConversationStatus)} aria-label="筛选会话状态"><option value="all">全部状态</option><option value="active">进行中</option><option value="closed">已结束</option><option value="error">异常</option></select><div className="range-switcher compact" aria-label="会话时间范围" role="tablist">{(Object.keys(rangeLabels) as DashboardRange[]).map((item) => <button className={range === item ? 'active' : ''} type="button" key={item} role="tab" aria-selected={range === item} onClick={() => onRangeChange(item)}>{rangeLabels[item]}</button>)}</div></section><section className="conversation-table-panel"><header><div><h2>会话列表</h2><p>按最后活跃时间排序</p></div><span>{filtered.length} 条会话</span></header><div className="table-wrap"><table className="conversation-table"><thead><tr><th>会话标题 / 首句</th><th>最后活跃</th><th>消息数</th><th>状态</th><th aria-label="进入详情" /></tr></thead><tbody>{pageItems.map((conversation) => <tr key={conversation.id} tabIndex={0} onClick={() => onSelectConversation(conversation.id)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') onSelectConversation(conversation.id); }}><td><strong>{conversation.title}</strong><span>{conversation.preview}</span></td><td>{conversation.lastActiveLabel}</td><td>{conversation.messageCount} 条</td><td><span className={`conversation-status ${conversation.status}`}><i />{conversationStatusCopy[conversation.status]}</span></td><td><ChevronRight /></td></tr>)}{!pageItems.length ? <tr><td colSpan={5}><div className="conversation-empty"><Search /><strong>没有匹配的会话</strong><span>调整筛选条件后重试。</span></div></td></tr> : null}</tbody></table></div><footer className="conversation-pagination"><span>第 {currentPage} / {pageCount} 页</span><div><button type="button" title="上一页" aria-label="上一页" disabled={currentPage === 1} onClick={() => onPageChange(currentPage - 1)}><ChevronRight className="previous" /></button><button type="button" title="下一页" aria-label="下一页" disabled={currentPage === pageCount} onClick={() => onPageChange(currentPage + 1)}><ChevronRight /></button></div></footer></section></>;
}

function ConversationEmpty({ onBack }: { onBack?: () => void }) { return <section className="conversation-empty page"><MessageSquare /><strong>没有可展示的会话</strong><span>调整筛选条件或返回上一级后重试。</span>{onBack ? <button className="button secondary" type="button" onClick={onBack}>返回上一级</button> : null}</section>; }

function ConversationDetail({ conversation, onBack, onCloseConversation, onNavigateAgent, onNotify }: { conversation: Conversation; onBack: () => void; onCloseConversation: (id: string) => void; onNavigateAgent: (id: string) => void; onNotify: (message: string) => void }) {
  function exportConversation() {
    const file = new Blob([JSON.stringify(conversation, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(file);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${conversation.id}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    onNotify('会话记录已导出。');
  }
  const StatusIcon = conversation.status === 'error' ? TriangleAlert : conversation.status === 'active' ? Activity : CheckCircle2;
  return <><Breadcrumb items={['工作台', '会话管理', conversation.agentName, conversation.title]} /><article className="conversation-detail single"><header className="conversation-detail-header"><div><button className="conversation-back" type="button" title="返回会话列表" aria-label="返回会话列表" onClick={onBack}><ChevronRight className="previous" /></button><div><p>{conversation.agentName} · {conversation.channel}</p><h1>{conversation.title}</h1><span className={`conversation-status ${conversation.status}`}><StatusIcon />{conversationStatusCopy[conversation.status]}</span></div></div><div className="conversation-detail-actions"><button className="icon-button" type="button" title="复制会话 ID" aria-label="复制会话 ID" onClick={() => { void navigator.clipboard.writeText(conversation.id).then(() => onNotify('会话 ID 已复制。')).catch(() => onNotify('当前环境无法访问剪贴板。')); }}><Copy /></button><button className="button secondary" type="button" onClick={exportConversation}><Download />导出记录</button>{conversation.status === 'active' ? <button className="button danger" type="button" onClick={() => onCloseConversation(conversation.id)}><Square />结束会话</button> : null}</div></header>
    <div className="conversation-detail-body">
      {conversation.status === 'error' ? <section className="conversation-error"><TriangleAlert /><div><strong>{conversation.errorSummary}</strong><p>最近失败步骤：<code>{conversation.failedStep}</code></p></div><button className="text-button" type="button" onClick={() => onNavigateAgent(conversation.agentId)}>进入 Agent 配置<ChevronRight /></button></section> : null}
      <section className="conversation-metadata"><header><h3>会话元数据</h3><span className="mono">{conversation.id}</span></header><dl><div><dt>所属 Agent</dt><dd>{conversation.agentName}</dd></div><div><dt>来源渠道</dt><dd>{conversation.channel}</dd></div><div><dt>开始时间</dt><dd>{conversation.startedAt}</dd></div><div><dt>最后活跃</dt><dd>{conversation.lastActiveLabel}</dd></div><div><dt>累计消息</dt><dd>{conversation.messageCount} 条</dd></div><div><dt>累计 Token</dt><dd>{conversation.totalTokens}</dd></div><div><dt>总耗时</dt><dd>{conversation.duration}</dd></div><div><dt>当前状态</dt><dd>{conversationStatusCopy[conversation.status]}</dd></div></dl></section>
      <section className="conversation-stream"><header><div><h3>消息流</h3><p>{conversation.messageCount} 条消息，按时间顺序展示</p></div></header><ol>{conversation.messages.map((message) => <ConversationMessageItem key={message.id} message={message} />)}</ol></section>
    </div>
  </article></>;
}

function ConversationMessageItem({ message }: { message: ConversationMessage }) {
  const [expandedTools, setExpandedTools] = useState<string[]>([]);
  const Icon = message.role === 'user' ? Users : message.role === 'agent' ? Bot : message.role === 'system' ? Settings : Wrench;
  return <li className={`conversation-message ${message.role}`}><div className="message-avatar"><Icon /></div><div><header><strong>{conversationRoleCopy[message.role]}</strong><time>{message.time}</time></header><p>{message.content}</p>{message.tools?.map((tool) => { const isExpanded = expandedTools.includes(tool.id); return <section className={`tool-call ${tool.status}`} key={tool.id}><button type="button" aria-expanded={isExpanded} onClick={() => setExpandedTools((items) => isExpanded ? items.filter((id) => id !== tool.id) : [...items, tool.id])}><span><Wrench />{tool.name}</span><span><i />{tool.status === 'success' ? '成功' : '失败'} · {tool.duration}<ChevronDown className={isExpanded ? 'expanded' : ''} /></span></button>{isExpanded ? <div><label>请求<code>{tool.request}</code></label><label>结果<code>{tool.result}</code></label></div> : null}</section>; })}</div></li>;
}

function ApiConfigWorkspace({ activeConnectionId, connections, onAdd, onNotify, onSelect, onToggle, onValidate }: { activeConnectionId: string; connections: ApiConnection[]; onAdd: () => void; onNotify: (message: string) => void; onSelect: (id: string) => void; onToggle: (id: string) => void; onValidate: (id: string) => void }) {
  const activeConnection = connections.find((connection) => connection.id === activeConnectionId) ?? connections[0];
  const activeStatus = activeConnection.status;
  const StatusIcon = activeStatus === 'verified' ? CheckCircle2 : activeStatus === 'pending' ? Clock3 : Power;

  return <>
    <Breadcrumb items={['工作台', 'API 配置']} />
    <section className="page-heading api-heading">
      <div><p>工作台 / API 配置</p><h1>API 配置</h1><span>为当前账号维护模型服务连接，智能体只选择已验证的连接，不重复录入密钥。</span></div>
      <div className="heading-actions"><span>{connections.length} 个连接</span><button className="button primary" type="button" onClick={onAdd}><Plus />新增连接</button></div>
    </section>
    <section className="api-security-note" aria-label="API Key 安全说明"><ShieldCheck /><p>API Key 仅在提交时读取；此 MVP 不会将密钥写入 React state、URL 或浏览器存储。</p></section>
    <section className="api-workspace" aria-label="模型 API 连接管理">
      <aside className="api-connection-list">
        <header><div><h2>连接池</h2><p>用户级模型服务连接</p></div><button className="icon-button" type="button" title="新增连接" aria-label="新增连接" onClick={onAdd}><Plus /></button></header>
        <div>{connections.map((connection) => <button className={`api-connection-item ${connection.id === activeConnection.id ? 'active' : ''}`} type="button" key={connection.id} onClick={() => onSelect(connection.id)}><span className="api-provider-mark">{connection.provider.slice(0, 1)}</span><span><strong>{connection.name}</strong><small>{connection.provider}</small></span><i className={`api-status-dot ${connection.status}`} aria-label={apiStatusCopy[connection.status]} /></button>)}</div>
      </aside>
      <article className="api-connection-detail">
        <header className="api-detail-header"><div><span className="api-provider-mark large">{activeConnection.provider.slice(0, 1)}</span><div><p>{activeConnection.provider}</p><h2>{activeConnection.name}</h2><span className={`api-detail-status ${activeStatus}`}><StatusIcon />{apiStatusCopy[activeStatus]}</span></div></div><div className="api-detail-actions"><button className="button secondary" type="button" onClick={() => onNotify('编辑连接将在后端接入后保存。')}><Pencil />编辑配置</button><button className="icon-button" type="button" title="复制 Base URL" aria-label="复制 Base URL" onClick={() => { void navigator.clipboard.writeText(activeConnection.baseUrl).then(() => onNotify('Base URL 已复制到剪贴板。')).catch(() => onNotify('当前环境无法访问剪贴板。')); }}><Copy /></button></div></header>
        <div className="api-detail-body">
          <dl className="api-properties"><div><dt>Base URL</dt><dd className="mono">{activeConnection.baseUrl}</dd></div><div><dt>API Key</dt><dd>{activeConnection.keyHint}</dd></div><div><dt>最近验证</dt><dd>{activeConnection.lastValidated}</dd></div><div><dt>今日请求量</dt><dd>{activeConnection.requests}</dd></div></dl>
          <section className="api-model-section"><div className="section-heading"><div><h3>可用模型</h3><p>Agent 创建和编辑时可从这里选择</p></div><button className="text-button" type="button" onClick={() => onNotify('模型管理将在后端接入后保存。')}>管理模型<ChevronRight /></button></div><ul className="api-model-list">{activeConnection.models.map((model) => <li key={model}><CheckCircle2 /><span>{model}</span><small>{activeStatus === 'verified' ? '可选用' : activeStatus === 'disabled' ? '已停用' : '等待验证'}</small></li>)}</ul></section>
        </div>
        <footer className="api-detail-footer"><span>{activeStatus === 'disabled' ? '启用后需要重新验证连接。' : '验证会检查认证与模型可用性，不会展示完整密钥。'}</span><div><button className="button secondary" type="button" disabled={activeStatus === 'disabled'} onClick={() => { onValidate(activeConnection.id); onNotify('验证请求已提交，等待后端结果。'); }}><RefreshCw />验证连接</button><button className={activeStatus === 'disabled' ? 'button primary' : 'button danger'} type="button" onClick={() => { onToggle(activeConnection.id); onNotify(activeStatus === 'disabled' ? '连接已启用，等待验证。' : '连接已停用，智能体无法继续选择此连接。'); }}><Power />{activeStatus === 'disabled' ? '启用连接' : '停用连接'}</button></div></footer>
      </article>
    </section>
  </>;
}

function ApiConnectionDialog({ onClose, onSubmit }: { onClose: () => void; onSubmit: (draft: ApiConnectionDraft) => void }) {
  useEffect(() => { const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); }; window.addEventListener('keydown', closeOnEscape); return () => window.removeEventListener('keydown', closeOnEscape); }, [onClose]);
  return <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section aria-modal="true" aria-labelledby="api-connection-title" className="dialog" role="dialog"><header><div><span className="dialog-icon"><KeyRound /></span><h2 id="api-connection-title">新增 API 连接</h2></div><button className="icon-button" type="button" title="关闭" aria-label="关闭" onClick={onClose}><X /></button></header><form onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget); const models = String(data.get('models') ?? '').split(',').map((model) => model.trim()).filter(Boolean); onSubmit({ name: String(data.get('name') ?? ''), provider: String(data.get('provider') ?? ''), baseUrl: String(data.get('baseUrl') ?? ''), models }); }}><div className="dialog-body"><div className="form-grid"><label>连接名称 <strong>*</strong><input autoFocus name="name" placeholder="例如：生产环境 DeepSeek" required /></label><label>模型服务商 <strong>*</strong><select defaultValue="DeepSeek" name="provider"><option>DeepSeek</option><option>Anthropic</option><option>OpenAI</option><option>OpenRouter</option><option>Azure OpenAI</option><option>自定义兼容服务</option></select></label></div><label>Base URL <strong>*</strong><input defaultValue="https://api.deepseek.com/v1" name="baseUrl" required type="url" /></label><label>可用模型 <strong>*</strong><input defaultValue="deepseek-chat, deepseek-reasoner" name="models" placeholder="多个模型用逗号分隔" required /><small className="form-note">保存后，Agent 只能从此列表选择该连接的模型。</small></label><label>API Key <strong>*</strong><input autoComplete="off" name="apiKey" placeholder="输入 API Key" required spellCheck={false} type="password" /><small className="form-note">密钥仅用于本次提交验证，不保存到浏览器、URL 或 React state。</small></label></div><footer><button className="button secondary" type="button" onClick={onClose}>取消</button><button className="button primary" type="submit">创建并提交验证<ChevronRight /></button></footer></form></section></div>;
}

function AgentConfigPage({ agent, onCancel, onOpenDeployments, onSave }: { agent: Agent; onCancel: () => void; onOpenDeployments: (agentId: string) => void; onSave: (agent: Agent) => void }) {
  const [step, setStep] = useState(1);
  const [autoDeploy, setAutoDeploy] = useState(true);
  const steps = ['基础信息', '模型与工具', '渠道接入', '代码与发布'];
  const canGoBack = step > 1;
  return <><Breadcrumb items={['工作台', '智能体 Agents', `${agent.name} 配置`]} /><section className="page-heading config-heading"><div><p>智能体管理 / 配置</p><h1>{agent.name}</h1><span>编辑配置会生成新的配置版本；密钥与 GitHub 授权不在浏览器中保存。</span></div><div className="heading-actions"><button className="button secondary" type="button" onClick={() => onOpenDeployments(agent.id)}><PackagePlus />查看发布记录</button></div></section><section className="config-layout"><aside className="config-steps" aria-label="配置步骤">{steps.map((label, index) => <button className={step === index + 1 ? 'active' : step > index + 1 ? 'complete' : ''} type="button" key={label} onClick={() => setStep(index + 1)}><span>{step > index + 1 ? <CheckCircle2 /> : index + 1}</span><div><strong>{label}</strong><small>{index === 0 ? '名称、描述与框架' : index === 1 ? '已验证连接与工具' : index === 2 ? '可用渠道与访问方式' : 'GitHub 仓库与自动发布'}</small></div></button>)}</aside><section className="config-panel"><header><div><span>第 {step} 步，共 4 步</span><h2>{steps[step - 1]}</h2></div><small>配置版本 v1.8</small></header><div className="config-body">{step === 1 ? <><label>Agent 名称 <strong>*</strong><input defaultValue={agent.name} required /></label><label>项目描述<textarea defaultValue={agent.description} rows={4} /></label><label>开发框架<select defaultValue="OpenAI Agents SDK"><option>OpenAI Agents SDK</option><option>LangGraph</option><option>CrewAI</option><option>自定义 Runtime</option></select></label></> : null}{step === 2 ? <><label>模型连接<select defaultValue="conn-deepseek"><option value="conn-deepseek">DeepSeek 主连接 · 已验证</option><option value="conn-anthropic">Anthropic 备用连接 · 已验证</option></select><small>仅显示已验证的 API 连接。前往 API 配置可维护模型服务。</small></label><div className="form-grid"><label>默认模型<select defaultValue={agent.model}><option>DeepSeek V3</option><option>Claude 3.5</option><option>GPT-4o</option><option>Qwen Max</option></select></label><label>执行策略<select defaultValue="工具优先"><option>工具优先</option><option>模型直答</option><option>人工确认</option></select></label></div><fieldset className="capability-list"><legend>已启用工具</legend><label><input defaultChecked type="checkbox" />知识库检索</label><label><input defaultChecked type="checkbox" />HTTP 请求</label><label><input type="checkbox" />邮件发送</label></fieldset></> : null}{step === 3 ? <><fieldset className="capability-list channels"><legend>渠道接入</legend><label><input defaultChecked type="checkbox" />Web 对话</label><label><input defaultChecked={agent.channels.includes('飞书')} type="checkbox" />飞书</label><label><input defaultChecked={agent.channels.includes('微信')} type="checkbox" />微信</label><label><input defaultChecked={agent.channels.includes('API')} type="checkbox" />API</label></fieldset><div className="config-note"><Globe2 /><div><strong>渠道凭据由服务端管理</strong><p>此处只配置启用范围；渠道 token、回调地址与访问密钥不会显示或写入浏览器。</p></div></div></> : null}{step === 4 ? <><div className="github-binding"><span><GitBranch /></span><div><strong>GitHub 仓库</strong><p className="mono">bairui-cloud/{agent.id}</p><small>已绑定 · 最近同步于今天 09:58</small></div><CheckCircle2 /></div><div className="form-grid"><label>默认部署分支<input defaultValue="main" /></label><label>配置版本<input defaultValue="v1.9" readOnly /></label></div><div className="toggle-row"><div><strong>Git 自动发布</strong><p>推送至默认分支后自动创建发布记录。</p></div><button aria-label="切换 Git 自动发布" aria-pressed={autoDeploy} className={`toggle ${autoDeploy ? 'on' : ''}`} type="button" onClick={() => setAutoDeploy((value) => !value)}><i /></button></div><div className="config-note"><ShieldCheck /><div><strong>安全边界</strong><p>GitHub 授权、Webhook 与构建凭据仅由服务端持有；本页面只展示绑定结果。</p></div></div></> : null}</div><footer><button className="button secondary" type="button" onClick={canGoBack ? () => setStep((value) => value - 1) : onCancel}>{canGoBack ? '上一步' : '取消'}</button>{step < 4 ? <button className="button primary" type="button" onClick={() => setStep((value) => value + 1)}>下一步<ChevronRight /></button> : <button className="button primary" type="button" onClick={() => onSave(agent)}><CheckCircle2 />保存配置</button>}</footer></section></section></>;
}

const deploymentStatusCopy: Record<DeploymentStatus, string> = { pending: '待发布', building: '构建中', published: '已发布', failed: '失败' };

function DeploymentWorkspace({ activeDeploymentId, agentId, deployments, onBackToList, onConfigure, onCreateDeployment, onOpenDetail, onSelectAgent, view }: { activeDeploymentId: string; agentId: string; deployments: DeploymentRecord[]; onBackToList: () => void; onConfigure: (agent: Agent) => void; onCreateDeployment: (record: DeploymentRecord) => void; onOpenDetail: (id: string) => void; onSelectAgent: (id: string) => void; view: DeployView }) {
  const agents = useAgents();
  const activeDeployment = deployments.find((item) => item.id === activeDeploymentId) ?? deployments[0];
  const makeNewRecord = (record: DeploymentRecord) => onCreateDeployment({ ...record, id: `dep-retry-${Date.now()}`, status: 'building', createdAt: '刚刚', duration: '进行中', trigger: record.status === 'pending' ? '确认发布' : record.status === 'failed' ? '重新触发构建' : '重新部署', summary: '正在构建当前提交与配置版本。' });
  if (view === 'detail') return <DeploymentDetail deployment={activeDeployment} onBack={onBackToList} onConfigure={() => onConfigure(agents.find((agent) => agent.id === activeDeployment.agentId) ?? agents[0])} onRetry={() => makeNewRecord(activeDeployment)} />;
  return <DeploymentList agentId={agentId} deployments={deployments} onConfigure={onConfigure} onOpenDetail={onOpenDetail} onSelectAgent={onSelectAgent} />;
}

function DeploymentList({ agentId, deployments, onConfigure, onOpenDetail, onSelectAgent }: { agentId: string; deployments: DeploymentRecord[]; onConfigure: (agent: Agent) => void; onOpenDetail: (id: string) => void; onSelectAgent: (id: string) => void }) {
  const agents = useAgents();
  const [status, setStatus] = useState<'all' | DeploymentStatus>('all');
  const [range, setRange] = useState<DashboardRange>('today');
  const visibleRecords = deployments.filter((record) => (agentId === 'all' || record.agentId === agentId) && (status === 'all' || record.status === status));
  const selectedAgent = agents.find((agent) => agent.id === agentId) ?? agents[0];
  return <><Breadcrumb items={['工作台', '部署发布']} /><section className="page-heading deploy-heading"><div><p>工作台 / 部署发布</p><h1>部署发布</h1><span>查看 GitHub 自动部署记录，并确认待发布或重新触发已有记录。</span></div><div className="heading-actions"><button className="button secondary" type="button" onClick={() => onConfigure(selectedAgent)}><Settings />查看 Agent 配置</button></div></section><section className="deploy-toolbar"><select aria-label="筛选智能体" value={agentId} onChange={(event) => onSelectAgent(event.target.value)}><option value="all">全部智能体</option>{agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}</select><select aria-label="筛选发布状态" value={status} onChange={(event) => setStatus(event.target.value as 'all' | DeploymentStatus)}><option value="all">全部发布状态</option>{(Object.keys(deploymentStatusCopy) as DeploymentStatus[]).map((item) => <option key={item} value={item}>{deploymentStatusCopy[item]}</option>)}</select><div className="range-switcher compact" aria-label="发布记录时间范围" role="tablist">{(Object.keys(rangeLabels) as DashboardRange[]).map((item) => <button className={range === item ? 'active' : ''} type="button" key={item} role="tab" aria-selected={range === item} onClick={() => setRange(item)}>{rangeLabels[item]}</button>)}</div><small>展示 {rangeLabels[range]} 内的 mock 发布记录</small></section><section className="deployment-table-panel"><header><div><h2>发布记录</h2><p>历史记录不可修改；同一提交重试会生成新记录。</p></div><span>{visibleRecords.length} 条记录</span></header><div className="table-wrap"><table className="deployment-table"><thead><tr><th>Agent / 触发方式</th><th>提交</th><th>配置版本</th><th>状态</th><th>触发时间</th><th>耗时</th><th aria-label="操作" /></tr></thead><tbody>{visibleRecords.map((record) => <tr key={record.id} onClick={() => onOpenDetail(record.id)} tabIndex={0} onKeyDown={(event) => { if (event.key === 'Enter') onOpenDetail(record.id); }}><td><strong>{record.agentName}</strong><small>{record.trigger}</small></td><td className="mono">{record.sha}</td><td>{record.version}</td><td><span className={`deployment-status ${record.status}`}><i />{deploymentStatusCopy[record.status]}</span></td><td>{record.createdAt}</td><td>{record.duration}</td><td><ChevronRight /></td></tr>)}</tbody></table></div></section></>;
}

function DeploymentDetail({ deployment, onBack, onConfigure, onRetry }: { deployment: DeploymentRecord; onBack: () => void; onConfigure: () => void; onRetry: () => void }) {
  const action = deployment.status === 'pending' ? '确认发布' : deployment.status === 'failed' ? '重新触发构建' : deployment.status === 'published' ? '重新部署' : null;
  const stages = [{ name: '构建', state: deployment.status === 'pending' ? 'wait' : 'done' }, { name: '校验', state: deployment.status === 'building' ? 'doing' : deployment.status === 'failed' ? 'error' : deployment.status === 'pending' ? 'wait' : 'done' }, { name: '发布', state: deployment.status === 'published' ? 'done' : deployment.status === 'building' ? 'wait' : deployment.status === 'failed' ? 'wait' : 'wait' }];
  return <><Breadcrumb items={['工作台', '部署发布', deployment.id]} /><section className="page-heading deploy-heading"><div><p>部署发布 / 记录详情</p><h1>{deployment.agentName}</h1><span>GitHub 提交 <code>{deployment.sha}</code> · 配置版本 {deployment.version}</span></div><div className="heading-actions"><button className="button secondary" type="button" onClick={onConfigure}><Settings />查看 Agent 配置</button>{action ? <button className="button primary" type="button" onClick={onRetry}>{deployment.status === 'failed' ? <RefreshCw /> : <PackagePlus />}{action}</button> : null}</div></section><section className="deployment-detail"><header><div><span className={`deployment-status ${deployment.status}`}><i />{deploymentStatusCopy[deployment.status]}</span><h2>{deployment.summary}</h2><small>由 {deployment.trigger} 触发于 {deployment.createdAt}</small></div><button className="text-button" type="button" onClick={onBack}>返回发布记录<ChevronRight /></button></header><div className="deploy-timeline">{stages.map((stage) => <div className={stage.state} key={stage.name}><span>{stage.state === 'done' ? <CheckCircle2 /> : stage.state === 'error' ? <TriangleAlert /> : <Clock3 />}</span><div><strong>{stage.name}</strong><small>{stage.state === 'done' ? '已完成' : stage.state === 'error' ? '处理失败' : stage.state === 'doing' ? '进行中' : '等待开始'}</small></div></div>)}</div><dl><div><dt>代码来源</dt><dd>GitHub</dd></div><div><dt>默认分支</dt><dd className="mono">main</dd></div><div><dt>提交 SHA</dt><dd className="mono">{deployment.sha}</dd></div><div><dt>总耗时</dt><dd>{deployment.duration}</dd></div></dl>{deployment.status === 'failed' ? <div className="deployment-error"><TriangleAlert /><div><strong>失败摘要已脱敏</strong><p>{deployment.summary}</p></div></div> : null}</section></>;
}

function ScopePlaceholder({ keyName, onReturn }: { keyName: Exclude<NavKey, 'agents'>; onReturn: () => void }) { const page = pageCopy[keyName]; const Icon = page.icon; return <><Breadcrumb items={['工作台', page.title]} /><section className="placeholder"><span><Icon /></span><h1>{page.title}</h1><strong>{page.description}</strong><small>本次 MVP 优先完整实现“智能体 Agents”页面，其余模块已对齐参考页的信息架构。</small><button className="button primary" type="button" onClick={onReturn}><Bot />返回智能体管理</button></section></>; }

function ModelConnectionDialog({ onClose, onSubmit }: { onClose: () => void; onSubmit: () => void }) { useEffect(() => { const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); }; window.addEventListener('keydown', closeOnEscape); return () => window.removeEventListener('keydown', closeOnEscape); }, [onClose]); return <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section aria-modal="true" aria-labelledby="model-connection-title" className="dialog" role="dialog"><header><div><span className="dialog-icon"><KeyRound /></span><h2 id="model-connection-title">配置模型连接</h2></div><button className="icon-button" type="button" title="关闭" aria-label="关闭" onClick={onClose}><X /></button></header><form onSubmit={(event) => { event.preventDefault(); onSubmit(); }}><div className="dialog-body"><label>关联 Agent<select defaultValue="客服 Agent #1"><option>客服 Agent #1</option><option>助手 Agent</option><option>数据分析 Agent</option><option>客服 Agent #2</option></select></label><div className="form-grid"><label>模型服务商<select defaultValue="OpenAI 兼容"><option>OpenAI 兼容</option><option>DeepSeek</option><option>Anthropic</option><option>Azure OpenAI</option></select></label><label>模型名称<input defaultValue="deepseek-chat" name="modelName" /></label></div><label>Base URL<input defaultValue="https://api.example.com/v1" name="baseUrl" type="url" /></label><label>API Key <strong>*</strong><input autoComplete="off" name="apiKey" placeholder="输入 API Key" required spellCheck={false} type="password" /><small className="form-note">仅用于界面演示；密钥不会写入 React state、URL 或浏览器存储。</small></label></div><footer><button className="button secondary" type="button" onClick={onClose}>取消</button><button className="button primary" type="submit">提交验证<ChevronRight /></button></footer></form></section></div>; }

function CreateDialog({ onClose, onSubmit }: { onClose: () => void; onSubmit: () => void }) { useEffect(() => { const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); }; window.addEventListener('keydown', closeOnEscape); return () => window.removeEventListener('keydown', closeOnEscape); }, [onClose]); return <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section aria-modal="true" aria-labelledby="create-agent-title" className="dialog" role="dialog"><header><div><span className="dialog-icon"><Bot /></span><h2 id="create-agent-title">新建 Agent 项目</h2></div><button className="icon-button" type="button" title="关闭" aria-label="关闭" onClick={onClose}><X /></button></header><div className="dialog-body"><ol className="steps"><li className="active"><b>1</b><span>基础信息</span><small>名称、描述、框架</small></li><li><b>2</b><span>模型 & 工具</span><small>选择模型网关与工具集</small></li><li><b>3</b><span>渠道接入</span><small>Web / 飞书 / 微信 / API</small></li><li><b>4</b><span>确认创建</span><small>Review 并提交</small></li></ol><label>Agent 名称 <strong>*</strong><input autoFocus placeholder="例如：客服助手 Pro" /></label><div className="form-grid"><label>开发框架<select defaultValue="OpenAI Agents SDK"><option>OpenAI Agents SDK</option><option>LangGraph</option><option>CrewAI</option><option>Claude Tools</option><option>自定义（裸 Runtime）</option></select></label><label>运行环境<select defaultValue="广州共享集群（默认）"><option>广州共享集群（默认）</option><option>指定客户 SRV-SH-01</option><option>自建服务器</option></select></label></div><label>项目描述<textarea placeholder="简要描述智能体的用途和能力..." rows={3} /></label><p className="form-note">建议 10-100 字，方便后续检索与管理。当前为纯前端原型，提交结果不会写入服务器。</p></div><footer><button className="button secondary" type="button" onClick={onClose}>取消</button><button className="button primary" type="button" onClick={onSubmit}>下一步：配置模型 <ChevronRight /></button></footer></section></div>; }
