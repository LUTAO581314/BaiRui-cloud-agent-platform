import type { LucideIcon } from 'lucide-react';
import type { Agent, AgentStatus } from './App';

// 后端接入开关：
// - 未配置 VITE_API_BASE 时 USE_MOCK 为 true，前端使用内置 mock 数据，不发起任何网络请求；
// - 配置了 VITE_API_BASE（例如 https://api.bairui.app）后 USE_MOCK 为 false，自动改走真实接口。
// 这样开发阶段无需后端即可演示，后端就绪后只需设置环境变量即可无缝切换。
const API_BASE = import.meta.env.VITE_API_BASE ?? '';
const USE_MOCK = API_BASE === '';

// 与 App.tsx 中的 MOCK_AGENTS 保持结构一致（此处仅用于降级，不渲染图标）。
const MOCK_AGENTS: Agent[] = [
  { id: 'agent-cs-01', name: '客服 Agent #1', description: '接入飞书、微信、官网三个渠道，覆盖售前咨询与售后工单', status: 'running', model: 'DeepSeek V3', stats: [{ value: '24', label: '活跃会话' }, { value: '1.2K', label: '今日消息' }], channels: ['飞书', '微信', '官网'], icon: undefined as unknown as LucideIcon, color: 'blue', host: 'agent-agent-cs-01.bairui.app' },
  { id: 'agent-asst', name: '助手 Agent', description: '组织内知识库问答 + 日程/邮件工具，员工效率助手', status: 'running', model: 'Claude 3.5', stats: [{ value: '8', label: '活跃会话' }, { value: '326', label: '今日消息' }], channels: ['钉钉', '官网'], icon: undefined as unknown as LucideIcon, color: 'violet', host: 'agent-agent-asst.bairui.app' },
  { id: 'agent-data', name: '数据分析 Agent', description: 'BI 场景，连接 ClickHouse + StarRocks，支持可视化输出', status: 'deploying', model: 'GPT-4o', stats: [{ value: '-', label: '活跃会话' }, { value: '-', label: '今日消息' }], channels: ['官网', 'API'], icon: undefined as unknown as LucideIcon, color: 'orange', host: 'agent-agent-data.bairui.app' },
  { id: 'agent-cs-02', name: '客服 Agent #2', description: '独立部署于客户 SRV-GZ-03，专属客户定制能力', status: 'initializing', model: 'Qwen Max', stats: [{ value: '-', label: '活跃会话' }, { value: '-', label: '今日消息' }], channels: ['微信'], icon: undefined as unknown as LucideIcon, color: 'green', host: 'agent-agent-cs-02.bairui.app' },
];

const MOCK_USAGE: Record<'today' | '7d' | '30d', UsagePayload> = {
  today: {
    range: 'today', updatedAt: new Date().toISOString(),
    summary: { totalCalls: 12800, failedCalls: 102, successRate: 0.992, avgLatencyMs: 386, totalTokens: 1842000, estimatedCostUsd: 12.4, totalConversations: 86, activeAgents: 3 },
    modelBreakdown: [{ model: 'DeepSeek V3', calls: 5376, share: 0.42 }, { model: 'Claude 3.5', calls: 3968, share: 0.31 }, { model: 'GPT-4o', calls: 2304, share: 0.18 }, { model: '其他模型', calls: 1152, share: 0.09 }],
    series: [
      { bucketStart: '00:00', calls: 320, failedCalls: 4, avgLatencyMs: 410 },
      { bucketStart: '04:00', calls: 280, failedCalls: 2, avgLatencyMs: 398 },
      { bucketStart: '08:00', calls: 2100, failedCalls: 18, avgLatencyMs: 372 },
      { bucketStart: '12:00', calls: 3200, failedCalls: 26, avgLatencyMs: 365 },
      { bucketStart: '16:00', calls: 2980, failedCalls: 24, avgLatencyMs: 388 },
      { bucketStart: '20:00', calls: 2120, failedCalls: 17, avgLatencyMs: 401 },
      { bucketStart: '现在', calls: 1800, failedCalls: 11, avgLatencyMs: 379 },
    ],
  },
  '7d': {
    range: '7d', updatedAt: new Date().toISOString(),
    summary: { totalCalls: 72400, failedCalls: 796, successRate: 0.989, avgLatencyMs: 401, totalTokens: 10420000, estimatedCostUsd: 71.3, totalConversations: 512, activeAgents: 3 },
    modelBreakdown: [{ model: 'DeepSeek V3', calls: 30408, share: 0.42 }, { model: 'Claude 3.5', calls: 22444, share: 0.31 }, { model: 'GPT-4o', calls: 13032, share: 0.18 }, { model: '其他模型', calls: 6516, share: 0.09 }],
    series: [
      { bucketStart: '08-06', calls: 9800, failedCalls: 110, avgLatencyMs: 408 },
      { bucketStart: '08-07', calls: 10200, failedCalls: 121, avgLatencyMs: 399 },
      { bucketStart: '08-08', calls: 10600, failedCalls: 118, avgLatencyMs: 392 },
      { bucketStart: '08-09', calls: 11100, failedCalls: 124, avgLatencyMs: 405 },
      { bucketStart: '08-10', calls: 10800, failedCalls: 119, avgLatencyMs: 396 },
      { bucketStart: '08-11', calls: 9900, failedCalls: 102, avgLatencyMs: 401 },
      { bucketStart: '今日', calls: 9900, failedCalls: 102, avgLatencyMs: 401 },
    ],
  },
  '30d': {
    range: '30d', updatedAt: new Date().toISOString(),
    summary: { totalCalls: 298600, failedCalls: 3882, successRate: 0.987, avgLatencyMs: 418, totalTokens: 43000000, estimatedCostUsd: 294.8, totalConversations: 2348, activeAgents: 3 },
    modelBreakdown: [{ model: 'DeepSeek V3', calls: 125412, share: 0.42 }, { model: 'Claude 3.5', calls: 92566, share: 0.31 }, { model: 'GPT-4o', calls: 53748, share: 0.18 }, { model: '其他模型', calls: 26874, share: 0.09 }],
    series: [
      { bucketStart: '07-13', calls: 8200, failedCalls: 110, avgLatencyMs: 430 },
      { bucketStart: '07-18', calls: 9100, failedCalls: 120, avgLatencyMs: 421 },
      { bucketStart: '07-23', calls: 9800, failedCalls: 128, avgLatencyMs: 415 },
      { bucketStart: '07-28', calls: 10400, failedCalls: 135, avgLatencyMs: 419 },
      { bucketStart: '08-02', calls: 10100, failedCalls: 131, avgLatencyMs: 414 },
      { bucketStart: '08-07', calls: 9900, failedCalls: 128, avgLatencyMs: 418 },
      { bucketStart: '今日', calls: 9900, failedCalls: 130, avgLatencyMs: 418 },
    ],
  },
};

