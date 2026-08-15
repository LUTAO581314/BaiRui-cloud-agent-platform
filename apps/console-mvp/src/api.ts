import type { LucideIcon } from 'lucide-react';
import type { Agent, AgentStatus } from './App';

const API_BASE = import.meta.env.VITE_API_BASE ?? '';

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
