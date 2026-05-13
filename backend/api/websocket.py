import asyncio
import json
import time
from fastapi import WebSocket, WebSocketDisconnect
from core.evaluator import route_packet, get_stats, get_event_log
from core.spillover import spillover_monitor
from core.ping_pong_db import ping_pong_db
from core.data_generator import packet_stream


class ConnectionManager:
    def __init__(self):
        self._node_clients: list[WebSocket] = []
        self._center_clients: list[WebSocket] = []

    async def connect_node(self, ws: WebSocket):
        await ws.accept()
        self._node_clients.append(ws)

    async def connect_center(self, ws: WebSocket):
        await ws.accept()
        self._center_clients.append(ws)

    def disconnect(self, ws: WebSocket):
        self._node_clients = [c for c in self._node_clients if c != ws]
        self._center_clients = [c for c in self._center_clients if c != ws]

    async def broadcast_node(self, data: dict):
        dead = []
        for ws in self._node_clients:
            try:
                await ws.send_text(json.dumps(data))
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(ws)

    async def broadcast_center(self, data: dict):
        dead = []
        for ws in self._center_clients:
            try:
                await ws.send_text(json.dumps(data))
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(ws)


manager = ConnectionManager()


async def node_ws_handler(websocket: WebSocket):
    await manager.connect_node(websocket)
    try:
        while True:
            gpu_snapshot = await spillover_monitor.get_snapshot()
            avg_load = await spillover_monitor.avg_load()
            buffer_state = await ping_pong_db.get_state()
            payload = {
                "type": "node_telemetry",
                "ts": time.time(),
                "gpus": gpu_snapshot,
                "avg_load": round(avg_load, 2),
                "overloaded": avg_load > spillover_monitor.THRESHOLD,
                "buffer": buffer_state,
            }
            await manager.broadcast_node(payload)
            await asyncio.sleep(0.5)
    except WebSocketDisconnect:
        manager.disconnect(websocket)


async def center_ws_handler(websocket: WebSocket):
    await manager.connect_center(websocket)
    try:
        while True:
            stats = get_stats()
            log = get_event_log(60)
            payload = {
                "type": "center_telemetry",
                "ts": time.time(),
                "stats": stats,
                "log": log,
            }
            await manager.broadcast_center(payload)
            await asyncio.sleep(0.4)
    except WebSocketDisconnect:
        manager.disconnect(websocket)


async def run_data_pipeline():
    """主数据管道：持续消费数据包并路由，广播结果到两个视图"""
    async for packet in packet_stream(interval=0.4):
        result = await route_packet(packet)

        # 广播路由事件到 center 视图
        await manager.broadcast_center({
            "type": "route_event",
            "ts": time.time(),
            "data": result,
        })

        # 如果是 L1 溢出告警，也推送到 node 视图
        if result["route"] in ("L1-ESCALATED", "L0"):
            await manager.broadcast_node({
                "type": "alert",
                "ts": time.time(),
                "data": result,
            })
