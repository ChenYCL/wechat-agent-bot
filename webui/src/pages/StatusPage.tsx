import { useEffect, useState } from 'react';
import { getStatus } from '../lib/api';
import { Activity, Bot, Plug, Clock } from 'lucide-react';

export default function StatusPage() {
  const [status, setStatus] = useState<any>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    getStatus().then(setStatus).catch((e) => setError(e.message));
  }, []);

  if (error) return <div className="text-red-500">Error: {error}</div>;
  if (!status) return <div className="text-gray-400">Loading...</div>;

  return (
    <div className="max-w-4xl">
      <h2 className="text-2xl font-bold text-gray-800 mb-6">System Status</h2>

      <div className="grid grid-cols-2 gap-4 mb-8">
        <Card
          icon={<Activity className="w-5 h-5 text-green-500" />}
          title="Status"
          value={status.status}
        />
        <Card
          icon={<Bot className="w-5 h-5 text-blue-500" />}
          title="Active Model"
          value={status.activeProvider ? `${status.activeProvider.name} (${status.activeProvider.model})` : 'None'}
        />
        <Card
          icon={<Plug className="w-5 h-5 text-purple-500" />}
          title="MCP Tools"
          value={`${status.mcpTools} tools available`}
        />
        <Card
          icon={<Clock className="w-5 h-5 text-orange-500" />}
          title="Scheduled Tasks"
          value={`${status.scheduledTasks.running}/${status.scheduledTasks.total} running`}
        />
      </div>

      {status.skills?.length > 0 && (
        <div className="bg-white rounded-lg border p-4">
          <h3 className="font-semibold text-gray-700 mb-3">Available Skills</h3>
          <div className="space-y-1">
            {status.skills.map((s: any) => (
              <div key={s.name} className="text-sm text-gray-600">
                <span className="font-mono text-blue-600">/{s.name}</span> - {s.description}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Card({ icon, title, value }: { icon: React.ReactNode; title: string; value: string }) {
  return (
    <div className="bg-white rounded-lg border p-4 flex items-center gap-3">
      {icon}
      <div>
        <div className="text-sm text-gray-500">{title}</div>
        <div className="font-medium text-gray-800">{value}</div>
      </div>
    </div>
  );
}
