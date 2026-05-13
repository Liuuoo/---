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

load_dotenv()

_API_KEY = os.getenv("API_KEY")
_L1_MODEL = os.getenv("L1_MODEL", "gemini-3-flash-preview")
_L2_MODEL = os.getenv("L2_MODEL", "deepseek-v4-pro")

_l1_client = AsyncOpenAI(
    api_key=_API_KEY,
    base_url=os.getenv("GEMINI_BASE_URL", "https://www.right.codes/gemini"),
)
_l2_client = AsyncOpenAI(
    api_key=_API_KEY,
    base_url=os.getenv("DEEPSEEK_BASE_URL", "https://www.right.codes/deepseek/v1"),
)

# 路由统计
_stats = {"L0": 0, "L1": 0, "L1_ESCALATED": 0, "L2": 0}
_event_log: list[dict] = []
_MAX_LOG = 300


def _log(level: str, sub_id: str, msg: str):
    entry = {"ts": time.time(), "level": level, "sub_id": sub_id, "msg": msg}
    _event_log.insert(0, entry)
    if len(_event_log) > _MAX_LOG:
        _event_log.pop()


def get_stats() -> dict:
    return dict(_stats)


def get_event_log(n: int = 50) -> list[dict]:
    return _event_log[:n]


# ─── L0: 规则引擎前置拦截 ────────────────────────────────────────────────────

def _l0_check(packet: SubmarinePacket) -> Optional[str]:
    """返回 None 表示未触发 L0；返回字符串表示 L0 处置结果"""
    if packet.emergency:
        return f"[L0-CRITICAL] EMERGENCY on {packet.sub_id}: immediate local abort protocol engaged"
    if packet.battery_pct < 8.0:
        return f"[L0-CRITICAL] {packet.sub_id} BATTERY CRITICAL {packet.battery_pct:.1f}% — RTB ordered"
    if packet.hull_pressure_bar > 85.0:
        return f"[L0-CRITICAL] {packet.sub_id} HULL PRESSURE {packet.hull_pressure_bar}bar — EMERGENCY SURFACE"
    return None


# ─── L1: Gemini 边缘节点处理 ─────────────────────────────────────────────────

async def _l1_process(task: BufferedTask) -> str:
    prompt = (
        f"You are a tactical edge-node AI aboard a naval vessel. "
        f"Analyze this submarine telemetry and return a concise tactical assessment (2 sentences max):\n"
        f"{task.payload}"
    )
    try:
        resp = await _l1_client.chat.completions.create(
            model=_L1_MODEL,
            messages=[{"role": "user", "content": prompt}],
            max_tokens=120,
            timeout=15,
        )
        return f"[L1-EDGE] {resp.choices[0].message.content.strip()}"
    except Exception as e:
        return f"[L1-EDGE] FALLBACK: tactical hold — API error: {type(e).__name__}"


# ─── L2: DeepSeek 超算中心处理 ───────────────────────────────────────────────

async def _l2_process(packet: SubmarinePacket, escalated: bool = False) -> str:
    tag = "L1-ESCALATED" if escalated else "L2-STRATEGIC"
    prompt = (
        f"You are a strategic supercomputer at a naval command center. "
        f"Provide a deep strategic analysis (3 sentences) for this submarine data:\n"
        f"{packet.raw_payload}\n"
        f"Sub ID: {packet.sub_id}, Priority: {packet.mission_priority}"
    )
    try:
        resp = await _l2_client.chat.completions.create(
            model=_L2_MODEL,
            messages=[{"role": "user", "content": prompt}],
            max_tokens=200,
            timeout=30,
        )
        return f"[{tag}] {resp.choices[0].message.content.strip()}"
    except Exception as e:
        return f"[{tag}] FALLBACK: strategic hold — API error: {type(e).__name__}"


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
        return result

    # ── Step 2: 神经网络分流判断 (mission_priority >= 7 → L2) ──
    is_strategic = packet.mission_priority >= 7 or packet.sonar_contacts >= 8

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
            result["msg"] = f"[L1-QUEUED] Task {result['task_id']} written to buffer"
            _log("L1", packet.sub_id, result["msg"])
    else:
        # L2 战略任务
        _stats["L2"] += 1
        result["route"] = "L2"
        msg = await _l2_process(packet, escalated=False)
        result["msg"] = msg
        _log("L2", packet.sub_id, msg)

    return result
