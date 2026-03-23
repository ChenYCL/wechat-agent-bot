import { useEffect, useState } from 'react';
import { getModels, addModel, deleteModel, activateModel } from '../lib/api';
import { Plus, Trash2, Check } from 'lucide-react';

interface ModelForm {
  name: string;
  provider: string;
  model: string;
  apiKey: string;
  baseUrl: string;
  systemPrompt: string;
}

const emptyForm: ModelForm = {
  name: '',
  provider: 'openai',
  model: 'gpt-4o',
  apiKey: '',
  baseUrl: '',
  systemPrompt: '',
};

export default function ModelsPage() {
  const [data, setData] = useState<any>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<ModelForm>(emptyForm);
  const [error, setError] = useState('');

  const load = () => getModels().then(setData).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  const handleAdd = async () => {
    try {
      await addModel(form);
      setForm(emptyForm);
      setShowForm(false);
      load();
    } catch (e: any) {
      setError(e.message);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this model?')) return;
    await deleteModel(id);
    load();
  };

  const handleActivate = async (id: string) => {
    await activateModel(id);
    load();
  };

  if (!data) return <div className="text-gray-400">Loading...</div>;

  return (
    <div className="max-w-4xl">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-gray-800">AI Models</h2>
        <button
          onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm"
        >
          <Plus className="w-4 h-4" /> Add Model
        </button>
      </div>

      {error && <div className="text-red-500 mb-4">{error}</div>}

      {showForm && (
        <div className="bg-white rounded-lg border p-4 mb-6 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <input
              placeholder="Name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="border rounded px-3 py-2 text-sm"
            />
            <select
              value={form.provider}
              onChange={(e) => setForm({ ...form, provider: e.target.value })}
              className="border rounded px-3 py-2 text-sm"
            >
              {(data.availableProviders || ['openai', 'anthropic']).map((p: string) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
            <input
              placeholder="Model ID (e.g. gpt-4o)"
              value={form.model}
              onChange={(e) => setForm({ ...form, model: e.target.value })}
              className="border rounded px-3 py-2 text-sm"
            />
            <input
              placeholder="API Key"
              type="password"
              value={form.apiKey}
              onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
              className="border rounded px-3 py-2 text-sm"
            />
            <input
              placeholder="Base URL (optional, for proxy/relay)"
              value={form.baseUrl}
              onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
              className="border rounded px-3 py-2 text-sm col-span-2"
            />
            <textarea
              placeholder="System Prompt (optional)"
              value={form.systemPrompt}
              onChange={(e) => setForm({ ...form, systemPrompt: e.target.value })}
              className="border rounded px-3 py-2 text-sm col-span-2"
              rows={2}
            />
          </div>
          <button
            onClick={handleAdd}
            className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm"
          >
            Save
          </button>
        </div>
      )}

      <div className="space-y-3">
        {data.models?.map((m: any) => (
          <div key={m.id} className="bg-white rounded-lg border p-4 flex items-center justify-between">
            <div>
              <div className="font-medium text-gray-800">
                {m.name}
                {m.id === data.activeId && (
                  <span className="ml-2 text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">Active</span>
                )}
              </div>
              <div className="text-sm text-gray-500">{m.provider} / {m.model}</div>
              {m.baseUrl && <div className="text-xs text-gray-400">Proxy: {m.baseUrl}</div>}
            </div>
            <div className="flex gap-2">
              {m.id !== data.activeId && (
                <button
                  onClick={() => handleActivate(m.id)}
                  className="p-2 text-green-600 hover:bg-green-50 rounded"
                  title="Activate"
                >
                  <Check className="w-4 h-4" />
                </button>
              )}
              <button
                onClick={() => handleDelete(m.id)}
                className="p-2 text-red-600 hover:bg-red-50 rounded"
                title="Delete"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>
        ))}
        {data.models?.length === 0 && (
          <div className="text-gray-400 text-center py-8">No models configured. Add one above.</div>
        )}
      </div>
    </div>
  );
}
