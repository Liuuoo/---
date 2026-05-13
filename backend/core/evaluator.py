import asyncio
import os
import time
import uuid
from typing import Optional
from openai import AsyncOpenAI
from dotenv import load_dotenv

from core.data_generator import SubmarinePacket
from core.spillover import spillover_monitor
from core.ping_pong_db import ping_pong_db, BufferedTask
from core.classifier import classifier
from core.prompts import (
    L1_SYSTEM_PROMPT,
    L2_SYSTEM_PROMPT,
    l1_user_prompt,
    l2_user_prompt,
)

load_dotenv()

_API_KEY = os.getenv("API_KEY")
_L1_MODEL = os.getenv("L1_MODEL", "deepseek-v4-flash")
_L2_MODEL = os.getenv("L2_MODEL", "deepseek-v4-pro")
_DEEPSEEK_BASE = os.getenv("DEEPSEEK_BASE_URL", "https://www.right.codes/deepseek/v1")


def get_model_info() -> dict:
    """暴露给前端的模型铭牌信息"""
    return {
        "l1": {
            "model": _L1_MODEL,
            "vendor": "DeepSeek",
            "endpoint": _DEEPSEEK_BASE,
            "role": "EDGE TACTICAL AI",
        },
        "l2": {
            "model": _L2_MODEL,
            "vendor": "DeepSeek",
            "endpoint": _DEEPSEEK_BASE,
            "role": "CLOUD STRATEGIC AI",
        },
    }

_l1_client = AsyncOpenAI(
    api_key=_API_KEY,
    base_url=_DEEPSEEK_BASE,
)
_l2_client = AsyncOpenAI(
    api_key=_API_KEY,
    base_url=os.getenv("DEEPSEEK_BASE_URL", "https://www.right.codes/deepseek/v1"),
)

# 路由统计
_stats = {"L0": 0, "L1": 0, "L1_ESCALATED": 0, "L2": 0}
_event_log: list[dict] = []
_MAX_LOG = 300

# 每条潜艇的独立日志（遥测上行 + 指令下行）
_sub_logs: dict[str, list[dict]] = {}
_SUB_LOG_MAX = 120


def _log(level: str, sub_id: str, msg: str):
    entry = {"ts": time.time(), "level": level, "sub_id": sub_id, "msg": msg}
    _event_log.insert(0, entry)
    if len(_event_log) > _MAX_LOG:
        _event_log.pop()


def _log_sub(sub_id: str, entry: dict):
    if sub_id not in _sub_logs:
        _sub_logs[sub_id] = []
    _sub_logs[sub_id].insert(0, entry)
    if len(_sub_logs[sub_id]) > _SUB_LOG_MAX:
        _sub_logs[sub_id].pop()


def get_stats() -> dict:
    return dict(_stats)


def get_event_log(n: int = 50) -> list[dict]:
    return _event_log[:n]


def get_sub_log(sub_id: str, n: int = 40) -> list[dict]:
    """返回指定潜艇的最近 n 条遥测与指令日志"""
    return _sub_logs.get(sub_id, [])[:n]


# ─── L0: 规则引擎前置拦截 ────────────────────────────────────────────────────

def _l0_check(packet: SubmarinePacket) -> Optional[str]:
    """返回 None 表示未触发 L0；返回字符串表示 L0 处置结果"""
    if packet.emergency:
        return f"[本地熔断] {packet.sub_id} 紧急事态：立即启动本地中止协议"
    if packet.battery_pct < 8.0:
        return f"[本地熔断] {packet.sub_id} 电量严重不足 {packet.battery_pct:.1f}% — 立即返航"
    if packet.hull_pressure_bar > 85.0:
        return f"[本地熔断] {packet.sub_id} 船体压力 {packet.hull_pressure_bar}bar — 紧急上浮"
    return None


# ─── L1: Gemini 边缘节点处理 ─────────────────────────────────────────────────

