import asyncio
import random
import time
from dataclasses import dataclass, asdict


@dataclass
class GpuUnit:
    gpu_id: int
    load_pct: float
    vram_used_gb: float
    vram_total_gb: float = 80.0  # H100 80GB
    temp_c: float = 0.0

    def to_dict(self):
        return asdict(self)


class SpilloverMonitor:
    """模拟 10 张 H100 的实时负载，提供溢出判断"""

    THRESHOLD = 85.0
    GPU_COUNT = 10

    def __init__(self):
        self._gpus: list[GpuUnit] = [
            GpuUnit(
                gpu_id=i,
                load_pct=random.uniform(20, 60),
                vram_used_gb=random.uniform(10, 50),
                temp_c=random.uniform(45, 70),
            )
            for i in range(self.GPU_COUNT)
        ]
        self._lock = asyncio.Lock()
        self._running = False

    async def start(self):
        self._running = True
        asyncio.create_task(self._fluctuate())

    async def _fluctuate(self):
        """每 0.5s 随机漂移各 GPU 负载，模拟真实波动"""
        while self._running:
            async with self._lock:
                for gpu in self._gpus:
                    delta = random.uniform(-4, 4)
                    gpu.load_pct = max(5.0, min(99.0, gpu.load_pct + delta))
                    gpu.vram_used_gb = gpu.vram_total_gb * (gpu.load_pct / 100) * random.uniform(0.8, 1.0)
                    gpu.temp_c = 40 + gpu.load_pct * 0.55 + random.uniform(-2, 2)
            await asyncio.sleep(0.5)

    async def get_snapshot(self) -> list[dict]:
        async with self._lock:
            return [g.to_dict() for g in self._gpus]

    async def avg_load(self) -> float:
        async with self._lock:
            return sum(g.load_pct for g in self._gpus) / self.GPU_COUNT

    async def is_overloaded(self) -> bool:
        return await self.avg_load() > self.THRESHOLD

    async def spike(self, duration: float = 3.0):
        """触发一次负载尖峰，用于演示溢出"""
        async with self._lock:
            for gpu in self._gpus:
                gpu.load_pct = min(99.0, gpu.load_pct + random.uniform(20, 35))
        await asyncio.sleep(duration)


# 全局单例
spillover_monitor = SpilloverMonitor()
