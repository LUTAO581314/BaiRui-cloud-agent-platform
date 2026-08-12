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
  Terminal,
  TrendingDown,
  TrendingUp,
  TriangleAlert,
  Users,
  X,
  Zap,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

type NavKey = 'overview' | 'agents' | 'conversations' | 'deploy' | 'api' | 'control' | 'approvals' | 'observability' | 'organization' | 'license' | 'servers' | 'audit';
type WorkspaceTab = 'templates' | 'projects' | 'runs' | 'settings';
type AgentStatus = 'running' | 'deploying' | 'initializing';
type DashboardRange = 'today' | '7d' | '30d';
type ModelConnectionState = 'unconfigured' | 'validating';
type ApiConnectionStatus = 'verified' | 'pending' | 'disabled';

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

interface Agent {
  id: string;
  name: string;
  host: string;
  description: string;
  status: AgentStatus;
  model: string;
  stats: { label: string; value: string }[];
  channels: string[];
  icon: LucideIcon;
  color: 'blue' | 'violet' | 'orange' | 'green';
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

const navGroups: { title: string; items: NavItem[] }[] = [
  { title: '工作台', items: [{ key: 'overview', label: '总览仪表盘', icon: LayoutDashboard }, { key: 'agents', label: '智能体 Agents', icon: Bot, badge: '4' }, { key: 'conversations', label: '会话管理', icon: MessageSquare }] },
  { title: '开发与部署', items: [{ key: 'deploy', label: '部署发布', icon: PackagePlus }, { key: 'api', label: 'API 配置', icon: KeyRound, badge: '3' }, { key: 'control', label: '运维控制', icon: Settings }, { key: 'approvals', label: '审批中心', icon: ClipboardCheck, badge: '2', tone: 'danger' }, { key: 'observability', label: '可观测', icon: Activity }] },
  { title: '平台管理', items: [{ key: 'organization', label: '组织成员', icon: Users }, { key: 'license', label: 'License 授权', icon: FileText }, { key: 'servers', label: '服务器', icon: Server, badge: '3', tone: 'warning' }, { key: 'audit', label: '审计日志', icon: ShieldCheck }] },
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

const agents: Agent[] = [
  { id: 'agent-cs-01', name: '客服 Agent #1', host: 'agent-cs-01.bairui.app', description: '接入飞书、微信、官网三个渠道，覆盖售前咨询与售后工单', status: 'running', model: 'DeepSeek V3', stats: [{ value: '24', label: '活跃会话' }, { value: '1.2K', label: '今日消息' }, { value: '386ms', label: '平均延迟' }, { value: '98.7%', label: '满意度' }], channels: ['飞', '微', '网'], icon: MessageSquare, color: 'blue' },
  { id: 'agent-asst', name: '助手 Agent', host: 'agent-asst.bairui.app', description: '组织内知识库问答 + 日程/邮件工具，员工效率助手', status: 'running', model: 'Claude 3.5', stats: [{ value: '8', label: '活跃会话' }, { value: '326', label: '今日消息' }, { value: '412ms', label: '平均延迟' }, { value: '-', label: '满意度' }], channels: ['钉', '网'], icon: Bot, color: 'violet' },
  { id: 'agent-data', name: '数据分析 Agent', host: 'agent-data.bairui.app', description: 'BI 场景，连接 ClickHouse + StarRocks，支持可视化输出', status: 'deploying', model: 'GPT-4o', stats: [{ value: '-', label: '活跃会话' }, { value: '-', label: '今日消息' }, { value: '-', label: '平均延迟' }, { value: '-', label: '满意度' }], channels: ['网', 'API'], icon: Activity, color: 'orange' },
  { id: 'agent-cs-02', name: '客服 Agent #2', host: 'agent-cs-02.bairui.app', description: '独立部署于客户 SRV-GZ-03，专属客户定制能力', status: 'initializing', model: 'Qwen Max', stats: [{ value: '-', label: '活跃会话' }, { value: '-', label: '今日消息' }, { value: '-', label: '平均延迟' }, { value: '-', label: '满意度' }], channels: ['微'], icon: MessageSquare, color: 'green' },
];

const initialApiConnections: ApiConnection[] = [
  { id: 'conn-deepseek', name: 'DeepSeek 主连接', provider: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', keyHint: 'sk-••••••••a1b2', models: ['deepseek-chat', 'deepseek-reasoner'], status: 'verified', lastValidated: '今天 09:42', requests: '8.4K' },
  { id: 'conn-anthropic', name: 'Anthropic 备用连接', provider: 'Anthropic', baseUrl: 'https://api.anthropic.com', keyHint: 'sk-ant-••••••c3d4', models: ['claude-3-5-sonnet', 'claude-3-5-haiku'], status: 'verified', lastValidated: '昨天 18:06', requests: '3.1K' },
  { id: 'conn-openrouter', name: 'OpenRouter 多模型', provider: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', keyHint: 'sk-or-••••••e5f6', models: ['qwen/qwen-2.5-72b-instruct', 'google/gemini-2.0-flash'], status: 'pending', lastValidated: '尚未验证', requests: '—' },
];

const statusCopy: Record<AgentStatus, string> = { running: '运行中', deploying: '部署中', initializing: '初始化' };
const pageCopy: Record<Exclude<NavKey, 'agents'>, { title: string; description: string; icon: LucideIcon }> = {
  overview: { title: '总览仪表盘', description: '查看平台运行状态、智能体健康与最近操作记录。', icon: LayoutDashboard },
  conversations: { title: '会话管理', description: '统一检索智能体会话与执行记录。', icon: MessageSquare },
  deploy: { title: '部署发布', description: '管理环境、部署包与发布历史。', icon: PackagePlus },
  api: { title: 'API 配置', description: '管理模型连接、可用模型和验证状态。', icon: KeyRound },
  control: { title: '运维控制', description: '执行平台控制指令与环境维护。', icon: Settings },
  approvals: { title: '审批中心', description: '处理高风险操作与发布审批。', icon: ClipboardCheck },
  observability: { title: '可观测', description: '查看调用链路、指标和异常告警。', icon: Activity },
  organization: { title: '组织成员', description: '管理组织、成员和协作角色。', icon: Users },
  license: { title: 'License 授权', description: '查看授权套餐与配额使用情况。', icon: FileText },
  servers: { title: '服务器', description: '查看注册服务器和心跳状态。', icon: Server },
  audit: { title: '审计日志', description: '追踪平台关键动作与访问事件。', icon: ShieldCheck },
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
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<'all' | AgentStatus>('all');
  const [toast, setToast] = useState('');
  const filteredAgents = useMemo(() => agents.filter((agent) => (status === 'all' || agent.status === status) && (!query.trim() || `${agent.name} ${agent.host} ${agent.description} ${agent.channels.join(' ')}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))), [query, status]);

  function notify(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(''), 2600);
  }

  return <div className="app-shell">
    <Header onMenuClick={() => setSidebarOpen((value) => !value)} />
    <div className="workspace-shell">
      <Sidebar activeNav={activeNav} apiConnectionCount={apiConnections.length} isOpen={isSidebarOpen} onSelect={(key) => { setActiveNav(key); setSidebarOpen(false); }} />
      <main className="main-content">
        {activeNav === 'overview' ? <OverviewDashboard dashboardRange={dashboardRange} modelConnectionState={modelConnectionState} onConfigureModel={() => setModelDialogOpen(true)} onCreate={() => setCreateDialogOpen(true)} onNavigate={setActiveNav} onRangeChange={setDashboardRange} /> : null}
        {activeNav === 'agents' ? <AgentWorkspace activeTab={activeTab} agents={filteredAgents} onCreate={() => setCreateDialogOpen(true)} onNotify={notify} onQueryChange={setQuery} onStatusChange={setStatus} query={query} setActiveTab={setActiveTab} status={status} /> : null}
        {activeNav === 'api' ? <ApiConfigWorkspace activeConnectionId={activeApiConnectionId} connections={apiConnections} onAdd={() => setApiDialogOpen(true)} onNotify={notify} onSelect={setActiveApiConnectionId} onToggle={(id) => setApiConnections((items) => items.map((item) => item.id === id ? { ...item, status: item.status === 'disabled' ? 'pending' : 'disabled', lastValidated: item.status === 'disabled' ? '等待验证' : item.lastValidated } : item))} onValidate={(id) => setApiConnections((items) => items.map((item) => item.id === id ? { ...item, status: 'pending', lastValidated: '验证请求已提交' } : item))} /> : null}
        {activeNav !== 'overview' && activeNav !== 'agents' && activeNav !== 'api' ? <ScopePlaceholder keyName={activeNav} onReturn={() => setActiveNav('agents')} /> : null}
      </main>
    </div>
    {isCreateDialogOpen ? <CreateDialog onClose={() => setCreateDialogOpen(false)} onSubmit={() => { setCreateDialogOpen(false); notify('已提交：下一步配置模型'); }} /> : null}
    {isModelDialogOpen ? <ModelConnectionDialog onClose={() => setModelDialogOpen(false)} onSubmit={() => { setModelDialogOpen(false); setModelConnectionState('validating'); notify('模型连接已提交，等待后端验证。'); }} /> : null}
    {isApiDialogOpen ? <ApiConnectionDialog onClose={() => setApiDialogOpen(false)} onSubmit={(draft) => { const newConnection: ApiConnection = { id: `conn-${Date.now()}`, ...draft, keyHint: '已提交，等待服务端保存', status: 'pending', lastValidated: '尚未验证', requests: '—' }; setApiConnections((items) => [newConnection, ...items]); setActiveApiConnectionId(newConnection.id); setApiDialogOpen(false); notify('连接已创建，等待后端验证。'); }} /> : null}
    {toast ? <div className="toast" role="status">{toast}</div> : null}
  </div>;
}

function Header({ onMenuClick }: { onMenuClick: () => void }) {
  return <header className="topbar">
    <div className="brand-cluster"><button className="mobile-menu" type="button" title="展开导航" aria-label="展开导航" onClick={onMenuClick}><Menu /></button><a className="brand" href="#top"><span className="brand-mark">BR</span><span className="brand-name">百瑞云</span><span className="brand-divider" /><span className="brand-product">控制台</span></a><button className="product-switch" type="button"><Boxes />产品<ChevronDown /></button><nav className="top-nav" aria-label="主导航"><a className="active" href="#top">控制台</a><a href="#product">产品</a><a href="#solutions">解决方案</a><a href="#pricing">定价</a><a href="#docs">文档</a><a href="#developers">开发者</a></nav></div>
    <div className="top-actions"><label className="global-search"><Search /><input aria-label="全局搜索" placeholder="搜索产品、文档、Agent 项目..." /></label><button className="region" type="button"><Globe2 />广州<ChevronDown /></button><button className="icon-button" type="button" title="消息" aria-label="消息"><Bell /><i /></button><button className="icon-button help" type="button" title="帮助" aria-label="帮助"><CircleHelp /></button><button className="icon-button ticket" type="button" title="工单" aria-label="工单"><FileText /></button><button className="account-menu" type="button" aria-label="打开账户菜单"><span><strong>管理员</strong><small>平台管理员</small></span><b>A</b></button></div>
  </header>;
}

function Sidebar({ activeNav, apiConnectionCount, isOpen, onSelect }: { activeNav: NavKey; apiConnectionCount: number; isOpen: boolean; onSelect: (key: NavKey) => void }) {
  return <aside className={`sidebar ${isOpen ? 'open' : ''}`} aria-label="控制台导航">{navGroups.map((group) => <section className="nav-group" key={group.title}><h2>{group.title}</h2>{group.items.map((item) => { const Icon = item.icon; const badge = item.key === 'api' ? String(apiConnectionCount) : item.badge; return <button className={`nav-item ${activeNav === item.key ? 'active' : ''}`} type="button" key={item.key} onClick={() => onSelect(item.key)}><Icon /><span>{item.label}</span>{badge ? <em className={item.tone ?? ''}>{badge}</em> : null}</button>; })}</section>)}</aside>;
}

function OverviewDashboard({ dashboardRange, modelConnectionState, onConfigureModel, onCreate, onNavigate, onRangeChange }: { dashboardRange: DashboardRange; modelConnectionState: ModelConnectionState; onConfigureModel: () => void; onCreate: () => void; onNavigate: (key: NavKey) => void; onRangeChange: (range: DashboardRange) => void }) {
  const isModelPending = modelConnectionState === 'validating';
  const metrics = dashboardMetrics[dashboardRange];
  const axisLabels = rangeAxisLabels[dashboardRange];
  const activities = [
    { title: '会话调用完成', detail: '已完成 42 次模型响应，平均耗时 372ms', time: '8 分钟前', icon: MessageSquare, tone: 'blue' },
    { title: '调用趋势已更新', detail: `已同步${rangeLabels[dashboardRange]}的调用与延迟汇总`, time: '26 分钟前', icon: RefreshCw, tone: 'green' },
    { title: '模型连接需要处理', detail: isModelPending ? '配置已提交，正在等待后端验证' : '尚未完成模型服务连接配置', time: isModelPending ? '刚刚' : '今天 09:12', icon: KeyRound, tone: 'orange' },
  ];

  return <><Breadcrumb items={['工作台', '总览仪表盘']} /><section className="page-heading overview-heading"><div><p>工作台 / 总览</p><h1>总览仪表盘</h1><span>汇总查看会话、调用表现和近期活动，详细 Agent 配置请前往智能体页面。</span></div><div className="heading-actions"><small>数据更新于今天 10:24</small><button className="button secondary" type="button" onClick={onConfigureModel}><KeyRound />模型连接</button><button className="button primary" type="button" onClick={onCreate}><Plus />创建 Agent</button></div></section><section className="overview-toolbar"><div className="range-switcher" aria-label="统计时间范围" role="tablist">{(Object.keys(rangeLabels) as DashboardRange[]).map((range) => <button className={dashboardRange === range ? 'active' : ''} type="button" key={range} role="tab" aria-selected={dashboardRange === range} onClick={() => onRangeChange(range)}>{rangeLabels[range]}</button>)}</div><span>所有指标按所选时间范围统计</span></section><section className={`connection-notice ${isModelPending ? 'pending' : ''}`}><span><KeyRound /></span><div><strong>{isModelPending ? '模型连接等待验证' : '完成模型连接后即可开始调用'}</strong><p>{isModelPending ? '本地配置草稿已提交；服务端接入后将返回最终验证结果。' : '设置 Provider、Base URL、模型和 API Key。密钥不会在浏览器中保存。'}</p></div><button className="button secondary" type="button" onClick={onConfigureModel}>{isModelPending ? '查看配置' : '开始配置'}<ChevronRight /></button></section><section className="metric-grid" aria-label="总览指标">{metrics.map((metric) => <MetricCard key={metric.label} metric={metric} />)}</section><section className="overview-main-grid"><article className="chart-card overview-trend"><header><strong><i className="blue-dot" />调用趋势</strong><span><b />调用量 <b className="muted-dot" />平均延迟</span></header><div className="line-chart" aria-label={`${rangeLabels[dashboardRange]}调用量与平均延迟趋势`} role="img"><div className="chart-grid-lines" /><div className={`chart-wave range-${dashboardRange}`} /><div className={`chart-wave secondary range-${dashboardRange}`} /><footer>{axisLabels.map((label) => <span key={label}>{label}</span>)}</footer></div></article><article className="chart-card model-chart"><header><strong><i className="violet-dot" />模型调用分布</strong><span>{rangeLabels[dashboardRange]}</span></header><div aria-label={`${rangeLabels[dashboardRange]}中，DeepSeek V3 占 42%，Claude 3.5 占 31%，GPT-4o 占 18%`} role="img"><div className="ring"><span><strong>{metrics[1].value}</strong><small>调用次数</small></span></div><ul aria-hidden="true"><li><i className="blue-dot" />DeepSeek V3 <b>42%</b></li><li><i className="violet-dot" />Claude 3.5 <b>31%</b></li><li><i className="green-dot" />GPT-4o <b>18%</b></li><li><i className="orange-dot" />其他模型 <b>9%</b></li></ul></div></article></section><section className="overview-bottom-grid"><article className="activity-panel"><header><div><h2>最近活动</h2><p>仅展示当前工作区的聚合事件</p></div><button className="text-button" type="button" onClick={() => onNavigate('conversations')}>查看全部<ChevronRight /></button></header><ol>{activities.map((activity) => { const Icon = activity.icon; return <li key={activity.title}><span className={activity.tone}><Icon /></span><div><strong>{activity.title}</strong><p>{activity.detail}</p></div><time>{activity.time}</time></li>; })}</ol></article><article className="quick-actions-panel"><header><div><h2>快捷操作</h2><p>从总览进入常用工作流</p></div></header><div><button type="button" onClick={onCreate}><span><Plus /></span><strong>创建 Agent</strong><small>从模板或空白项目开始</small><ChevronRight /></button><button type="button" onClick={onConfigureModel}><span><KeyRound /></span><strong>配置模型连接</strong><small>管理模型服务与验证状态</small><ChevronRight /></button><button type="button" onClick={() => onNavigate('agents')}><span><Bot /></span><strong>进入智能体</strong><small>查看项目与详细配置</small><ChevronRight /></button></div></article></section></>;
}

function AgentWorkspace({ activeTab, agents: visibleAgents, onCreate, onNotify, onQueryChange, onStatusChange, query, setActiveTab, status }: { activeTab: WorkspaceTab; agents: Agent[]; onCreate: () => void; onNotify: (message: string) => void; onQueryChange: (value: string) => void; onStatusChange: (value: 'all' | AgentStatus) => void; query: string; setActiveTab: (tab: WorkspaceTab) => void; status: 'all' | AgentStatus }) {
  const tabs: { key: WorkspaceTab; label: string; badge?: string }[] = [{ key: 'templates', label: '快速开始', badge: '6' }, { key: 'projects', label: '我的项目', badge: '4' }, { key: 'runs', label: '运行记录' }, { key: 'settings', label: '接入配置' }];
  return <><Breadcrumb items={['EdgeOne Makers', '智能体 Agents']} /><section className="page-heading"><div><p>工作台 / 智能体</p><h1>智能体管理</h1><span>查看项目运行状态、近期调用和待处理事项，并从这里创建新的智能体项目。</span></div><div className="heading-actions"><span>共 4 个项目</span><button className="button primary" type="button" onClick={onCreate}><Plus />新建 Agent 项目</button></div></section><section className="metric-grid" aria-label="智能体指标">{agentMetrics.map((metric) => <MetricCard key={metric.label} metric={metric} />)}</section><section className="workspace-panel"><div className="tabs" role="tablist">{tabs.map((tab) => <button className={activeTab === tab.key ? 'active' : ''} type="button" key={tab.key} role="tab" aria-selected={activeTab === tab.key} onClick={() => setActiveTab(tab.key)}>{tab.label}{tab.badge ? <span>{tab.badge}</span> : null}</button>)}</div><div className="tab-content">{activeTab === 'templates' ? <TemplatePanel onCreate={onCreate} /> : null}{activeTab === 'projects' ? <AgentPanel agents={visibleAgents} onCreate={onCreate} onNotify={onNotify} onQueryChange={onQueryChange} onStatusChange={onStatusChange} query={query} status={status} /> : null}{activeTab === 'runs' ? <RunsPanel /> : null}{activeTab === 'settings' ? <SettingsPanel onNotify={onNotify} /> : null}</div></section>{activeTab === 'templates' ? <><ReferenceAlert onNotify={onNotify} /><ObservabilityPanels /></> : null}</>;
}

function Breadcrumb({ items }: { items: string[] }) { return <nav className="breadcrumb" aria-label="面包屑">{items.map((item, index) => <span key={item}>{index ? <i>/</i> : null}<b className={index === items.length - 1 ? 'current' : ''}>{item}</b></span>)}</nav>; }
function MetricCard({ metric }: { metric: Metric }) { const Icon = metric.icon; const TrendIcon = metric.trendTone === 'up' ? TrendingUp : TrendingDown; return <article className={`metric-card ${metric.tone}`}><div className="metric-head"><span>{metric.label}</span><i><Icon /></i></div><strong>{metric.value}</strong><small><em className={metric.trendTone}><TrendIcon />{metric.trend}</em><span>{metric.comparison ?? '较上周同期'}</span></small></article>; }

function TemplatePanel({ onCreate }: { onCreate: () => void }) { return <><TemplateSection heading="精选模板 · 一键启动" action="查看全部 120+ 模板" items={templates} onCreate={onCreate} /><TemplateSection heading="按框架分类" items={frameworks} onCreate={onCreate} variant="framework" /></>; }
function TemplateSection({ action, heading, items, onCreate, variant }: { action?: string; heading: string; items: Template[]; onCreate: () => void; variant?: 'framework' }) { return <section className={`template-section ${variant ?? ''}`}><div className="section-heading"><h2>{heading}</h2>{action ? <button className="text-button" type="button" onClick={() => onCreate()}>{action}<ChevronRight /></button> : null}</div><div className="template-grid">{items.map((template) => { const Icon = template.icon; return <button className="template-card" key={template.name} type="button" onClick={onCreate}><span className={`template-icon ${template.color}`}><Icon /></span><strong>{template.name}</strong><p>{template.description}</p><span className="template-meta">{template.tags.map((tag) => <i key={tag}>{tag}</i>)}</span></button>; })}</div></section>; }

function AgentPanel({ agents: visibleAgents, onCreate, onNotify, onQueryChange, onStatusChange, query, status }: { agents: Agent[]; onCreate: () => void; onNotify: (message: string) => void; onQueryChange: (value: string) => void; onStatusChange: (value: 'all' | AgentStatus) => void; query: string; status: 'all' | AgentStatus }) { return <><div className="toolbar"><div className="toolbar-left"><label className="field-search"><Search /><input value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="搜索智能体名称、ID、渠道..." /></label><select value={status} onChange={(event) => onStatusChange(event.target.value as 'all' | AgentStatus)} aria-label="筛选智能体状态"><option value="all">全部状态</option><option value="running">运行中</option><option value="deploying">部署中</option><option value="initializing">初始化</option></select><select aria-label="筛选开发框架"><option>全部框架</option><option>OpenAI Agents</option><option>LangGraph</option><option>CrewAI</option></select></div><div className="toolbar-right"><button className="button secondary" type="button" onClick={() => onNotify('导入功能将在后端接入后开放。')}><Download />导入</button><button className="button primary" type="button" onClick={onCreate}><Plus />新建 Agent 项目</button></div></div><div className="agent-grid">{visibleAgents.map((agent) => <AgentCard agent={agent} key={agent.id} onNotify={onNotify} />)}</div>{!visibleAgents.length ? <div className="empty-state"><Search /><strong>没有匹配的智能体</strong><span>调整搜索词或状态筛选后重试。</span></div> : null}</>; }
function AgentCard({ agent, onNotify }: { agent: Agent; onNotify: (message: string) => void }) { const Icon = agent.icon; return <article className="agent-card"><header><div className="agent-info"><span className={`agent-icon ${agent.color}`}><Icon /></span><div><strong>{agent.name}<i>{agent.host}</i></strong><p>{agent.description}</p></div></div><span className={`status-pill ${agent.status}`}><b />{statusCopy[agent.status]}</span></header><div className="agent-body"><div className="agent-stats">{agent.stats.map((stat) => <div key={stat.label}><strong>{stat.value}</strong><span>{stat.label}</span></div>)}</div><footer><div className="channel-list">{agent.channels.map((channel) => <i key={channel}>{channel}</i>)}</div><div className="agent-actions"><button type="button" onClick={() => onNotify(`已打开 ${agent.name} 的运行观测。`)}><Eye />监控</button><button type="button" onClick={() => onNotify(`${agent.name} 的配置页将在完整版本提供。`)}><Settings />配置</button><button className="primary" type="button" onClick={() => onNotify(`已打开 ${agent.name} 的对话入口。`)}><MessageSquare />对话</button></div></footer></div></article>; }

function ReferenceAlert({ onNotify }: { onNotify: (message: string) => void }) { return <section className="reference-alert"><span><TriangleAlert /></span><div><strong>检测到服务器 SRV-GZ-03 版本漂移</strong><p>期望版本 v0.1.0-rc.7，实际 v0.1.0-rc.6，建议尽快修复以避免功能缺失。最近心跳：2 小时前。</p></div><aside><button className="button primary" type="button" onClick={() => onNotify('修复请求已加入本地 mock 队列。')}>立即修复</button><button className="button secondary" type="button" onClick={() => onNotify('已标记为稍后处理。')}>稍后处理</button></aside></section>; }
function ObservabilityPanels() { return <section className="chart-grid"><article className="chart-card"><header><strong><i className="blue-dot" />智能体调用趋势（近 7 日）</strong><span><b />请求数 <b className="muted-dot" />Token 消耗</span></header><div className="line-chart"><div className="chart-grid-lines" /><div className="chart-wave" /><div className="chart-wave secondary" /><footer><span>08-01</span><span>08-02</span><span>08-03</span><span>08-04</span><span>08-05</span><span>08-06</span><span>今日</span></footer></div></article><article className="chart-card model-chart"><header><strong><i className="violet-dot" />模型调用分布</strong></header><div><div className="ring"><span><strong>12.8K</strong><small>总调用次数</small></span></div><ul><li><i className="blue-dot" />DeepSeek V3 <b>42%</b></li><li><i className="violet-dot" />Claude 3.5 <b>31%</b></li><li><i className="green-dot" />GPT-4o <b>18%</b></li><li><i className="orange-dot" />其他模型 <b>9%</b></li></ul></div></article></section>; }

function RunsPanel() { const runs = [['RUN_20260806_0012', '客服 Agent #1', '每日自动知识库同步', '定时任务', '2026-08-06 09:00', '2分14秒', '成功'], ['RUN_20260806_0011', '数据分析 Agent', 'SQL query: 销售月报', 'user@demo.com', '2026-08-06 08:42', '18秒', '成功'], ['RUN_20260805_0889', '助手 Agent', '工具调用: 发送邮件', '张三', '2026-08-05 18:20', '3秒', '工具异常'], ['RUN_20260805_0888', '客服 Agent #2', '初始化流程', '管理员', '2026-08-05 17:30', '-', '进行中 65%']]; return <div className="table-wrap"><table><thead><tr><th>运行 ID</th><th>智能体</th><th>任务</th><th>触发人</th><th>开始时间</th><th>耗时</th><th>状态</th><th aria-label="操作" /></tr></thead><tbody>{runs.map((run) => <tr key={run[0]}>{run.map((cell, index) => <td className={index === 0 || index === 5 ? 'mono' : ''} key={`${run[0]}-${cell}`}>{index === 6 ? <span className={`status-pill ${cell === '成功' ? 'running' : cell.includes('进行') ? 'deploying' : 'initializing'}`}><b />{cell}</span> : cell}</td>)}<td><button className="table-button" type="button">Trace</button></td></tr>)}</tbody></table></div>; }
function SettingsPanel({ onNotify }: { onNotify: (message: string) => void }) { return <div className="settings-grid"><article className="setting-card"><header><span><Cloud /></span><div><h2>模型网关 API Key</h2><p>管理模型提供商与接入凭证。</p></div></header><dl><div><dt>sk-****a1b2</dt><dd>DeepSeek</dd><dd><span className="status-pill running"><b />启用</span></dd></div><div><dt>sk-****c3d4</dt><dd>Anthropic</dd><dd><span className="status-pill running"><b />启用</span></dd></div></dl><button className="button primary" type="button" onClick={() => onNotify('新增密钥仅作前端演示。')}>新增密钥</button></article><article className="setting-card"><header><span className="violet"><GitBranch /></span><div><h2>GitHub 推送部署</h2><p>连接仓库，自动构建并发布 Agent。</p></div></header><dl><div><dt>仓库地址</dt><dd className="mono">agents-workspace</dd></div><div><dt>默认分支</dt><dd>main</dd></div></dl><button className="button secondary" type="button" onClick={() => onNotify('GitHub 连接仅作前端演示。')}>管理配置</button></article></div>; }

const apiStatusCopy: Record<ApiConnectionStatus, string> = { verified: '已验证', pending: '待验证', disabled: '已停用' };

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

function ScopePlaceholder({ keyName, onReturn }: { keyName: Exclude<NavKey, 'agents'>; onReturn: () => void }) { const page = pageCopy[keyName]; const Icon = page.icon; return <><Breadcrumb items={['工作台', page.title]} /><section className="placeholder"><span><Icon /></span><h1>{page.title}</h1><strong>{page.description}</strong><small>本次 MVP 优先完整实现“智能体 Agents”页面，其余模块已对齐参考页的信息架构。</small><button className="button primary" type="button" onClick={onReturn}><Bot />返回智能体管理</button></section></>; }

function ModelConnectionDialog({ onClose, onSubmit }: { onClose: () => void; onSubmit: () => void }) { useEffect(() => { const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); }; window.addEventListener('keydown', closeOnEscape); return () => window.removeEventListener('keydown', closeOnEscape); }, [onClose]); return <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section aria-modal="true" aria-labelledby="model-connection-title" className="dialog" role="dialog"><header><div><span className="dialog-icon"><KeyRound /></span><h2 id="model-connection-title">配置模型连接</h2></div><button className="icon-button" type="button" title="关闭" aria-label="关闭" onClick={onClose}><X /></button></header><form onSubmit={(event) => { event.preventDefault(); onSubmit(); }}><div className="dialog-body"><label>关联 Agent<select defaultValue="客服 Agent #1"><option>客服 Agent #1</option><option>助手 Agent</option><option>数据分析 Agent</option><option>客服 Agent #2</option></select></label><div className="form-grid"><label>模型服务商<select defaultValue="OpenAI 兼容"><option>OpenAI 兼容</option><option>DeepSeek</option><option>Anthropic</option><option>Azure OpenAI</option></select></label><label>模型名称<input defaultValue="deepseek-chat" name="modelName" /></label></div><label>Base URL<input defaultValue="https://api.example.com/v1" name="baseUrl" type="url" /></label><label>API Key <strong>*</strong><input autoComplete="off" name="apiKey" placeholder="输入 API Key" required spellCheck={false} type="password" /><small className="form-note">仅用于界面演示；密钥不会写入 React state、URL 或浏览器存储。</small></label></div><footer><button className="button secondary" type="button" onClick={onClose}>取消</button><button className="button primary" type="submit">提交验证<ChevronRight /></button></footer></form></section></div>; }

function CreateDialog({ onClose, onSubmit }: { onClose: () => void; onSubmit: () => void }) { useEffect(() => { const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); }; window.addEventListener('keydown', closeOnEscape); return () => window.removeEventListener('keydown', closeOnEscape); }, [onClose]); return <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section aria-modal="true" aria-labelledby="create-agent-title" className="dialog" role="dialog"><header><div><span className="dialog-icon"><Bot /></span><h2 id="create-agent-title">新建 Agent 项目</h2></div><button className="icon-button" type="button" title="关闭" aria-label="关闭" onClick={onClose}><X /></button></header><div className="dialog-body"><ol className="steps"><li className="active"><b>1</b><span>基础信息</span><small>名称、描述、框架</small></li><li><b>2</b><span>模型 & 工具</span><small>选择模型网关与工具集</small></li><li><b>3</b><span>渠道接入</span><small>Web / 飞书 / 微信 / API</small></li><li><b>4</b><span>确认创建</span><small>Review 并提交</small></li></ol><label>Agent 名称 <strong>*</strong><input autoFocus placeholder="例如：客服助手 Pro" /></label><div className="form-grid"><label>开发框架<select defaultValue="OpenAI Agents SDK"><option>OpenAI Agents SDK</option><option>LangGraph</option><option>CrewAI</option><option>Claude Tools</option><option>自定义（裸 Runtime）</option></select></label><label>运行环境<select defaultValue="广州共享集群（默认）"><option>广州共享集群（默认）</option><option>指定客户 SRV-SH-01</option><option>自建服务器</option></select></label></div><label>项目描述<textarea placeholder="简要描述智能体的用途和能力..." rows={3} /></label><p className="form-note">建议 10-100 字，方便后续检索与管理。当前为纯前端原型，提交结果不会写入服务器。</p></div><footer><button className="button secondary" type="button" onClick={onClose}>取消</button><button className="button primary" type="button" onClick={onSubmit}>下一步：配置模型 <ChevronRight /></button></footer></section></div>; }
