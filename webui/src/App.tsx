import { Routes, Route, NavLink } from 'react-router-dom';
import { Bot, Settings, Clock, Plug, Activity, Zap } from 'lucide-react';
import ModelsPage from './pages/ModelsPage';
import TasksPage from './pages/TasksPage';
import McpPage from './pages/McpPage';
import SkillsPage from './pages/SkillsPage';
import StatusPage from './pages/StatusPage';

const navItems = [
  { to: '/', icon: Activity, label: 'Status' },
  { to: '/models', icon: Bot, label: 'Models' },
  { to: '/skills', icon: Zap, label: 'Skills' },
  { to: '/tasks', icon: Clock, label: 'Tasks' },
  { to: '/mcp', icon: Plug, label: 'MCP' },
];

export default function App() {
  return (
    <div className="flex h-screen">
      {/* Sidebar */}
      <nav className="w-56 bg-white border-r border-gray-200 p-4 flex flex-col gap-1">
        <h1 className="text-lg font-bold text-gray-800 mb-6 flex items-center gap-2">
          <Settings className="w-5 h-5" />
          WeChat Agent
        </h1>
        {navItems.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                isActive
                  ? 'bg-blue-50 text-blue-700 font-medium'
                  : 'text-gray-600 hover:bg-gray-50'
              }`
            }
          >
            <Icon className="w-4 h-4" />
            {label}
          </NavLink>
        ))}
      </nav>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto p-6">
        <Routes>
          <Route path="/" element={<StatusPage />} />
          <Route path="/models" element={<ModelsPage />} />
          <Route path="/skills" element={<SkillsPage />} />
          <Route path="/tasks" element={<TasksPage />} />
          <Route path="/mcp" element={<McpPage />} />
        </Routes>
      </main>
    </div>
  );
}
