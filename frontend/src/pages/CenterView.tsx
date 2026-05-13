import { useEffect, useRef, useState } from 'react'
import { useWebSocket, useApi, ModelsInfo, ClassifierReport } from '../hooks/useWebSocket'

interface RouteEvent {
  type: 'route_event'
  ts: number
  data: {
    task_id: string
    sub_id: string
    route: string
    msg: string
    escalated: boolean
    packet: {
      depth_m: number
      speed_kn: number
      battery_pct: number
      sonar_contacts: number
      mission_priority: number
      emergency: boolean
    }
  }
}

interface CenterTelemetry {
  type: 'center_telemetry'
  ts: number
  stats: { L0: number; L1: number; L1_ESCALATED: number; L2: number }
  log: Array<{ ts: number; level: string; sub_id: string; msg: string }>
}

type CenterMessage = RouteEvent | CenterTelemetry

const SUB_IDS = Array.from({ length: 16 }, (_, i) => `SUB-${String(i + 1).padStart(3, '0')}`)

function routeColor(route: string) {
  if (route === 'L0') return 'text-ghost-danger border-ghost-danger'
  if (route === 'L1-ESCALATED') return 'text-ghost-warn border-ghost-warn'
  if (route === 'L2') return 'text-ghost-accent border-ghost-accent'
  return 'text-ghost-ok border-ghost-ok'
}

function routeBg(route: string) {
  if (route === 'L0') return 'bg-ghost-danger/20 border-ghost-danger'
  if (route === 'L1-ESCALATED') return 'bg-ghost-warn/10 border-ghost-warn'
  if (route === 'L2') return 'bg-ghost-accent/10 border-ghost-accent'
  return 'bg-ghost-ok/10 border-ghost-ok'
}

