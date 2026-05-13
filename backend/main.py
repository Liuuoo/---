import asyncio
import os
from contextlib import asynccontextmanager
from fastapi import FastAPI, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

from core.spillover import spillover_monitor
from core.ping_pong_db import ping_pong_db
from core.evaluator import _l1_process
from api.websocket import node_ws_handler, center_ws_handler, run_data_pipeline

load_dotenv()


@asynccontextmanager
async def lifespan(app: FastAPI):
    # 启动硬件模拟
    await spillover_monitor.start()
    # 启动双缓冲，L1 处理回调使用 Gemini
    await ping_pong_db.start(process_callback=_l1_process)
    # 启动主数据管道
    asyncio.create_task(run_data_pipeline())
    yield


app = FastAPI(title="深海幽灵 — 分布式调度系统", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health():
    return {"status": "online", "system": "GHOST-DEEP"}


@app.websocket("/ws/node")
async def ws_node(websocket: WebSocket):
    await node_ws_handler(websocket)


@app.websocket("/ws/center")
async def ws_center(websocket: WebSocket):
    await center_ws_handler(websocket)