async def _l1_process(task: BufferedTask) -> str:
    try:
        resp = await _l1_client.chat.completions.create(
            model=_L1_MODEL,
            messages=[
                {"role": "system", "content": L1_SYSTEM_PROMPT},
                {"role": "user", "content": l1_user_prompt(task.payload)},
            ],
            temperature=0.3,
            timeout=15,
        )
        return f"[L1-EDGE/{_L1_MODEL}] {resp.choices[0].message.content.strip()}"
    except Exception as e:
        return f"[L1-EDGE/{_L1_MODEL}] FALLBACK: tactical hold — API error: {type(e).__name__}"


# ─── L2: DeepSeek 超算中心处理 ───────────────────────────────────────────────

async def _l2_process(packet: SubmarinePacket, escalated: bool = False) -> str:
    tag = "L1-ESCALATED" if escalated else "L2-STRATEGIC"
    try:
        resp = await _l2_client.chat.completions.create(
            model=_L2_MODEL,
            messages=[
                {"role": "system", "content": L2_SYSTEM_PROMPT},
                {"role": "user", "content": l2_user_prompt(packet.to_dict(), escalated)},
            ],
            temperature=0.3,
            timeout=30,
        )
        return f"[{tag}/{_L2_MODEL}] {resp.choices[0].message.content.strip()}"
    except Exception as e:
        return f"[{tag}/{_L2_MODEL}] FALLBACK: strategic hold — API error: {type(e).__name__}"


# ─── 主路由入口 ───────────────────────────────────────────────────────────────

async def route_packet(packet: SubmarinePacket) -> dict:
    """
    三级路由主函数，返回路由结果字典供 WebSocket 广播。
    """
    result = {
        "task_id": str(uuid.uuid4())[:8],
        "sub_id": packet.sub_id,
        "timestamp": packet.timestamp,
        "route": None,
        "msg": None,
        "escalated": False,
        "packet": packet.to_dict(),
    }

    # ── Step 1: L0 规则引擎 ──
    l0_result = _l0_check(packet)
    if l0_result:
        _stats["L0"] += 1
        result["route"] = "L0"
        result["msg"] = l0_result
        _log("L0", packet.sub_id, l0_result)
        _log_sub(packet.sub_id, {"ts": time.time(), "route": "L0", "l2_prob": None, "packet": packet.to_dict(), "msg": l0_result})
        return result

    # ── Step 2: 神经网络分流判断 (启动时训练的 MLP) ──
    is_strategic, l2_prob = classifier.predict_l2(packet.to_dict())
    result["l2_prob"] = round(l2_prob, 3)

    if not is_strategic:
        # ── Step 3: 溢出检查 ──
        overloaded = await spillover_monitor.is_overloaded()
        if overloaded:
            # 算力溢出：L1 任务上抛至 L2
            _stats["L1_ESCALATED"] += 1
            result["route"] = "L1-ESCALATED"
            result["escalated"] = True
            msg = await _l2_process(packet, escalated=True)
            result["msg"] = msg
            _log("L1-ESCALATED", packet.sub_id, msg)
            _log_sub(packet.sub_id, {"ts": time.time(), "route": "L1-ESCALATED", "l2_prob": round(l2_prob, 3), "packet": packet.to_dict(), "msg": msg})
        else:
            # 正常 L1 边缘处理：写入双缓冲
            _stats["L1"] += 1
            result["route"] = "L1"
            task = BufferedTask(
                task_id=result["task_id"],
                sub_id=packet.sub_id,
                timestamp=packet.timestamp,
                level="L1",
                payload=packet.to_dict(),
            )
            await ping_pong_db.write(task)
            result["msg"] = f"[L1-已入队] 任务 {result['task_id']} 写入双缓冲"
            _log("L1", packet.sub_id, result["msg"])
            _log_sub(packet.sub_id, {"ts": time.time(), "route": "L1", "l2_prob": round(l2_prob, 3), "packet": packet.to_dict(), "msg": result["msg"]})
    else:
        # L2 战略任务
        _stats["L2"] += 1
        result["route"] = "L2"
        msg = await _l2_process(packet, escalated=False)
        result["msg"] = msg
        _log("L2", packet.sub_id, msg)
        _log_sub(packet.sub_id, {"ts": time.time(), "route": "L2", "l2_prob": round(l2_prob, 3), "packet": packet.to_dict(), "msg": msg})

    return result