export default function CenterView() {
  const { data, status } = useWebSocket<CenterMessage>('/ws/center')
  const models = useApi<ModelsInfo>('/api/models')
  const clf = useApi<ClassifierReport>('/api/classifier', 2000)
  const [subStates, setSubStates] = useState<Record<string, string>>({})
  const [stats, setStats] = useState({ L0: 0, L1: 0, L1_ESCALATED: 0, L2: 0 })
  const [eventLog, setEventLog] = useState<CenterTelemetry['log']>([])
  const [routeLog, setRouteLog] = useState<RouteEvent['data'][]>([])
  const logRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!data) return
    if (data.type === 'center_telemetry') {
      const t = data as CenterTelemetry
      setStats(t.stats)
      setEventLog(t.log)
    }
    if (data.type === 'route_event') {
      const r = (data as RouteEvent).data
      setSubStates((prev) => ({ ...prev, [r.sub_id]: r.route }))
      setRouteLog((prev) => [r, ...prev].slice(0, 80))
    }
  }, [data])

  const total = stats.L0 + stats.L1 + stats.L1_ESCALATED + stats.L2 || 1

  return (
    <div className="p-4 grid grid-cols-3 gap-4 h-[calc(100vh-52px)]">
      {/* ── 左：潜艇集群阵列 ── */}
      <div className="border border-ghost-border bg-ghost-panel p-4 flex flex-col">
        <div className="text-xs text-ghost-dim tracking-widest mb-3 border-b border-ghost-border pb-2">
          SWARM MAP // 16-UNIT SUBMARINE CLUSTER
        </div>
        <div className="grid grid-cols-4 gap-2 flex-1 content-start">
          {SUB_IDS.map((id) => {
            const route = subStates[id]
            const isL0 = route === 'L0'
            const isEsc = route === 'L1-ESCALATED'
            return (
              <div
                key={id}
                className={`border p-2 text-center transition-all duration-300 ${
                  isL0
                    ? 'border-ghost-danger bg-ghost-danger/20 animate-pulse'
                    : isEsc
                    ? 'border-ghost-warn bg-ghost-warn/10'
                    : route
                    ? 'border-ghost-ok/50 bg-ghost-ok/5'
                    : 'border-ghost-border'
                }`}
              >
                <div className="text-xs font-bold">{id.replace('SUB-', '')}</div>
                <div className={`text-xs mt-0.5 ${isL0 ? 'text-ghost-danger' : isEsc ? 'text-ghost-warn' : 'text-ghost-dim'}`}>
                  {route ?? '---'}
                </div>
              </div>
            )
          })}
        </div>
        <div className="mt-3 pt-2 border-t border-ghost-border text-xs text-ghost-dim">
          WS {status.toUpperCase()} // ACTIVE: {Object.keys(subStates).length} UNITS
        </div>
      </div>

      {/* ── 中：三级路由大脑 ── */}
      <div className="border border-ghost-border bg-ghost-panel p-4 flex flex-col">
        <div className="text-xs text-ghost-dim tracking-widest mb-3 border-b border-ghost-border pb-2 flex justify-between">
          <span>GLOBAL ROUTER // THREE-TIER HYBRID EVALUATOR</span>
          {clf?.trained && (
            <span className="text-ghost-accent">
              MLP: <span className="font-bold">{clf.device}</span>
              {' · acc='}
              <span className="font-bold">{((clf.accuracy ?? 0) * 100).toFixed(1)}%</span>
            </span>
          )}
        </div>

        {/* 分类器训练铭牌 */}
        {clf?.trained && (
          <div className="border border-ghost-border p-2 mb-3 text-xs bg-ghost-bg/40">
            <div className="flex justify-between text-ghost-dim mb-0.5">
              <span>TACTICAL MLP // BOOT-TRAINED</span>
              <span>{clf.n_samples} samples · {clf.epochs} epochs</span>
            </div>
            <div className="flex justify-between text-ghost-text">
              <span>
                loss=<span className="text-ghost-ok font-bold">{clf.final_loss?.toFixed(4)}</span>
              </span>
              <span>
                acc=<span className="text-ghost-ok font-bold">{((clf.accuracy ?? 0) * 100).toFixed(2)}%</span>
              </span>
              <span>
                device=<span className="text-ghost-accent font-bold">{clf.device}</span>
              </span>
            </div>
          </div>
        )}

        {/* 路由统计 */}
        <div className="space-y-3 mb-4">
          {[
            { key: 'L0', label: 'L0 LOCAL FUSE', desc: 'Rule engine — emergency intercept' },
            { key: 'L1', label: 'L1 EDGE NODE', desc: models ? `${models.l1.model} // 10× H100 tactical AI` : 'Gemini // 10× H100 tactical AI' },
            { key: 'L1_ESCALATED', label: 'L1 ESCALATED', desc: 'Spillover → cloud center' },
            { key: 'L2', label: 'L2 SUPERCOMPUTER', desc: models ? `${models.l2.model} // strategic analysis` : 'DeepSeek // strategic analysis' },
          ].map(({ key, label, desc }) => {
            const count = stats[key as keyof typeof stats]
            const pct = Math.round((count / total) * 100)
            const color =
              key === 'L0' ? 'bg-ghost-danger' :
              key === 'L1_ESCALATED' ? 'bg-ghost-warn' :
              key === 'L2' ? 'bg-ghost-accent' : 'bg-ghost-ok'
            const textColor =
              key === 'L0' ? 'text-ghost-danger' :
              key === 'L1_ESCALATED' ? 'text-ghost-warn' :
              key === 'L2' ? 'text-ghost-accent' : 'text-ghost-ok'
            return (
              <div key={key}>
                <div className="flex justify-between text-xs mb-1">
                  <span className={`font-bold ${textColor}`}>{label}</span>
                  <span className="text-ghost-dim">{count} ({pct}%)</span>
                </div>
                <div className="h-1.5 bg-ghost-border">
                  <div className={`h-full ${color} transition-all duration-500`} style={{ width: `${pct}%` }} />
                </div>
                <div className="text-xs text-ghost-dim mt-0.5">{desc}</div>
              </div>
            )
          })}
        </div>

        {/* 最新路由事件流 */}
        <div className="text-xs text-ghost-dim tracking-widest mb-2 border-t border-ghost-border pt-2">
          LIVE ROUTING STREAM
        </div>
        <div className="flex-1 overflow-y-auto space-y-1" ref={logRef}>
          {routeLog.map((r, i) => (
            <div key={i} className={`border-l-2 pl-2 py-0.5 text-xs ${routeColor(r.route)}`}>
              <span className="text-ghost-dim">{r.sub_id}</span>
              {' → '}
              <span className="font-bold">{r.route}</span>
              {' '}
              <span className="text-ghost-dim">[P{r.packet.mission_priority}]</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── 右：超算深加工日志 ── */}
      <div className="border border-ghost-border bg-ghost-panel p-4 flex flex-col">
        <div className="text-xs text-ghost-dim tracking-widest mb-3 border-b border-ghost-border pb-2">
          SUPERCOMPUTER DEEP ANALYSIS LOG // L2 OUTPUT
        </div>
        <div className="flex-1 overflow-y-auto space-y-2">
          {eventLog
            .filter((e) => e.level === 'L2' || e.level === 'L1-ESCALATED' || e.level === 'L0')
            .map((e, i) => (
              <div key={i} className={`border p-2 text-xs ${routeBg(e.level)}`}>
                <div className="flex justify-between mb-1">
                  <span className={`font-bold ${routeColor(e.level).split(' ')[0]}`}>{e.level}</span>
                  <span className="text-ghost-dim">{e.sub_id}</span>
                  <span className="text-ghost-dim">{new Date(e.ts * 1000).toISOString().slice(11, 19)}</span>
                </div>
                <div className="text-ghost-text leading-relaxed">{e.msg}</div>
              </div>
            ))}
          {eventLog.length === 0 && (
            <div className="text-ghost-dim text-xs">AWAITING DEEP ANALYSIS OUTPUT...</div>
          )}
        </div>
      </div>
    </div>
  )
}
