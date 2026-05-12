import { useEffect, useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import * as api from '../lib/api';

export default function AccountsPage() {
  const [accounts, setAccounts] = useState<api.WeChatAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [, setSessionId] = useState<string | null>(null);
  const [status, setStatus] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function refresh() {
    try {
      const r = await api.listAccounts();
      setAccounts(r.accounts);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  async function startQrLogin() {
    setError(null);
    setQrUrl(null);
    setStatus('请求二维码…');
    setAdding(true);
    try {
      const r = await api.startWeChatLogin();
      setSessionId(r.sessionId);
      pollRef.current = setInterval(async () => {
        try {
          const s = await api.pollWeChatLogin(r.sessionId);
          if (s.state === 'pending') {
            if (s.qrUrl && !qrUrl) {
              setQrUrl(s.qrUrl);
              setStatus('请使用微信扫码 → 完成登录');
            }
          } else if (s.state === 'success') {
            clearPoll();
            setQrUrl(null);
            setStatus(`✅ 已绑定账号 ${s.accountId}`);
            setAdding(false);
            await refresh();
          } else if (s.state === 'error') {
            clearPoll();
            setError(s.error ?? '登录失败');
            setStatus('');
            setAdding(false);
          }
        } catch (err: any) {
          clearPoll();
          setError(err.message);
          setAdding(false);
        }
      }, 1500);
    } catch (err: any) {
      setError(err.message);
      setAdding(false);
    }
  }

  function clearPoll() {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }

  function cancelAdd() {
    clearPoll();
    setQrUrl(null);
    setStatus('');
    setSessionId(null);
    setAdding(false);
  }

  async function setAlias(accountId: string) {
    const alias = prompt('新的备注名：');
    if (alias === null) return;
    await api.setAccountAlias(accountId, alias);
    refresh();
  }

  async function pause(accountId: string) {
    await api.pauseAccount(accountId);
    refresh();
  }

  async function resume(accountId: string) {
    await api.resumeAccount(accountId);
    refresh();
  }

  async function remove(accountId: string) {
    if (!confirm('确认移除这个微信号？关联的会话历史会保留，但 bot 不再收消息。')) return;
    await api.deleteAccount(accountId);
    refresh();
  }

  if (loading) return <div className="text-gray-500">加载中…</div>;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">我的微信号</h1>
          <p className="text-sm text-gray-500 mt-1">每个用户可以挂多个微信号；同一号也可由本人重新扫码恢复</p>
        </div>
        {!adding && (
          <button
            onClick={startQrLogin}
            className="bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg px-4 py-2"
          >
            + 添加微信号
          </button>
        )}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-100 text-red-700 rounded-lg p-3 mb-4 text-sm">{error}</div>
      )}

      {adding && (
        <div className="bg-white border border-gray-200 rounded-xl p-6 mb-6 flex flex-col items-center">
          {qrUrl ? (
            <>
              <QRCodeSVG value={qrUrl} size={220} />
              <p className="text-sm text-gray-600 mt-4">{status}</p>
            </>
          ) : (
            <p className="text-gray-500">{status || '准备二维码…'}</p>
          )}
          <button
            onClick={cancelAdd}
            className="mt-4 text-sm text-gray-500 hover:text-gray-700"
          >
            取消
          </button>
        </div>
      )}

      {accounts.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-xl p-8 text-center text-gray-500">
          还没有微信号。点击右上角"添加微信号"开始扫码登录。
        </div>
      ) : (
        <div className="grid gap-3">
          {accounts.map((a) => (
            <div key={a.accountId} className="bg-white border border-gray-200 rounded-xl p-4 flex items-center justify-between">
              <div>
                <div className="font-medium text-gray-800">
                  {a.alias || a.accountId}
                </div>
                <div className="text-xs text-gray-500 mt-1">
                  ID: {a.accountId} · 状态:{' '}
                  <span className={
                    a.running ? 'text-green-600' :
                    a.status === 'pending' ? 'text-yellow-600' :
                    'text-gray-500'
                  }>
                    {a.running ? '运行中' : a.status === 'pending' ? '待扫码' : '已停止'}
                  </span>
                  {a.lastSeenAt ? ` · 最近活动: ${new Date(a.lastSeenAt).toLocaleString()}` : ''}
                </div>
              </div>
              <div className="flex gap-2">
                <button onClick={() => setAlias(a.accountId)} className="text-sm text-gray-600 hover:text-gray-800 px-2">改名</button>
                {a.running
                  ? <button onClick={() => pause(a.accountId)} className="text-sm text-gray-600 hover:text-gray-800 px-2">暂停</button>
                  : <button onClick={() => resume(a.accountId)} className="text-sm text-blue-600 hover:text-blue-800 px-2">启动</button>}
                <button onClick={() => remove(a.accountId)} className="text-sm text-red-600 hover:text-red-800 px-2">移除</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
