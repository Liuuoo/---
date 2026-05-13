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

启动时会在 GPU（无卡则 CPU）上现场训练 L1/L2 分流分类器，看到日志：
`Classifier trained: loss=... acc=... device=cuda` 即代表训练完成。

可选 — 验证 L1/L2 模型 API 真实可用：

```bash
cd backend
python -m tests.test_api_smoke
```

### 前端

```bash
cd frontend
npm install
npm run dev
```

访问 http://localhost:5173

- `/node` — 边缘节点监控（GPU 遥测 + 双缓冲 + L1 模型铭牌）
- `/center` — 超算中心大屏（集群阵列 + 三级路由 + 分类器训练报告 + L2 模型铭牌）

## 模型与提示词

L1 / L2 模型在 `backend/.env` 配置（默认 `gemini-3-pro-preview` / `deepseek-v4-flash`），
对应 system 与 user 提示词集中存放在 `backend/core/prompts.py`，便于答辩前临场调优。
当前使用的模型铭牌会在前端导航栏与各视图标题处实时显示。

## 核心机制

**启动期分类器训练**：服务启动时，`core/classifier.py` 用 numpy 合成 4000 条历史遥测样本，通过 PyTorch（GPU 优先，无卡自动回退 CPU）训练一个 2 层 MLP，作为 L1/L2 智能分流的判定模型。训练报告通过 `GET /api/classifier` 暴露。

**双缓冲 (Ping-Pong DB)**：DB_A 与 DB_B 每 3 秒翻转一次，写入与处理完全分离，消除锁竞争。

**动态溢出**：SpilloverMonitor 持续模拟 10 张 H100 的负载。平均负载超过 85% 时，原本路由至 L1 的任务自动上抛至 L2 云端处理。

**三级路由**：L0 纯规则引擎（零延迟），L1 调用 Gemini 边缘模型，L2 调用 DeepSeek 超算模型。L1/L2 的分流由启动时训练的分类器实时判定。
