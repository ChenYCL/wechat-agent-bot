const BASE = '/api';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const merged: RequestInit = {
    credentials: 'include',
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options?.headers ?? {}) },
  };
  const res = await fetch(`${BASE}${path}`, merged);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const err: any = new Error(body.error || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

// ── Auth ──
export interface User { id: string; username: string; isAdmin: boolean; createdAt: number; }
export const signup = (username: string, password: string) =>
  request<{ user: User }>('/auth/signup', { method: 'POST', body: JSON.stringify({ username, password }) });
export const login = (username: string, password: string) =>
  request<{ user: User }>('/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) });
export const logout = () =>
  request<{ ok: boolean }>('/auth/logout', { method: 'POST' });
export const me = () =>
  request<{ user: User }>('/auth/me');
export const changePassword = (oldPassword: string, newPassword: string) =>
  request<{ ok: boolean }>('/auth/password', { method: 'POST', body: JSON.stringify({ oldPassword, newPassword }) });

// ── WeChat accounts ──
export interface WeChatAccount {
  accountId: string; userId: string; alias: string | null;
  status: 'pending' | 'active' | 'logged_out';
  createdAt: number; lastSeenAt: number | null;
  running?: boolean;
}
export const listAccounts = () =>
  request<{ accounts: WeChatAccount[] }>('/wechat-accounts');
export const startWeChatLogin = () =>
  request<{ sessionId: string }>('/wechat-accounts/start-login', { method: 'POST' });
export const pollWeChatLogin = (sessionId: string) =>
  request<{ state: 'pending' | 'success' | 'error'; qrUrl?: string; accountId?: string; error?: string }>(
    `/wechat-accounts/login-status/${sessionId}`,
  );
export const setAccountAlias = (accountId: string, alias: string | null) =>
  request<{ ok: boolean }>(`/wechat-accounts/${accountId}/alias`, { method: 'POST', body: JSON.stringify({ alias }) });
export const pauseAccount = (accountId: string) =>
  request<{ ok: boolean }>(`/wechat-accounts/${accountId}/pause`, { method: 'POST' });
export const resumeAccount = (accountId: string) =>
  request<{ ok: boolean }>(`/wechat-accounts/${accountId}/resume`, { method: 'POST' });
export const deleteAccount = (accountId: string) =>
  request<{ ok: boolean }>(`/wechat-accounts/${accountId}`, { method: 'DELETE' });

// ── User tasks (per-conversation reminders & watches) ──
export interface UserTask {
  id: string;
  ownerConversationId: string;
  description: string;
  type: 'reminder' | 'watch';
  schedule?: { kind: 'once' | 'cron'; runAt?: number; cron?: string };
  watch?: any;
  message: string;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
  lastTriggeredAt: number | null;
  triggerCount: number;
  lastSeenValue: string | null;
}
export const listUserTasks = (conversationId?: string) => {
  const qs = conversationId ? `?conversationId=${encodeURIComponent(conversationId)}` : '';
  return request<{ tasks: UserTask[] }>(`/user-tasks${qs}`);
};
export const getUserTask = (id: string) =>
  request<{ task: UserTask }>(`/user-tasks/${id}`);
export const runUserTask = (id: string) =>
  request<{ ok: boolean }>(`/user-tasks/${id}/run`, { method: 'POST' });
export const pauseUserTask = (id: string) =>
  request<{ ok: boolean }>(`/user-tasks/${id}/pause`, { method: 'POST' });
export const resumeUserTask = (id: string) =>
  request<{ ok: boolean }>(`/user-tasks/${id}/resume`, { method: 'POST' });
export const deleteUserTask = (id: string) =>
  request<{ ok: boolean }>(`/user-tasks/${id}`, { method: 'DELETE' });
export const getUserTaskHistory = (id: string, limit = 50) =>
  request<{ observations: Array<{ value: string | null; matched: boolean; observedAt: number }> }>(
    `/user-tasks/${id}/history?limit=${limit}`,
  );

// ── Per-user models ──
export const getMyModels = () => request<any>('/me/models');
export const addMyModel = (data: any) =>
  request<any>('/me/models', { method: 'POST', body: JSON.stringify(data) });
export const updateMyModel = (id: string, data: any) =>
  request<any>(`/me/models/${id}`, { method: 'PUT', body: JSON.stringify(data) });
export const deleteMyModel = (id: string) =>
  request<any>(`/me/models/${id}`, { method: 'DELETE' });
export const activateMyModel = (id: string) =>
  request<any>(`/me/models/${id}/activate`, { method: 'POST' });

// ── Legacy single-tenant routes (for admin / back-compat) ──
export const getModels = () => request<any>('/models');
export const addModel = (data: any) =>
  request<any>('/models', { method: 'POST', body: JSON.stringify(data) });
export const updateModel = (id: string, data: any) =>
  request<any>(`/models/${id}`, { method: 'PUT', body: JSON.stringify(data) });
export const deleteModel = (id: string) =>
  request<any>(`/models/${id}`, { method: 'DELETE' });
export const activateModel = (id: string) =>
  request<any>(`/models/${id}/activate`, { method: 'POST' });

export const getTasks = () => request<any>('/tasks');
export const addTask = (data: any) =>
  request<any>('/tasks', { method: 'POST', body: JSON.stringify(data) });
export const updateTask = (id: string, data: any) =>
  request<any>(`/tasks/${id}`, { method: 'PUT', body: JSON.stringify(data) });
export const deleteTask = (id: string) =>
  request<any>(`/tasks/${id}`, { method: 'DELETE' });

export const getMcp = () => request<any>('/mcp');
export const addMcpServer = (data: any) =>
  request<any>('/mcp', { method: 'POST', body: JSON.stringify(data) });
export const deleteMcpServer = (id: string) =>
  request<any>(`/mcp/${id}`, { method: 'DELETE' });
export const searchMcpServers = (q: string) =>
  request<any>(`/mcp/search?q=${encodeURIComponent(q)}`);

export const getSkills = () => request<any>('/skills');
export const deleteSkill = (name: string) =>
  request<any>(`/skills/${name}`, { method: 'DELETE' });
export const installSkillNpm = (packageName: string) =>
  request<any>('/skills/install-npm', { method: 'POST', body: JSON.stringify({ packageName }) });
export const installSkillGithub = (repoUrl: string) =>
  request<any>('/skills/install-github', { method: 'POST', body: JSON.stringify({ repoUrl }) });
export const loadSkillsDir = () =>
  request<any>('/skills/load-dir', { method: 'POST' });

export const getStatus = () => request<any>('/status');
export const testMessage = (text: string, conversationId?: string) =>
  request<any>('/status/test-message', {
    method: 'POST',
    body: JSON.stringify({ text, conversationId }),
  });
