import { Routes, Route, NavLink, Navigate } from 'react-router-dom'
import NodeView from './pages/NodeView'
import CenterView from './pages/CenterView'
import { useApi, ModelsInfo } from './hooks/useWebSocket'

export default function App() {
  const models = useApi<ModelsInfo>('/api/models')

  return (
    <div className="min-h-screen bg-ghost-bg flex flex-col">
      <nav className="border-b border-ghost-border bg-ghost-panel px-6 py-3 flex items-center gap-8">
        <span className="text-ghost-accent font-bold text-lg tracking-widest">
          GHOST-DEEP
        </span>
        <span className="text-ghost-dim text-xs">深海幽灵 // 端边云协同调度系统</span>
        {models && (
          <div className="hidden md:flex items-center gap-4 text-xs border-l border-ghost-border pl-4">
            <span className="text-ghost-dim">
              L1 <span className="text-ghost-ok font-bold">{models.l1.model}</span>
            </span>
            <span className="text-ghost-dim">
              L2 <span className="text-ghost-accent font-bold">{models.l2.model}</span>
            </span>
          </div>
        )}
        <div className="ml-auto flex gap-1">
          <NavLink
            to="/node"
            className={({ isActive }) =>
              `px-4 py-1.5 text-xs tracking-widest border transition-colors ${
                isActive
                  ? 'border-ghost-accent text-ghost-accent bg-ghost-accent/10'
                  : 'border-ghost-border text-ghost-dim hover:border-ghost-accent/50 hover:text-ghost-text'
              }`
            }
          >
            /NODE — 边缘节点
          </NavLink>
          <NavLink
            to="/center"
            className={({ isActive }) =>
              `px-4 py-1.5 text-xs tracking-widest border transition-colors ${
                isActive
                  ? 'border-ghost-accent text-ghost-accent bg-ghost-accent/10'
                  : 'border-ghost-border text-ghost-dim hover:border-ghost-accent/50 hover:text-ghost-text'
              }`
            }
          >
            /CENTER — 超算中心
          </NavLink>
        </div>
      </nav>
      <main className="flex-1">
        <Routes>
          <Route path="/" element={<Navigate to="/center" replace />} />
          <Route path="/node" element={<NodeView />} />
          <Route path="/center" element={<CenterView />} />
        </Routes>
      </main>
    </div>
  )
}
