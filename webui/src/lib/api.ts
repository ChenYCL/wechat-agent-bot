const BASE = '/api';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return res.json();
}

// Models
export const getModels = () => request<any>('/models');
export const addModel = (data: any) =>
  request<any>('/models', { method: 'POST', body: JSON.stringify(data) });
export const updateModel = (id: string, data: any) =>
  request<any>(`/models/${id}`, { method: 'PUT', body: JSON.stringify(data) });
export const deleteModel = (id: string) =>
  request<any>(`/models/${id}`, { method: 'DELETE' });
export const activateModel = (id: string) =>
  request<any>(`/models/${id}/activate`, { method: 'POST' });

// Tasks
export const getTasks = () => request<any>('/tasks');
export const addTask = (data: any) =>
  request<any>('/tasks', { method: 'POST', body: JSON.stringify(data) });
export const updateTask = (id: string, data: any) =>
  request<any>(`/tasks/${id}`, { method: 'PUT', body: JSON.stringify(data) });
export const deleteTask = (id: string) =>
  request<any>(`/tasks/${id}`, { method: 'DELETE' });

// MCP
export const getMcp = () => request<any>('/mcp');
export const addMcpServer = (data: any) =>
  request<any>('/mcp', { method: 'POST', body: JSON.stringify(data) });
export const deleteMcpServer = (id: string) =>
  request<any>(`/mcp/${id}`, { method: 'DELETE' });
export const searchMcpServers = (q: string) =>
  request<any>(`/mcp/search?q=${encodeURIComponent(q)}`);

// Skills
export const getSkills = () => request<any>('/skills');
export const deleteSkill = (name: string) =>
  request<any>(`/skills/${name}`, { method: 'DELETE' });
export const installSkillNpm = (packageName: string) =>
  request<any>('/skills/install-npm', { method: 'POST', body: JSON.stringify({ packageName }) });
export const installSkillGithub = (repoUrl: string) =>
  request<any>('/skills/install-github', { method: 'POST', body: JSON.stringify({ repoUrl }) });
export const loadSkillsDir = () =>
  request<any>('/skills/load-dir', { method: 'POST' });

// Status
export const getStatus = () => request<any>('/status');

// Test message
export const testMessage = (text: string, conversationId?: string) =>
  request<any>('/status/test-message', {
    method: 'POST',
    body: JSON.stringify({ text, conversationId }),
  });
