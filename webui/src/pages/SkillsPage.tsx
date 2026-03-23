import { useEffect, useState } from 'react';
import { getStatus, testMessage, getSkills, deleteSkill, installSkillNpm, installSkillGithub, loadSkillsDir } from '../lib/api';
import { Terminal, Brain, MessageSquare, RefreshCw, Send, Loader2, Trash2, Download, Github, Package, FolderOpen } from 'lucide-react';

export default function SkillsPage() {
  const [skills, setSkills] = useState<any[]>([]);
  const [error, setError] = useState('');
  const [installType, setInstallType] = useState<'npm' | 'github' | null>(null);
  const [installInput, setInstallInput] = useState('');
  const [installLoading, setInstallLoading] = useState(false);
  const [installMsg, setInstallMsg] = useState('');

  // Test message state
  const [testInput, setTestInput] = useState('');
  const [testLoading, setTestLoading] = useState(false);
  const [chatHistory, setChatHistory] = useState<Array<{ role: string; text: string }>>([]);

  const load = () => {
    getStatus().then((s) => setSkills(s.skills || [])).catch((e) => setError(e.message));
  };
  useEffect(() => { load(); }, []);

  const handleTest = async () => {
    if (!testInput.trim() || testLoading) return;
    const msg = testInput.trim();
    setTestInput('');
    setChatHistory((h) => [...h, { role: 'user', text: msg }]);
    setTestLoading(true);
    try {
      const res = await testMessage(msg);
      setChatHistory((h) => [...h, { role: 'bot', text: res.reply || '[empty]' }]);
    } catch (e: any) {
      setChatHistory((h) => [...h, { role: 'bot', text: `Error: ${e.message}` }]);
    }
    setTestLoading(false);
  };

  const handleInstall = async () => {
    if (!installInput.trim()) return;
    setInstallLoading(true);
    setInstallMsg('');
    try {
      if (installType === 'npm') {
        const res = await installSkillNpm(installInput.trim());
        setInstallMsg(`Installed: /${res.name}`);
      } else if (installType === 'github') {
        const res = await installSkillGithub(installInput.trim());
        setInstallMsg(`Loaded ${res.loaded.length} skills: ${res.loaded.map((n: string) => '/' + n).join(', ')}`);
      }
      setInstallInput('');
      load();
    } catch (e: any) {
      setInstallMsg(`Error: ${e.message}`);
    }
    setInstallLoading(false);
  };

  const handleLoadDir = async () => {
    setInstallLoading(true);
    try {
      const res = await loadSkillsDir();
      setInstallMsg(`Loaded ${res.loaded.length} skills from data/skills/`);
      load();
    } catch (e: any) {
      setInstallMsg(`Error: ${e.message}`);
    }
    setInstallLoading(false);
  };

  const handleDelete = async (name: string) => {
    if (!confirm(`Remove skill /${name}?`)) return;
    await deleteSkill(name);
    load();
  };

  if (error) return <div className="text-red-500">Error: {error}</div>;

  const ICONS: Record<string, string> = {
    help: '📋', model: '🤖', clear: '🗑️',
    remember: '💾', recall: '🔍', forget: '❌',
  };

  const categories: Record<string, { icon: any; label: string; items: any[] }> = {
    memory: { icon: Brain, label: 'Memory', items: [] },
    chat: { icon: MessageSquare, label: 'Chat', items: [] },
    system: { icon: Terminal, label: 'System', items: [] },
  };

  for (const s of skills) {
    if (['remember', 'recall', 'forget'].includes(s.name)) categories.memory.items.push(s);
    else if (['model', 'clear'].includes(s.name)) categories.chat.items.push(s);
    else categories.system.items.push(s);
  }

  return (
    <div className="max-w-4xl">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-gray-800">Skills & Test</h2>
        <button onClick={load} className="flex items-center gap-2 px-3 py-2 text-gray-600 hover:bg-gray-100 rounded-lg text-sm">
          <RefreshCw className="w-4 h-4" /> Refresh
        </button>
      </div>

      {/* Test Message Panel */}
      <div className="bg-white rounded-lg border mb-6">
        <div className="px-4 py-3 border-b bg-gray-50 rounded-t-lg">
          <h3 className="font-semibold text-gray-700 flex items-center gap-2 text-sm">
            <Send className="w-4 h-4" /> Test Message (Dry Run)
          </h3>
        </div>
        <div className="p-4">
          <div className="space-y-2 mb-3 max-h-64 overflow-y-auto">
            {chatHistory.length === 0 && <div className="text-center text-gray-300 py-6 text-sm">Try /help or any message...</div>}
            {chatHistory.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[80%] px-3 py-1.5 rounded-lg text-sm whitespace-pre-wrap ${
                  msg.role === 'user' ? 'bg-blue-500 text-white rounded-br-none' : 'bg-gray-100 text-gray-800 rounded-bl-none'
                }`}>{msg.text}</div>
              </div>
            ))}
            {testLoading && <div className="flex"><div className="bg-gray-100 px-3 py-1.5 rounded-lg rounded-bl-none"><Loader2 className="w-4 h-4 animate-spin text-gray-400" /></div></div>}
          </div>
          <div className="flex gap-2">
            <input value={testInput} onChange={(e) => setTestInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleTest()}
              placeholder="/help, /model list, or any text..." className="flex-1 border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            <button onClick={handleTest} disabled={testLoading || !testInput.trim()} className="px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm"><Send className="w-4 h-4" /></button>
          </div>
        </div>
      </div>

      {/* Install Third-Party Skills */}
      <div className="bg-white rounded-lg border mb-6">
        <div className="px-4 py-3 border-b bg-gray-50 rounded-t-lg">
          <h3 className="font-semibold text-gray-700 text-sm flex items-center gap-2">
            <Download className="w-4 h-4" /> Install Third-Party Skill
          </h3>
        </div>
        <div className="p-4">
          <div className="flex gap-2 mb-3">
            <button onClick={() => setInstallType(installType === 'npm' ? null : 'npm')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border ${installType === 'npm' ? 'bg-red-50 border-red-200 text-red-700' : 'hover:bg-gray-50'}`}>
              <Package className="w-3.5 h-3.5" /> npm Package
            </button>
            <button onClick={() => setInstallType(installType === 'github' ? null : 'github')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border ${installType === 'github' ? 'bg-purple-50 border-purple-200 text-purple-700' : 'hover:bg-gray-50'}`}>
              <Github className="w-3.5 h-3.5" /> GitHub Repo
            </button>
            <button onClick={handleLoadDir}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border hover:bg-gray-50">
              <FolderOpen className="w-3.5 h-3.5" /> Load data/skills/
            </button>
          </div>
          {installType && (
            <div className="flex gap-2">
              <input value={installInput} onChange={(e) => setInstallInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleInstall()}
                placeholder={installType === 'npm' ? 'e.g. wechat-skill-weather' : 'e.g. https://github.com/user/skill-repo'}
                className="flex-1 border rounded-lg px-3 py-2 text-sm" />
              <button onClick={handleInstall} disabled={installLoading}
                className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 text-sm">
                {installLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Install'}
              </button>
            </div>
          )}
          {installMsg && <p className={`text-xs mt-2 ${installMsg.startsWith('Error') ? 'text-red-500' : 'text-green-600'}`}>{installMsg}</p>}
        </div>
      </div>

      {/* Skill List */}
      {Object.entries(categories).map(([key, cat]) => {
        if (cat.items.length === 0) return null;
        const Icon = cat.icon;
        return (
          <div key={key} className="mb-4">
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <Icon className="w-3.5 h-3.5" /> {cat.label}
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {cat.items.map((s: any) => (
                <div key={s.name}
                  className="bg-white rounded-lg border p-3 flex items-center justify-between hover:bg-gray-50 group">
                  <div className="flex items-center gap-2 cursor-pointer flex-1 min-w-0" onClick={() => setTestInput(`/${s.name} `)}>
                    <span className="text-base">{ICONS[s.name] || '⚡'}</span>
                    <span className="font-mono text-xs text-blue-700">/{s.name}</span>
                    <span className="text-xs text-gray-400 truncate">{s.description}</span>
                  </div>
                  <button onClick={() => handleDelete(s.name)} className="opacity-0 group-hover:opacity-100 p-1 text-red-400 hover:text-red-600" title="Remove">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
