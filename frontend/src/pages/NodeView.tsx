import { useWebSocket, useApi, ModelsInfo } from '../hooks/useWebSocket'

interface GpuUnit {
  gpu_id: number
  load_pct: number
  vram_used_gb: number
  vram_total_gb: number
  temp_c: number
}

interface BufferState {
  active_write_db: string
  active_read_db: string
  db_a_count: number
  db_b_count: number
  flip_count: number
  last_flip_ts: number
  recent_results: Array<{
    task_id: string
    sub_id: string
    level: string
    result: string | null
    timestamp: number
  }>
}

interface NodeTelemetry {
  type: 'node_telemetry'
  ts: number
  gpus: GpuUnit[]
  avg_load: number
  overloaded: boolean
  buffer: BufferState
}

interface AlertEvent {
  type: 'alert'
  ts: number
  data: { route: string; sub_id: string; msg: string }
}

type NodeMessage = NodeTelemetry | AlertEvent

function GpuBar({ gpu }: { gpu: GpuUnit }) {
  const load = gpu.load_pct
  const color =
    load > 85 ? 'bg-ghost-danger' : load > 65 ? 'bg-ghost-warn' : 'bg-ghost-ok'

  return (
    <div className="mb-2">
      <div className="flex justify-between text-xs mb-0.5">
        <span className="text-ghost-dim">GPU-{gpu.gpu_id}</span>
        <span className={load > 85 ? 'text-ghost-danger' : 'text-ghost-text'}>
          {load.toFixed(1)}%
        </span>
        <span className="text-ghost-dim">{gpu.vram_used_gb.toFixed(1)}/{gpu.vram_total_gb}GB</span>
        <span className="text-ghost-dim">{gpu.temp_c.toFixed(0)}°C</span>
      </div>
      <div className="h-2 bg-ghost-border rounded-none overflow-hidden">
        <div
          className={`h-full transition-all duration-300 ${color}`}
          style={{ width: `${load}%` }}
        />
      </div>
    </div>
  )
}

function DbBlock({
  label,
  count,
  isWrite,
  isRead,
}: {
  label: string
  count: number
  isWrite: boolean
  isRead: boolean
}) {
  const borderColor = isWrite
    ? 'border-ghost-accent'
    : isRead
    ? 'border-ghost-ok'
    : 'border-ghost-border'
  const tagColor = isWrite ? 'text-ghost-accent' : isRead ? 'text-ghost-ok' : 'text-ghost-dim'

  return (
    <div className={`border ${borderColor} p-3 flex-1 transition-colors duration-500`}>
      <div className="text-xl font-bold text-center mb-1">DB_{label}</div>
      <div className={`text-xs text-center ${tagColor} mb-2`}>
        {isWrite ? '[ WRITE ]' : isRead ? '[ READ  ]' : '[  IDLE  ]'}
      </div>
      <div className="text-center text-2xl font-bold">{count}</div>
      <div className="text-xs text-ghost-dim text-center">tasks</div>
    </div>
  )
}

