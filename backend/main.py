import asyncio
import logging
import os
from contextlib import asynccontextmanager
from fastapi import FastAPI, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

from core.spillover import spillover_monitor
from core.ping_pong_db import ping_pong_db
from core.evaluator import _l1_process, get_model_info
from core.classifier import classifier
from api.websocket import node_ws_handler, center_ws_handler, run_data_pipeline

load_dotenv()
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # 加载已有分类器权重，首次启动则现场训练并保存
    await asyncio.to_thread(classifier.load_or_train)
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


@app.get("/api/classifier")
async def classifier_report():
    """暴露分类器训练报告，供前端展示"""
    if classifier.report is None:
        return {"trained": False}
    r = classifier.report
    return {
        "trained": True,
        "device": r.device,
        "n_samples": r.n_samples,
        "epochs": r.epochs,
        "final_loss": r.final_loss,
        "accuracy": r.accuracy,
    }


@app.get("/api/models")
async def models_info():
    """暴露 L1/L2 模拟模型铭牌"""
    return get_model_info()


@app.post("/api/spike")
async def trigger_spike(duration: float = 3.0):
    """触发 GPU 负载尖峰，演示算力溢出。duration 为持续秒数（默认 3s）"""
    asyncio.create_task(spillover_monitor.spike(duration))
    return {"ok": True, "msg": f"spike triggered, duration={duration}s"}


@app.websocket("/ws/node")
async def ws_node(websocket: WebSocket):
    await node_ws_handler(websocket)


@app.websocket("/ws/center")
async def ws_center(websocket: WebSocket):
    await center_ws_handler(websocket)

