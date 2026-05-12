import { useEffect, useState } from 'react';
import * as api from '../lib/api';
import { Clock, Eye, Play, Pause, Trash2, RefreshCw, History as HistoryIcon } from 'lucide-react';

function fmt(ms: number | null) {
  if (!ms) return '—';
  return new Date(ms).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
}

function describe(t: api.UserTask): string {
  if (t.type === 'reminder' && t.schedule) {
    if (t.schedule.kind === 'once' && t.schedule.runAt) return `一次性 · ${fmt(t.schedule.runAt)}`;
    if (t.schedule.kind === 'cron' && t.schedule.cron) return `cron · ${t.schedule.cron}`;
  }
  if (t.type === 'watch' && t.watch) {
    const c = t.watch.condition;
    const v = c?.value !== undefined ? ` ${c.value}` : '';
    return `轮询 ${t.watch.pollCron} · ${c?.op}${v}`;
  }
  return '';
}

function shortId(id: string) {
  return id.slice(0, 8);
}

function shortConv(conv: string) {
  const idx = conv.indexOf('::');
  return idx > 0 ? conv.slice(idx + 2) : conv;
}

export default function MyTasksPage() {
  const [tasks, setTasks] = useState<api.UserTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [historyFor, setHistoryFor] = useState<api.UserTask | null>(null);
  const [history, setHistory] = useState<Array<{ value: string | null; matched: boolean; observedAt: number }>>([]);

  async function refresh() {
    try {
      const r = await api.listUserTasks();
      setTasks(r.tasks);
      setError(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { refresh(); }, []);

  async function act(id: string, fn: () => Promise<unknown>) {
    setBusyId(id);
    try {
      await fn();
      await refresh();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  async function showHistory(t: api.UserTask) {
    setHistoryFor(t);
    setHistory([]);
    try {
      const r = await api.getUserTaskHistory(t.id, 50);
      setHistory(r.observations);
    } catch (err: any) {
      setError(err.message);
    }
  }

  if (loading) return <div className="text-gray-500">加载中…</div>;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">我的任务</h1>
          <p className="text-sm text-gray-500 mt-1">在微信里用自然语言创建（"明天 8 点提醒我"），这里查看 / 编辑 / 立即触发</p>
        </div>
        <button
          onClick={refresh}
          className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 px-3 py-1.5 rounded-lg hover:bg-gray-100"
        >
          <RefreshCw className="w-4 h-4" /> 刷新
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-100 text-red-700 rounded-lg p-3 mb-4 text-sm">{error}</div>
      )}

      {tasks.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-xl p-8 text-center text-gray-500">
          还没有任务。在微信里发例如：<br />
          <code className="text-xs bg-gray-100 px-2 py-1 rounded mt-2 inline-block">/task new 每天早上 8 点提醒我喝水</code>
          <br />或直接说"<em>明天 8 点提醒我开会</em>"
        </div>
      ) : (
        <div className="grid gap-3">
          {tasks.map((t) => (
            <div key={t.id} className="bg-white border border-gray-200 rounded-xl p-4">
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    {t.type === 'reminder' ? <Clock className="w-4 h-4 text-blue-500" /> : <Eye className="w-4 h-4 text-purple-500" />}
                    <span className="font-medium text-gray-800">{t.description}</span>
                    {t.enabled ? (
                      <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">启用</span>
                    ) : (
                      <span className="text-xs bg-gray-200 text-gray-600 px-2 py-0.5 rounded-full">已暂停</span>
                    )}
                  </div>
                  <div className="text-sm text-gray-600">{describe(t)}</div>
                  <div className="text-xs text-gray-400 mt-1">
                    ID: {shortId(t.id)} · 微信会话: {shortConv(t.ownerConversationId)}
                  </div>
                  <div className="text-xs text-gray-400">
                    触发 {t.triggerCount} 次 · 上次: {fmt(t.lastTriggeredAt)}
                  </div>
                  {t.type === 'reminder' && (
                    <div className="text-xs text-gray-500 mt-1">💬 {t.message}</div>
                  )}
                  {t.type === 'watch' && t.lastSeenValue !== null && (
                    <div className="text-xs text-gray-500 mt-1">最近观察值: {t.lastSeenValue}</div>
                  )}
                </div>
                <div className="flex gap-1 ml-3">
                  {t.type === 'watch' && (
                    <button
                      onClick={() => showHistory(t)}
                      disabled={busyId === t.id}
                      className="p-2 text-gray-500 hover:text-gray-900 hover:bg-gray-50 rounded"
                      title="历史"
                    >
                      <HistoryIcon className="w-4 h-4" />
                    </button>
                  )}
                  <button
                    onClick={() => act(t.id, () => api.runUserTask(t.id))}
                    disabled={busyId === t.id}
                    className="p-2 text-blue-600 hover:text-blue-700 hover:bg-blue-50 rounded"
                    title="立即触发"
                  >
                    <Play className="w-4 h-4" />
                  </button>
                  {t.enabled ? (
                    <button
                      onClick={() => act(t.id, () => api.pauseUserTask(t.id))}
                      disabled={busyId === t.id}
                      className="p-2 text-gray-600 hover:text-gray-900 hover:bg-gray-50 rounded"
                      title="暂停"
                    >
                      <Pause className="w-4 h-4" />
                    </button>
                  ) : (
                    <button
                      onClick={() => act(t.id, () => api.resumeUserTask(t.id))}
                      disabled={busyId === t.id}
                      className="p-2 text-green-600 hover:text-green-700 hover:bg-green-50 rounded"
                      title="恢复"
                    >
                      <Play className="w-4 h-4" />
                    </button>
                  )}
                  <button
                    onClick={() => { if (confirm(`删除任务 "${t.description}"？`)) act(t.id, () => api.deleteUserTask(t.id)); }}
                    disabled={busyId === t.id}
                    className="p-2 text-red-600 hover:text-red-700 hover:bg-red-50 rounded"
                    title="删除"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {historyFor && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={() => setHistoryFor(null)}>
          <div className="bg-white rounded-xl shadow-lg p-6 w-full max-w-lg max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-bold text-gray-800 mb-1">观察历史</h2>
            <p className="text-sm text-gray-500 mb-4">{historyFor.description}</p>
            {history.length === 0 ? (
              <p className="text-sm text-gray-500">暂无记录</p>
            ) : (
              <ul className="text-sm divide-y divide-gray-100">
                {history.map((o, i) => (
                  <li key={i} className="py-2 flex justify-between items-center">
                    <span className={o.matched ? 'text-blue-600 font-medium' : 'text-gray-700'}>
                      {o.matched ? '🎯 ' : ''}{o.value ?? '(fetch failed)'}
                    </span>
                    <span className="text-xs text-gray-400">{fmt(o.observedAt)}</span>
                  </li>
                ))}
              </ul>
            )}
            <button
              onClick={() => setHistoryFor(null)}
              className="mt-6 w-full bg-gray-100 hover:bg-gray-200 rounded-lg py-2 text-sm text-gray-700"
            >
              关闭
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
