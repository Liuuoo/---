import { useEffect, useRef, useState, useCallback } from 'react'

type WsStatus = 'connecting' | 'open' | 'closed' | 'error'

export function useWebSocket<T = unknown>(path: string) {
  const [data, setData] = useState<T | null>(null)
  const [status, setStatus] = useState<WsStatus>('connecting')
  const wsRef = useRef<WebSocket | null>(null)
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const connect = useCallback(() => {
    const url = `ws://${window.location.hostname}:8000${path}`
    const ws = new WebSocket(url)
    wsRef.current = ws

    ws.onopen = () => setStatus('open')
    ws.onmessage = (e) => {
      try {
        setData(JSON.parse(e.data) as T)
      } catch {
        // ignore malformed frames
      }
    }
    ws.onerror = () => setStatus('error')
    ws.onclose = () => {
      setStatus('closed')
      retryRef.current = setTimeout(connect, 2000)
    }
  }, [path])

  useEffect(() => {
    connect()
    return () => {
      if (retryRef.current) clearTimeout(retryRef.current)
      wsRef.current?.close()
    }
  }, [connect])

  return { data, status }
}
