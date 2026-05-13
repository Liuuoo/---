import asyncio
import time
from collections import deque
from dataclasses import dataclass, asdict
from typing import Optional


@dataclass
class BufferedTask:
    task_id: str
    sub_id: str
    timestamp: float
    level: str          # "L1" or "L1-ESCALATED"
    payload: dict
    processed: bool = False
    result: Optional[str] = None

    def to_dict(self):
        return asdict(self)


class PingPongDB:
    """
    双缓冲实现：DB_A 和 DB_B 交替承担写入与处理角色。
    active_write_db 指向当前写入库，每隔 flip_interval 秒翻转一次。
    翻转后，旧写入库变为只读处理库，新写入库清空接收新数据。
    """

    FLIP_INTERVAL = 3.0  # 秒

    def __init__(self):
        self.db: dict[str, list[BufferedTask]] = {"A": [], "B": []}
        self.active_write_db: str = "A"
        self._lock = asyncio.Lock()
        self._flip_count: int = 0
        self._last_flip_ts: float = time.time()
        self._processing_results: deque = deque(maxlen=200)
        self._running = False

    async def start(self, process_callback):
        """启动后台翻转 + 处理协程"""
        self._running = True
        asyncio.create_task(self._flip_loop(process_callback))

    async def write(self, task: BufferedTask):
        async with self._lock:
            self.db[self.active_write_db].append(task)

    async def _flip_loop(self, process_callback):
        while self._running:
            await asyncio.sleep(self.FLIP_INTERVAL)
            await self._flip_and_process(process_callback)

    async def _flip_and_process(self, process_callback):
        async with self._lock:
            read_db = self.active_write_db
            self.active_write_db = "B" if read_db == "A" else "A"
            tasks_to_process = list(self.db[read_db])
            self.db[read_db] = []
            self._flip_count += 1
            self._last_flip_ts = time.time()

        # 在锁外处理，避免阻塞写入
        for task in tasks_to_process:
            result = await process_callback(task)
            task.processed = True
            task.result = result
            self._processing_results.appendleft(task.to_dict())

    async def get_state(self) -> dict:
        async with self._lock:
            write_db = self.active_write_db
            read_db = "B" if write_db == "A" else "A"
            return {
                "active_write_db": write_db,
                "active_read_db": read_db,
                "db_a_count": len(self.db["A"]),
                "db_b_count": len(self.db["B"]),
                "flip_count": self._flip_count,
                "last_flip_ts": self._last_flip_ts,
                "recent_results": list(self._processing_results)[:20],
            }


# 全局单例
ping_pong_db = PingPongDB()
