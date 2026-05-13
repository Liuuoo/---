# 深海幽灵 — 分布式调度系统

基于端边云协同与多级算力路由的潜艇集群调度系统演示项目。

## 架构概览

```
潜艇集群数据流
    │
    ▼
┌─────────────────────────────────────────┐
│         三级混合评估路由器               │
│                                         │
│  L0: 规则引擎 (紧急拦截, 纯 if-else)    │
│  L1: Gemini API (边缘节点战术处理)      │
│  L2: DeepSeek API (超算中心战略分析)    │
│                                         │
│  动态溢出: GPU>85% → L1 上抛至 L2      │
└─────────────────────────────────────────┘
    │               │
    ▼               ▼
双缓冲 DB        云端队列
(Ping-Pong)     (L2 直接处理)
```

## 快速启动

### 后端

```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

### 前端

```bash
cd frontend
npm install
npm run dev
```

访问 http://localhost:5173

- `/node` — 边缘节点监控（GPU 遥测 + 双缓冲可视化）
- `/center` — 超算中心大屏（集群阵列 + 三级路由 + 深度分析日志）

## 核心机制

**双缓冲 (Ping-Pong DB)**：DB_A 与 DB_B 每 3 秒翻转一次，写入与处理完全分离，消除锁竞争。

**动态溢出**：SpilloverMonitor 持续模拟 10 张 H100 的负载。平均负载超过 85% 时，原本路由至 L1 的任务自动上抛至 L2 云端处理。

**三级路由**：L0 纯规则引擎（零延迟），L1 调用 Gemini 边缘模型，L2 调用 DeepSeek 超算模型。
