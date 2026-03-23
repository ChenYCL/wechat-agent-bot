import { useEffect, useState } from 'react';
import { getMcp, addMcpServer, deleteMcpServer, searchMcpServers } from '../lib/api';
import { Plus, Trash2, Plug, Search, Loader2, ExternalLink } from 'lucide-react';

interface McpForm {
  name: string;
  command: string;
  args: string;
  env: string;
  enabled: boolean;
}

const emptyForm: McpForm = { name: '', command: 'npx', args: '', env: '', enabled: true };

export default function McpPage() {
  const [data, setData] = useState<any>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<McpForm>(emptyForm);
  const [error, setError] = useState('');

  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);

  const load = () => getMcp().then(setData).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  const handleAdd = async () => {
    try {
      const args = form.args ? form.args.split(/\s+/) : [];
      let env: Record<string, string> = {};
      if (form.env.trim()) {
        try { env = JSON.parse(form.env); } catch {
          // Parse KEY=VALUE format
          for (const line of form.env.split('\n')) {
            const [k, ...v] = line.split('=');
            if (k?.trim()) env[k.trim()] = v.join('=').trim();
          }
        }
      }
      await addMcpServer({ ...form, args, env });
      setForm(emptyForm);
      setShowForm(false);
      load();
    } catch (e: any) {
      setError(e.message);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Remove this MCP server?')) return;
    await deleteMcpServer(id);
    load();
  };

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    setSearching(true);
    try {
      const res = await searchMcpServers(searchQuery.trim());
      setSearchResults(res.servers || []);
    } catch {
      setSearchResults([]);
    }
    setSearching(false);
  };

  const handleQuickAdd = (server: any) => {
    const pkg = server.packages?.[0];
    if (!pkg) return;
    const runtime = pkg.runtime || 'node';
    setForm({
      name: server.name || server.id || '',
      command: runtime === 'python' ? 'uvx' : 'npx',
      args: runtime === 'python' ? pkg.name : `-y ${pkg.name}`,
      env: (pkg.environmentVariables || []).map((e: any) => `${e.name}=`).join('\n'),
      enabled: true,
    });
    setShowForm(true);
    setSearchResults([]);
    setSearchQuery('');
  };

  if (!data) return <div className="text-gray-400">Loading...</div>;

  return (
    <div className="max-w-4xl">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-gray-800">MCP Servers</h2>
        <button onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm">
          <Plus className="w-4 h-4" /> Add Server
        </button>
      </div>

      {error && <div className="text-red-500 mb-4 text-sm">{error}</div>}

      {/* Search MCP Registry */}
      <div className="bg-white rounded-lg border mb-4">
        <div className="px-4 py-3 border-b bg-gray-50 rounded-t-lg">
          <h3 className="font-semibold text-gray-700 text-sm flex items-center gap-2">
            <Search className="w-4 h-4" /> Search MCP Registry
          </h3>
        </div>
        <div className="p-4">
          <div className="flex gap-2">
            <input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              placeholder="Search servers... (e.g. filesystem, github, slack)"
              className="flex-1 border rounded-lg px-3 py-2 text-sm" />
            <button onClick={handleSearch} disabled={searching}
              className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 text-sm">
              {searching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            </button>
          </div>
          {searchResults.length > 0 && (
            <div className="mt-3 space-y-2 max-h-60 overflow-y-auto">
              {searchResults.map((s: any, i: number) => (
                <div key={i} className="border rounded-lg p-3 flex items-center justify-between hover:bg-gray-50">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-sm text-gray-800">{s.name || s.id}</div>
                    <div className="text-xs text-gray-500 truncate">{s.description}</div>
                    {s.packages?.[0] && <div className="text-xs text-gray-400 font-mono mt-1">{s.packages[0].name}</div>}
                  </div>
                  <button onClick={() => handleQuickAdd(s)}
                    className="ml-2 px-3 py-1 bg-green-600 text-white rounded text-xs hover:bg-green-700 whitespace-nowrap">
                    + Add
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Add Form */}
      {showForm && (
        <div className="bg-white rounded-lg border p-4 mb-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <input placeholder="Server Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="border rounded px-3 py-2 text-sm" />
            <select value={form.command} onChange={(e) => setForm({ ...form, command: e.target.value })}
              className="border rounded px-3 py-2 text-sm">
              <option value="npx">npx (Node.js)</option>
              <option value="uvx">uvx (Python)</option>
              <option value="node">node</option>
              <option value="python3">python3</option>
            </select>
            <input placeholder="Arguments (e.g. -y @mcp/server-filesystem /tmp)" value={form.args}
              onChange={(e) => setForm({ ...form, args: e.target.value })}
              className="border rounded px-3 py-2 text-sm col-span-2" />
            <textarea placeholder="Environment variables (KEY=VALUE per line or JSON)" value={form.env}
              onChange={(e) => setForm({ ...form, env: e.target.value })}
              className="border rounded px-3 py-2 text-sm col-span-2 font-mono" rows={2} />
          </div>
          <div className="flex items-center justify-between">
            <label className="flex items-center gap-2 text-sm text-gray-600">
              <input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} /> Enabled
            </label>
            <div className="flex gap-2">
              <button onClick={() => { setShowForm(false); setForm(emptyForm); }} className="px-3 py-1.5 text-gray-600 border rounded text-sm">Cancel</button>
              <button onClick={handleAdd} className="px-4 py-1.5 bg-green-600 text-white rounded text-sm hover:bg-green-700">Save</button>
            </div>
          </div>
        </div>
      )}

      {/* Server List */}
      <div className="space-y-2">
        {data.servers?.map((s: any) => (
          <div key={s.id} className="bg-white rounded-lg border p-4 flex items-center justify-between">
            <div>
              <div className="font-medium text-gray-800 flex items-center gap-2">
                <Plug className="w-4 h-4 text-purple-500" />
                {s.name}
                <span className={`text-xs px-2 py-0.5 rounded-full ${s.enabled ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                  {s.enabled ? 'Active' : 'Disabled'}
                </span>
              </div>
              <div className="text-sm text-gray-500 font-mono">{s.command} {s.args?.join(' ')}</div>
            </div>
            <button onClick={() => handleDelete(s.id)} className="p-2 text-red-600 hover:bg-red-50 rounded" title="Delete">
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>

      {/* Tools */}
      {data.tools?.length > 0 && (
        <div className="bg-white rounded-lg border p-4 mt-4">
          <h3 className="font-semibold text-gray-700 mb-2 text-sm">Available Tools ({data.tools.length})</h3>
          <div className="grid grid-cols-2 gap-1.5">
            {data.tools.map((t: any) => (
              <div key={t.name} className="text-xs text-gray-600">
                <span className="font-mono text-purple-600">{t.name}</span>
                {t.description && <span className="text-gray-400"> — {t.description}</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {data.servers?.length === 0 && !showForm && (
        <div className="text-gray-400 text-center py-8 text-sm">No MCP servers. Search the registry or add one manually.</div>
      )}
    </div>
  );
}
