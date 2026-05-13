"""
独立冒烟测试：真实调用 L1/L2 两个模型各一次，打印返回，验证 key 与端点可用。

用法（项目根目录下）:
    cd backend && python -m tests.test_api_smoke
"""

from __future__ import annotations

import asyncio
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv
from openai import AsyncOpenAI

from core.prompts import (
    L1_SYSTEM_PROMPT,
    L2_SYSTEM_PROMPT,
    l1_user_prompt,
    l2_user_prompt,
)

load_dotenv()

API_KEY = os.getenv("API_KEY")
L1_MODEL = os.getenv("L1_MODEL", "deepseek-v4-flash")
L2_MODEL = os.getenv("L2_MODEL", "deepseek-v4-pro")

SAMPLE_PACKET = {
    "sub_id": "SUB-007",
    "depth_m": 420.5,
    "speed_kn": 18.2,
    "heading_deg": 273,
    "battery_pct": 34,
    "sonar_contacts": 9,
    "hull_pressure_bar": 42.1,
    "mission_priority": 8,
    "emergency": False,
    "raw_payload": "DEP=420.5m SPD=18.2kn HDG=273 BAT=34% SNR=9 PRS=42.1bar PRI=8",
}


async def smoke_l1():
    client = AsyncOpenAI(
        api_key=API_KEY,
        base_url=os.getenv("DEEPSEEK_BASE_URL", "https://www.right.codes/deepseek/v1"),
    )
    t0 = time.time()
    resp = await client.chat.completions.create(
        model=L1_MODEL,
        messages=[
            {"role": "system", "content": L1_SYSTEM_PROMPT},
            {"role": "user", "content": l1_user_prompt(SAMPLE_PACKET)},
        ],
        temperature=0.3,
        timeout=30,
    )
    dt = time.time() - t0
    content = resp.choices[0].message.content or ""
    print(f"[L1 / {L1_MODEL}]  ({dt:.2f}s)")
    print(f"  → {content.strip()}")
    print()


async def smoke_l2():
    client = AsyncOpenAI(
        api_key=API_KEY,
        base_url=os.getenv("DEEPSEEK_BASE_URL", "https://www.right.codes/deepseek/v1"),
    )
    t0 = time.time()
    resp = await client.chat.completions.create(
        model=L2_MODEL,
        messages=[
            {"role": "system", "content": L2_SYSTEM_PROMPT},
            {"role": "user", "content": l2_user_prompt(SAMPLE_PACKET, escalated=False)},
        ],
        temperature=0.3,
        timeout=30,
    )
    dt = time.time() - t0
    content = resp.choices[0].message.content or ""
    print(f"[L2 / {L2_MODEL}]  ({dt:.2f}s)")
    print(f"  → {content.strip()}")
    print()


async def list_models(label: str, base_url: str):
    """探针：列出代理上实际注册的模型名"""
    print(f"[{label}] listing models at {base_url} …")
    try:
        client = AsyncOpenAI(api_key=API_KEY, base_url=base_url, timeout=15)
        models = await client.models.list()
        ids = sorted([m.id for m in models.data])
        print(f"  {len(ids)} models: {ids}")
    except Exception as e:
        print(f"  FAILED: {type(e).__name__}: {e}")
    print()


async def main():
    print(f"=== GHOST-DEEP API SMOKE TEST ===")
    print(f"API_KEY prefix = {API_KEY[:8]}…")
    print()
    await list_models("DEEPSEEK", os.getenv("DEEPSEEK_BASE_URL", "https://www.right.codes/deepseek/v1"))
    try:
        await smoke_l1()
    except Exception as e:
        print(f"[L1] FAILED: {type(e).__name__}: {e}\n")
    try:
        await smoke_l2()
    except Exception as e:
        print(f"[L2] FAILED: {type(e).__name__}: {e}\n")


if __name__ == "__main__":
    asyncio.run(main())
