import { useCallback, useEffect, useState } from 'react'
import { Routes, Route, NavLink, Navigate } from 'react-router-dom'
import NodeView from './pages/NodeView'
import CenterView from './pages/CenterView'
import { useApi, ModelsInfo } from './hooks/useWebSocket'

function useTheme() {
  const [light, setLight] = useState(() => {
    const v = localStorage.getItem('ghost-theme')
    return v === 'light' || (v !== 'dark' && window.matchMedia('(prefers-color-scheme: light)').matches)
  })

  useEffect(() => {
    const root = document.documentElement
    if (light) {
      root.classList.add('light')
    } else {
      root.classList.remove('light')
    }
    localStorage.setItem('ghost-theme', light ? 'light' : 'dark')
  }, [light])

  const toggle = useCallback(() => setLight((v) => !v), [])
  return { light, toggle }
}

export default function App() {
  const models = useApi<ModelsInfo>('/api/models')
  const { light, toggle } = useTheme()

  return (
    <div className="h-screen bg-ghost-bg flex flex-col overflow-hidden">
      <nav className="border-b border-ghost-border bg-ghost-panel px-6 py-3 flex items-center gap-4">
        <span className="text-ghost-accent font-bold text-lg tracking-widest">
          GHOST-DEEP
        </span>
        <span className="text-ghost-dim text-xs hidden sm:inline">
          深海幽灵 // 端边云协同调度系统
        </span>
        {models && (
          <div className="hidden md:flex items-center gap-3 text-xs border-l border-ghost-border pl-4">
            <span className="text-ghost-dim">
              L1 <span className="text-ghost-ok font-bold">{models.l1.model}</span>
            </span>
            <span className="text-ghost-dim">
              L2 <span className="text-ghost-accent font-bold">{models.l2.model}</span>
            </span>
          </div>
        )}

        <div className="ml-auto flex items-center gap-2">
          {/* 主题切换 */}
          <button
            onClick={toggle}
            className="px-2.5 py-1 text-xs border border-ghost-border text-ghost-dim hover:text-ghost-text hover:border-ghost-accent/50 transition-colors cursor-pointer"
            title={light ? '切换深色模式' : '切换浅色模式'}
          >
            {light ? '◈ 深色' : '◇ 浅色'}
          </button>

          <NavLink
            to="/node"
            className={({ isActive }) =>
              `px-3 py-1.5 text-xs tracking-widest border transition-colors ${
                isActive
                  ? 'border-ghost-accent text-ghost-accent bg-ghost-accent/10'
                  : 'border-ghost-border text-ghost-dim hover:border-ghost-accent/50 hover:text-ghost-text'
              }`
            }
          >
            边缘节点
          </NavLink>
          <NavLink
            to="/center"
            className={({ isActive }) =>
              `px-3 py-1.5 text-xs tracking-widest border transition-colors ${
                isActive
                  ? 'border-ghost-accent text-ghost-accent bg-ghost-accent/10'
                  : 'border-ghost-border text-ghost-dim hover:border-ghost-accent/50 hover:text-ghost-text'
              }`
            }
          >
            超算中心
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
