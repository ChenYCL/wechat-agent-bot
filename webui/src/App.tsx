import { Routes, Route, NavLink } from 'react-router-dom';
import { Bot, Settings, Clock, Plug, Activity, Zap, Smartphone, LogOut } from 'lucide-react';
import ModelsPage from './pages/ModelsPage';
import TasksPage from './pages/TasksPage';
import McpPage from './pages/McpPage';
import SkillsPage from './pages/SkillsPage';
import StatusPage from './pages/StatusPage';
import LoginPage from './pages/LoginPage';
import AccountsPage from './pages/AccountsPage';
import { AuthProvider, useAuth } from './lib/auth-context';

const navItems = [
  { to: '/', icon: Activity, label: 'Status' },
  { to: '/accounts', icon: Smartphone, label: '微信号' },
  { to: '/models', icon: Bot, label: 'Models' },
  { to: '/skills', icon: Zap, label: 'Skills' },
  { to: '/tasks', icon: Clock, label: 'Tasks' },
  { to: '/mcp', icon: Plug, label: 'MCP' },
];

function Shell() {
  const { user, logout } = useAuth();
  return (
    <div className="flex h-screen">
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
        <div className="mt-auto pt-4 border-t border-gray-100">
          <div className="text-xs text-gray-500 mb-2 px-3">
            {user?.username}{user?.isAdmin ? ' (admin)' : ''}
          </div>
          <button
            onClick={() => logout()}
            className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-gray-600 hover:bg-gray-50 w-full"
          >
            <LogOut className="w-4 h-4" />
            退出登录
          </button>
        </div>
      </nav>
      <main className="flex-1 overflow-y-auto p-6">
        <Routes>
          <Route path="/" element={<StatusPage />} />
          <Route path="/accounts" element={<AccountsPage />} />
          <Route path="/models" element={<ModelsPage />} />
          <Route path="/skills" element={<SkillsPage />} />
          <Route path="/tasks" element={<TasksPage />} />
          <Route path="/mcp" element={<McpPage />} />
        </Routes>
      </main>
    </div>
  );
}

function AuthGate() {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-gray-500">
        加载中…
      </div>
    );
  }
  return user ? <Shell /> : <LoginPage />;
}

export default function App() {
  return (
    <AuthProvider>
      <AuthGate />
    </AuthProvider>
  );
}
