import asyncio
import random
import time
from dataclasses import dataclass, field, asdict
from typing import Optional


@dataclass
class SubmarinePacket:
    sub_id: str
    timestamp: float
    depth_m: float          # 深度 (m)
    speed_kn: float         # 速度 (节)
    heading_deg: float      # 航向 (度)
    battery_pct: float      # 电量 (%)
    sonar_contacts: int     # 声呐接触数
    hull_pressure_bar: float
    emergency: bool         # L0 紧急标志
    mission_priority: int   # 1-10, 影响 L1/L2 分流
    raw_payload: str        # 模拟原始数据摘要

    def to_dict(self) -> dict:
        return asdict(self)


_SUB_IDS = [f"SUB-{i:03d}" for i in range(1, 17)]


def _generate_packet(sub_id: str, force_emergency: bool = False) -> SubmarinePacket:
    emergency = force_emergency or (random.random() < 0.04)
    depth = random.uniform(50, 800)
    speed = random.uniform(0, 35)
    heading = random.uniform(0, 360)
    battery = random.uniform(5, 100)
    sonar = random.randint(0, 12)
    pressure = round(depth * 0.1 + random.uniform(-0.5, 0.5), 2)
    priority = random.randint(7, 10) if emergency else random.randint(1, 9)

    payload = (
        f"DEP={depth:.1f}m SPD={speed:.1f}kn HDG={heading:.0f}° "
        f"BAT={battery:.0f}% SNR={sonar} PRS={pressure}bar PRI={priority}"
    )

    return SubmarinePacket(
        sub_id=sub_id,
        timestamp=time.time(),
        depth_m=round(depth, 2),
        speed_kn=round(speed, 2),
        heading_deg=round(heading, 1),
        battery_pct=round(battery, 1),
        sonar_contacts=sonar,
        hull_pressure_bar=pressure,
        emergency=emergency,
        mission_priority=priority,
        raw_payload=payload,
    )


async def packet_stream(interval: float = 0.4):
    """持续产出潜艇数据包的异步生成器"""
    tick = 0
    while True:
        sub_id = random.choice(_SUB_IDS)
        # 每 50 tick 强制注入一次紧急事件，保证演示效果
        force_emg = (tick % 50 == 0) and tick > 0
        packet = _generate_packet(sub_id, force_emergency=force_emg)
        yield packet
        tick += 1
        await asyncio.sleep(interval)