export default function NodeView() {
  const { data, status } = useWebSocket<NodeMessage>('/ws/node')
  const models = useApi<ModelsInfo>('/api/models')

  const telemetry = data?.type === 'node_telemetry' ? (data as NodeTelemetry) : null
  const alerts: string[] = []

  if (data?.type === 'alert') {
    const a = data as AlertEvent
    alerts.unshift(`[${new Date(a.ts * 1000).toISOString().slice(11, 19)}] ${a.data.route} ${a.data.sub_id}: ${a.data.msg}`)
  }

  const gpus = telemetry?.gpus ?? []
  const buf = telemetry?.buffer
  const avgLoad = telemetry?.avg_load ?? 0
  const overloaded = telemetry?.overloaded ?? false

  return (
    <div className="p-4 grid grid-cols-3 gap-4 h-[calc(100vh-52px)]">
      {/* ── 左：硬件遥测 ── */}
      <div className="border border-ghost-border bg-ghost-panel p-4 flex flex-col">
        <div className="text-xs text-ghost-dim tracking-widest mb-3 border-b border-ghost-border pb-2 flex justify-between">
          <span>HARDWARE TELEMETRY // 10× H100 SXM5</span>
          {models && (
            <span className="text-ghost-ok">
              L1: <span className="font-bold">{models.l1.model}</span>
            </span>
          )}
        </div>
        <div className="mb-3 flex items-center gap-3">
          <span className="text-xs text-ghost-dim">AVG LOAD</span>
          <span className={`text-2xl font-bold ${overloaded ? 'text-ghost-danger' : 'text-ghost-ok'}`}>
            {avgLoad.toFixed(1)}%
          </span>
          {overloaded && (
            <span className="text-xs text-ghost-danger border border-ghost-danger px-2 py-0.5 animate-pulse">
              CRITICAL
            </span>
          )}
        </div>
        <div className="flex-1 overflow-y-auto">
          {gpus.map((g) => (
            <GpuBar key={g.gpu_id} gpu={g} />
          ))}
          {gpus.length === 0 && (
            <div className="text-ghost-dim text-xs">
              {status === 'connecting' ? 'CONNECTING...' : 'NO DATA'}
            </div>
          )}
        </div>
        <div className="mt-3 pt-2 border-t border-ghost-border text-xs text-ghost-dim">
          WS {status.toUpperCase()}
        </div>
      </div>

      {/* ── 中：双缓冲池 ── */}
      <div className="border border-ghost-border bg-ghost-panel p-4 flex flex-col">
        <div className="text-xs text-ghost-dim tracking-widest mb-3 border-b border-ghost-border pb-2">
          PING-PONG BUFFER CORE // DOUBLE-BUFFER ENGINE
        </div>
        {buf ? (
          <>
            <div className="flex gap-3 mb-4">
              <DbBlock
                label="A"
                count={buf.db_a_count}
                isWrite={buf.active_write_db === 'A'}
                isRead={buf.active_read_db === 'A'}
              />
              <DbBlock
                label="B"
                count={buf.db_b_count}
                isWrite={buf.active_write_db === 'B'}
                isRead={buf.active_read_db === 'B'}
              />
            </div>
            <div className="text-xs text-ghost-dim mb-1">
              FLIP COUNT: <span className="text-ghost-accent">{buf.flip_count}</span>
            </div>
            <div className="text-xs text-ghost-dim mb-3">
              WRITE → DB_{buf.active_write_db} &nbsp;|&nbsp; READ ← DB_{buf.active_read_db}
            </div>
            <div className="text-xs text-ghost-dim tracking-widest mb-2">PROCESSED TASKS</div>
            <div className="flex-1 overflow-y-auto space-y-1">
              {buf.recent_results.map((r, i) => (
                <div key={i} className="text-xs border-l-2 border-ghost-ok pl-2 py-0.5">
                  <span className="text-ghost-dim">{r.sub_id}</span>{' '}
                  <span className="text-ghost-text">{r.result ?? 'processing...'}</span>
                </div>
              ))}
            </div>
          </>
        ) : (
          <div className="text-ghost-dim text-xs">AWAITING BUFFER DATA...</div>
        )}
      </div>

      {/* ── 右：溢出告警日志 ── */}
      <div className="border border-ghost-border bg-ghost-panel p-4 flex flex-col">
        <div className="text-xs text-ghost-dim tracking-widest mb-3 border-b border-ghost-border pb-2">
          SPILLOVER ALERT LOG // COMPUTE OVERFLOW MONITOR
        </div>
        {overloaded && (
          <div className="border border-ghost-danger bg-ghost-danger/10 p-3 mb-3 text-xs text-ghost-danger">
            [WARNING] GPU LOAD CRITICAL<br />
            Escaping tasks to Cloud Center.<br />
            AVG: {avgLoad.toFixed(1)}% / THRESHOLD: 85.0%
          </div>
        )}
        <div className="text-xs text-ghost-dim mb-2">
          THROUGHPUT: <span className="text-ghost-accent">{buf?.flip_count ?? 0} flips</span>
          &nbsp;|&nbsp;
          QUEUED: <span className="text-ghost-accent">
            {(buf?.db_a_count ?? 0) + (buf?.db_b_count ?? 0)}
          </span>
        </div>
        <div className="flex-1 overflow-y-auto space-y-1 font-mono text-xs">
          {alerts.length === 0 && (
            <div className="text-ghost-dim">MONITORING... NO ALERTS</div>
          )}
          {alerts.map((a, i) => (
            <div key={i} className="text-ghost-warn">{a}</div>
          ))}
        </div>
      </div>
    </div>
  )
}
