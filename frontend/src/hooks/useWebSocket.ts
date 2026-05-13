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

export interface ModelInfo {
  model: string
  vendor: string
  endpoint: string
  role: string
}

export interface ModelsInfo {
  l1: ModelInfo
  l2: ModelInfo
}

export interface ClassifierReport {
  trained: boolean
  device?: string
  n_samples?: number
  epochs?: number
  final_loss?: number
  accuracy?: number
}

export function useApi<T>(path: string, pollMs = 0) {
  const [data, setData] = useState<T | null>(null)

  useEffect(() => {
    let cancelled = false
    const fetchOnce = async () => {
      try {
        const res = await fetch(`http://${window.location.hostname}:8000${path}`)
        if (!res.ok) return
        const json = (await res.json()) as T
        if (!cancelled) setData(json)
      } catch {
        // ignore
      }
    }
    fetchOnce()
    if (pollMs > 0) {
      const id = setInterval(fetchOnce, pollMs)
      return () => {
        cancelled = true
        clearInterval(id)
      }
    }
    return () => {
      cancelled = true
    }
  }, [path, pollMs])

  return data
}

