import { useEffect, useState } from 'react';
import { getTasks, addTask, deleteTask, updateTask } from '../lib/api';
import { Plus, Trash2, Play, Pause } from 'lucide-react';

interface TaskForm {
  name: string;
  type: string;
  cron: string;
  enabled: boolean;
  config: string;
}

const emptyForm: TaskForm = {
  name: '',
  type: 'report',
  cron: '0 9 * * *',
  enabled: true,
  config: '{"topic": "AI industry news"}',
};

export default function TasksPage() {
  const [data, setData] = useState<any>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<TaskForm>(emptyForm);
  const [error, setError] = useState('');

  const load = () => getTasks().then(setData).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  const handleAdd = async () => {
    try {
      const parsed = JSON.parse(form.config);
      await addTask({ ...form, config: parsed });
      setForm(emptyForm);
      setShowForm(false);
      load();
    } catch (e: any) {
      setError(e.message);
    }
  };

  const handleToggle = async (id: string, enabled: boolean) => {
    await updateTask(id, { enabled: !enabled });
    load();
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this task?')) return;
    await deleteTask(id);
    load();
  };

  if (!data) return <div className="text-gray-400">Loading...</div>;

  return (
    <div className="max-w-4xl">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-gray-800">Scheduled Tasks</h2>
        <button
          onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm"
        >
          <Plus className="w-4 h-4" /> Add Task
        </button>
      </div>

      {error && <div className="text-red-500 mb-4">{error}</div>}

      {showForm && (
        <div className="bg-white rounded-lg border p-4 mb-6 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <input
              placeholder="Task Name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="border rounded px-3 py-2 text-sm"
            />
            <select
              value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value })}
              className="border rounded px-3 py-2 text-sm"
            >
              <option value="report">Research Report</option>
              <option value="summary">Daily Summary</option>
              <option value="custom">Custom</option>
            </select>
            <input
              placeholder="Cron Expression (e.g. 0 9 * * *)"
              value={form.cron}
              onChange={(e) => setForm({ ...form, cron: e.target.value })}
              className="border rounded px-3 py-2 text-sm"
            />
            <label className="flex items-center gap-2 text-sm text-gray-600">
              <input
                type="checkbox"
                checked={form.enabled}
                onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
              />
              Enabled
            </label>
            <textarea
              placeholder="Config JSON"
              value={form.config}
              onChange={(e) => setForm({ ...form, config: e.target.value })}
              className="border rounded px-3 py-2 text-sm col-span-2 font-mono"
              rows={3}
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
        {data.tasks?.map((t: any) => (
          <div key={t.id} className="bg-white rounded-lg border p-4 flex items-center justify-between">
            <div>
              <div className="font-medium text-gray-800">
                {t.name}
                {t.running && (
                  <span className="ml-2 text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">Running</span>
                )}
              </div>
              <div className="text-sm text-gray-500">
                <span className="font-mono">{t.cron}</span> | Type: {t.type}
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => handleToggle(t.id, t.enabled)}
                className={`p-2 rounded ${t.enabled ? 'text-orange-600 hover:bg-orange-50' : 'text-green-600 hover:bg-green-50'}`}
                title={t.enabled ? 'Disable' : 'Enable'}
              >
                {t.enabled ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
              </button>
              <button
                onClick={() => handleDelete(t.id)}
                className="p-2 text-red-600 hover:bg-red-50 rounded"
                title="Delete"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>
        ))}
        {data.tasks?.length === 0 && (
          <div className="text-gray-400 text-center py-8">No scheduled tasks. Add one above.</div>
        )}
      </div>
    </div>
  );
}