// 后端 agent 运行态 operational.code 的取值范围比 MVP 三态更细，这里归并。
// ready/upgrading/degraded/offline/model_unconfigured/quota_exhausted -> running（可见可交互）
// initializing/provisioning -> initializing
// 其余（uninitialized/stopped/suspended/failed/deleted）-> deploying（占位展示，避免空态）
function mapStatus(code: string | undefined, runtimeStatus: string | undefined): AgentStatus {
  if (code === 'initializing' || code === 'provisioning' || runtimeStatus === 'starting') return 'initializing';
  if (code === 'uninitialized') return 'deploying';
  if (['ready', 'upgrading', 'degraded', 'offline', 'model_unconfigured', 'quota_exhausted'].includes(code ?? '')) return 'running';
  if (['stopped', 'suspended', 'failed'].includes(code ?? '')) return 'deploying';
  return 'running';
}

// 后端 agentOperationalView 返回的对象（部分字段）。
interface BackendAgent {
  id: string;
  name: string;
  description?: string;
  status?: string;
  settings?: { preferredModel?: string };
  initializationStatus?: string;
  runtime?: { status?: string } | null;
  operational?: { code?: string } | null;
}

export async function fetchAgents(): Promise<Agent[]> {
  // 开发阶段未接入后端时，直接返回内置 mock，不发起网络请求。
  if (USE_MOCK) return MOCK_AGENTS;

  const response = await fetch(`${API_BASE}/api/user/agents`, {
    headers: { accept: 'application/json' },
    credentials: 'include',
  });
  if (!response.ok) throw new Error(`agents request failed: ${response.status}`);
  const payload = (await response.json()) as { agents?: BackendAgent[] };
  const items = payload.agents ?? [];
  return items.map((item) => ({
    id: item.id,
    name: item.name,
    description: item.description ?? '',
    status: mapStatus(item.operational?.code ?? item.status, item.runtime?.status),
    model: item.settings?.preferredModel ?? '未配置',
    // 后端未返回展示用图标/渠道/统计，按 MVP 结构优雅降级。
    icon: undefined as unknown as LucideIcon,
    color: 'blue',
    channels: [],
    stats: [{ label: '活跃会话', value: '—' }],
    // 文档 25：每个 agent 永久域名 agent-{id}.bairui.app（后端暂未返回 host 字段，先按约定占位）。
    host: `agent-${item.id}.bairui.app`,
  }));
}

export interface UsageSummary {
  totalCalls: number;
  failedCalls: number;
  successRate: number;
  avgLatencyMs: number;
  totalTokens: number;
  estimatedCostUsd: number;
  totalConversations: number;
  activeAgents: number;
}

export interface ModelSlice {
  model: string;
  calls: number;
  share: number;
}

export interface UsageSeriesPoint {
  bucketStart: string;
  calls: number;
  failedCalls: number;
  avgLatencyMs: number;
}

export interface UsagePayload {
  range: string;
  updatedAt: string;
  summary: UsageSummary;
  modelBreakdown: ModelSlice[];
  series: UsageSeriesPoint[];
}

export async function fetchUsage(range: 'today' | '7d' | '30d'): Promise<UsagePayload> {
  // 开发阶段未接入后端时，直接返回内置 mock，不发起网络请求。
  if (USE_MOCK) return MOCK_USAGE[range];

  const response = await fetch(`${API_BASE}/api/user/usage?range=${range}`, {
    headers: { accept: 'application/json' },
    credentials: 'include',
  });
  if (!response.ok) throw new Error(`usage request failed: ${response.status}`);
  return (await response.json()) as UsagePayload;
}
