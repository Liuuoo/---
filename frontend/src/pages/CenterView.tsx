import { useCallback, useEffect, useState } from 'react'
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
    l2_prob?: number
    packet: {
      depth_m: number
      speed_kn: number
      battery_pct: number
      sonar_contacts: number
      mission_priority: number
      emergency: boolean
      hull_pressure_bar?: number
      raw_payload?: string
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

interface SubLogEntry {
  ts: number
  route: string
  l2_prob: number | null
  packet: {
    sub_id: string
    depth_m: number
    speed_kn: number
    heading_deg: number
    battery_pct: number
    sonar_contacts: number
    hull_pressure_bar: number
    mission_priority: number
    emergency: boolean
  }
  msg: string
}

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

function routeLabel(route: string) {
  if (route === 'L0') return '本地熔断'
  if (route === 'L1') return '边缘处理'
  if (route === 'L1-ESCALATED') return '溢出上抛'
  if (route === 'L2') return '云端超算'
  return route
}

function gridColor(route: string | undefined) {
  if (route === 'L0') return 'border-ghost-danger bg-ghost-danger/20 animate-pulse'
  if (route === 'L1-ESCALATED') return 'border-ghost-warn bg-ghost-warn/10'
  if (route === 'L2') return 'border-ghost-accent bg-ghost-accent/10'
  if (route === 'L1') return 'border-ghost-ok bg-ghost-ok/5'
  return 'border-ghost-border'
}

function gridTextColor(route: string | undefined) {
  if (route === 'L0') return 'text-ghost-danger'
  if (route === 'L1-ESCALATED') return 'text-ghost-warn'
  if (route === 'L2') return 'text-ghost-accent'
  if (route === 'L1') return 'text-ghost-ok'
  return 'text-ghost-dim'
}

// ── 潜艇日志弹窗 ──

function SubLogModal({
  subId,
  log,
  loading,
  onClose,
}: {
  subId: string
  log: SubLogEntry[] | null
  loading: boolean
  onClose: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="bg-ghost-panel border border-ghost-border max-w-2xl w-full max-h-[80vh] flex flex-col m-4"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 标题栏 */}
        <div className="border-b border-ghost-border px-4 py-3 flex justify-between items-center shrink-0">
          <div>
            <span className="text-ghost-accent font-bold text-sm tracking-widest">{subId}</span>
            <span className="text-ghost-dim text-xs ml-3">独立遥测与指令日志</span>
          </div>
          <button onClick={onClose} className="text-ghost-dim hover:text-ghost-text text-lg leading-none cursor-pointer">
            ✕
          </button>
        </div>

        {/* 日志列表 */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {loading && <div className="text-ghost-dim text-xs">加载中…</div>}
          {!loading && (!log || log.length === 0) && (
            <div className="text-ghost-dim text-xs">暂无数据 — 等待该潜艇上报遥测…</div>
          )}
          {log?.map((entry, i) => (
            <div key={i} className={`border-l-2 pl-3 py-2 text-xs ${routeBg(entry.route)}`}>
              {/* 头部：时间 + 路由 */}
              <div className="flex justify-between mb-2 text-xs">
                <span className={routeColor(entry.route).split(' ')[0]}>
                  [{routeLabel(entry.route)}]
                </span>
                <span className="text-ghost-dim">
                  {new Date(entry.ts * 1000).toLocaleTimeString('zh-CN', { hour12: false })}
                </span>
              </div>

              {/* 上行：遥测数据 */}
              <div className="text-ghost-dim mb-1.5">
                <span className="text-ghost-warn text-xs">▲ 上行遥测</span>
                <div className="grid grid-cols-3 gap-x-3 gap-y-0.5 mt-0.5">
                  <span>深度 {entry.packet.depth_m?.toFixed(0)}m</span>
                  <span>航速 {entry.packet.speed_kn?.toFixed(1)}kn</span>
                  <span>电量 {entry.packet.battery_pct?.toFixed(0)}%</span>
                  <span>声呐 ×{entry.packet.sonar_contacts}</span>
                  <span>压力 {entry.packet.hull_pressure_bar?.toFixed(1)}bar</span>
                  <span>优先级 P{entry.packet.mission_priority}</span>
                </div>
                {entry.packet.emergency && (
                  <span className="text-ghost-danger font-bold">[紧急标志]</span>
                )}
              </div>

              {/* 下行：指令 */}
              <div className="text-ghost-text leading-relaxed">
                <span className="text-ghost-ok text-xs">▼ 下行指令</span>
                <div className="mt-0.5 whitespace-pre-wrap">{entry.msg}</div>
              </div>

              {entry.l2_prob != null && (
                <div className="text-ghost-dim mt-1 text-xs">
                  MLP 分类: L2 概率={entry.l2_prob.toFixed(3)}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── 主页面 ──

export default function CenterView() {
  const { data, status } = useWebSocket<CenterMessage>('/ws/center')
  const models = useApi<ModelsInfo>('/api/models')
  const clf = useApi<ClassifierReport>('/api/classifier', 2000)
  const [subStates, setSubStates] = useState<Record<string, string>>({})
  const [stats, setStats] = useState({ L0: 0, L1: 0, L1_ESCALATED: 0, L2: 0 })
  const [eventLog, setEventLog] = useState<CenterTelemetry['log']>([])
  const [routeLog, setRouteLog] = useState<RouteEvent['data'][]>([])

  // 潜艇弹窗
  const [selectedSub, setSelectedSub] = useState<string | null>(null)
  const [subLog, setSubLog] = useState<SubLogEntry[] | null>(null)
  const [subLogLoading, setSubLogLoading] = useState(false)

  const openSubLog = useCallback(async (subId: string) => {
    setSelectedSub(subId)
    setSubLogLoading(true)
    setSubLog(null)
    try {
      const res = await fetch(`http://${window.location.hostname}:8000/api/sub/${subId}/log?n=40`)
      if (res.ok) {
        setSubLog((await res.json()) as SubLogEntry[])
      }
    } catch {
      // ignore
    }
    setSubLogLoading(false)
  }, [])

  const closeSubLog = useCallback(() => {
    setSelectedSub(null)
    setSubLog(null)
  }, [])

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
      setRouteLog((prev) => [r, ...prev].slice(0, 16))
    }
  }, [data])

  const total = stats.L0 + stats.L1 + stats.L1_ESCALATED + stats.L2 || 1
  const statusText =
    status === 'open' ? '已连接' : status === 'connecting' ? '连接中…' : status === 'error' ? '错误' : '已断开'

  return (
    <div className="p-4 grid grid-cols-3 gap-4 h-[calc(100vh-52px)]">
      {/* ── 左：潜艇集群阵列 ── */}
      <div className="border border-ghost-border bg-ghost-panel p-4 flex flex-col overflow-hidden">
        <div className="text-xs text-ghost-dim tracking-widest mb-3 border-b border-ghost-border pb-2 shrink-0 flex justify-between">
          <span>潜艇集群阵列 // 16 单元编队</span>
          <span className="text-ghost-dim">点击查看独立日志</span>
        </div>
        <div className="grid grid-cols-4 gap-2 flex-1 content-start min-h-0 overflow-hidden">
          {SUB_IDS.map((id) => {
            const route = subStates[id]
            return (
              <div
                key={id}
                onClick={() => openSubLog(id)}
                className={`border p-2 text-center transition-all duration-300 cursor-pointer hover:brightness-125 ${gridColor(route)}`}
              >
                <div className="text-xs font-bold">{id.replace('SUB-', '')}</div>
                <div className={`text-xs mt-0.5 ${gridTextColor(route)}`}>
                  {route ? routeLabel(route) : '---'}
                </div>
              </div>
            )
          })}
        </div>
        <div className="mt-3 pt-2 border-t border-ghost-border text-xs text-ghost-dim shrink-0">
          连接 {statusText} // 活跃: {Object.keys(subStates).length} 单元
        </div>
      </div>

      {/* ── 中：三级路由大脑 ── */}
      <div className="border border-ghost-border bg-ghost-panel p-4 flex flex-col overflow-hidden">
        <div className="text-xs text-ghost-dim tracking-widest mb-3 border-b border-ghost-border pb-2 flex justify-between shrink-0">
          <span>三级路由大脑 // 混合评估路由器</span>
          {clf?.trained && (
            <span className="text-ghost-accent">
              分类器: <span className="font-bold">{clf.device}</span>
              {' · 准确率='}
              <span className="font-bold">{((clf.accuracy ?? 0) * 100).toFixed(1)}%</span>
            </span>
          )}
        </div>

        {clf?.trained && (
          <div className="border border-ghost-border p-2 mb-3 text-xs bg-ghost-bg/40 shrink-0">
            <div className="flex justify-between text-ghost-dim mb-0.5">
              <span>战术 MLP // 启动时现场训练</span>
              <span>{clf.n_samples} 样本 · {clf.epochs} 轮</span>
            </div>
            <div className="flex justify-between text-ghost-text">
              <span>损失=<span className="text-ghost-ok font-bold">{clf.final_loss?.toFixed(4)}</span></span>
              <span>准确率=<span className="text-ghost-ok font-bold">{((clf.accuracy ?? 0) * 100).toFixed(2)}%</span></span>
              <span>设备=<span className="text-ghost-accent font-bold">{clf.device}</span></span>
            </div>
          </div>
        )}

        <div className="space-y-3 mb-4 shrink-0">
          {[
            { key: 'L0', label: 'L0 本地熔断', desc: '规则引擎 — 紧急事态直接拦截' },
            { key: 'L1', label: 'L1 边缘处理', desc: models ? `${models.l1.model} // 10× H100 战术推理` : '边缘战术推理' },
            { key: 'L1_ESCALATED', label: 'L1 溢出上抛', desc: '负载过载 → 上抛云端超算' },
            { key: 'L2', label: 'L2 云端超算', desc: models ? `${models.l2.model} // 战略深度分析` : '战略深度分析' },
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
                  <span className="text-ghost-dim">{count} 条 ({pct}%)</span>
                </div>
                <div className="h-1.5 bg-ghost-border">
                  <div className={`h-full ${color} transition-all duration-500`} style={{ width: `${pct}%` }} />
                </div>
                <div className="text-xs text-ghost-dim mt-0.5">{desc}</div>
              </div>
            )
          })}
        </div>

        <div className="text-xs text-ghost-dim tracking-widest mb-2 border-t border-ghost-border pt-2 shrink-0">
          实时路由流
        </div>
        <div className="flex-1 space-y-1 min-h-0 overflow-hidden">
          {routeLog.slice(0, 10).map((r, i) => (
            <div key={i} className={`border-l-2 pl-2 py-0.5 text-xs ${routeColor(r.route)}`}>
              <span className="text-ghost-dim">{r.sub_id}</span>
              {' → '}
              <span className="font-bold">{routeLabel(r.route)}</span>
              {' '}
              <span className="text-ghost-dim">[P{r.packet.mission_priority}]</span>
              {r.l2_prob != null && (
                <span className="text-ghost-dim ml-1">L2={r.l2_prob.toFixed(2)}</span>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* ── 右：超算深加工日志 ── */}
      <div className="border border-ghost-border bg-ghost-panel p-4 flex flex-col overflow-hidden">
        <div className="text-xs text-ghost-dim tracking-widest mb-3 border-b border-ghost-border pb-2 shrink-0">
          超算深加工日志 // L2 / L0 输出
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto space-y-2 pr-1">
          {eventLog
            .filter((e) => e.level === 'L2' || e.level === 'L1-ESCALATED' || e.level === 'L0')
            .map((e, i) => (
              <div key={i} className={`border p-2 text-xs ${routeBg(e.level)}`}>
                <div className="flex justify-between mb-1">
                  <span className={`font-bold ${routeColor(e.level).split(' ')[0]}`}>
                    {routeLabel(e.level)}
                  </span>
                  <span className="text-ghost-dim">{e.sub_id}</span>
                  <span className="text-ghost-dim">{new Date(e.ts * 1000).toLocaleTimeString('zh-CN', { hour12: false })}</span>
                </div>
                <div className="text-ghost-text leading-relaxed whitespace-pre-wrap">{e.msg}</div>
              </div>
            ))}
          {eventLog.length === 0 && (
            <div className="text-ghost-dim text-xs">等待深度分析输出…</div>
          )}
        </div>
      </div>

      {/* ── 潜艇日志弹窗 ── */}
      {selectedSub && (
        <SubLogModal
          subId={selectedSub}
          log={subLog}
          loading={subLogLoading}
          onClose={closeSubLog}
        />
      )}
    </div>
  )
}
