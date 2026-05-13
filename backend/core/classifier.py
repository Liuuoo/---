"""
启动时现场训练的 L1 vs L2 分流分类器。

- 用 numpy 生成模拟历史数据（潜艇遥测特征 + L2/L1 标签）
- 用 PyTorch 训练一个 2 层 MLP，GPU 优先
- 提供 predict_l2() 给评估器实时调用
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
from torch.optim import Adam

log = logging.getLogger("ghost.classifier")

DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")

# 权重持久化路径（backend/data/ 目录）
_CHECKPOINT_DIR = Path(__file__).resolve().parent.parent / "data"
_CHECKPOINT_FILE = _CHECKPOINT_DIR / "classifier.pt"

FEATURE_NAMES = (
    "depth_m",
    "speed_kn",
    "battery_pct",
    "sonar_contacts",
    "hull_pressure_bar",
    "mission_priority",
)
N_FEATURES = len(FEATURE_NAMES)


class TacticalMLP(nn.Module):
    """简易 MLP — 判定任务应当在 L1 (边缘) 还是 L2 (云端) 处理"""

    def __init__(self, in_dim: int = N_FEATURES, hidden: int = 32):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(in_dim, hidden),
            nn.ReLU(),
            nn.Linear(hidden, hidden),
            nn.ReLU(),
            nn.Linear(hidden, 2),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.net(x)


@dataclass
class TrainReport:
    device: str
    n_samples: int
    epochs: int
    final_loss: float
    accuracy: float


def _synthesize_history(n: int = 4000, seed: int = 42) -> tuple[np.ndarray, np.ndarray]:
    """
    模拟过去一段时间的潜艇遥测 + 人工规则生成的 L1/L2 标签。
    标签逻辑（合成真值）：融合多个战术维度的加权得分 + 噪声，近似真实指挥部的打标偏好。
      - 高优先级任务 → 倾向 L2（战略）
      - 声呐接触密集 → 倾向 L2
      - 深度极深 / 船体压力大 → 倾向 L2
      - 电量低 + 高优先级 → 倾向 L2
    分类器需要在启动时学会这个非线性组合。
    """
    rng = np.random.default_rng(seed)

    depth = rng.uniform(50, 800, n)
    speed = rng.uniform(0, 35, n)
    battery = rng.uniform(20, 100, n)
    sonar = rng.integers(0, 13, n).astype(np.float32)
    pressure = depth * 0.1 + rng.normal(0, 0.5, n)
    priority = rng.integers(1, 11, n).astype(np.float32)

    score = (
        0.55 * (priority / 10.0)
        + 0.30 * (sonar / 12.0)
        + 0.15 * (depth / 800.0)
        + 0.10 * ((100.0 - battery) / 100.0) * (priority / 10.0)
        + rng.normal(0, 0.08, n)
    )
    labels = (score > 0.55).astype(np.int64)

    features = np.stack([depth, speed, battery, sonar, pressure, priority], axis=1).astype(np.float32)
    return features, labels


class TacticalClassifier:
    """启动时现场训练一次，随后对每条遥测做 L1/L2 预测"""

    def __init__(self):
        self.model: TacticalMLP | None = None
        self.mean: torch.Tensor | None = None
        self.std: torch.Tensor | None = None
        self.report: TrainReport | None = None

    def save(self):
        """将模型权重、统计量与训练报告持久化到磁盘"""
        assert self.model is not None and self.mean is not None and self.std is not None
        _CHECKPOINT_DIR.mkdir(parents=True, exist_ok=True)
        state = {
            "model_state_dict": self.model.state_dict(),
            "mean": self.mean.cpu(),
            "std": self.std.cpu(),
            "report": {
                "device": self.report.device if self.report else str(DEVICE),
                "n_samples": self.report.n_samples if self.report else 4000,
                "epochs": self.report.epochs if self.report else 60,
                "final_loss": self.report.final_loss if self.report else 0,
                "accuracy": self.report.accuracy if self.report else 0,
            },
        }
        torch.save(state, _CHECKPOINT_FILE)
        log.info("Classifier checkpoint saved to %s", _CHECKPOINT_FILE)

    def load(self) -> bool:
        """从磁盘加载已训练的模型权重；返回 False 表示不存在"""
        if not _CHECKPOINT_FILE.is_file():
            return False
        state = torch.load(_CHECKPOINT_FILE, map_location=DEVICE, weights_only=True)
        model = TacticalMLP().to(DEVICE)
        model.load_state_dict(state["model_state_dict"])
        model.eval()

        self.model = model
        self.mean = state["mean"].to(DEVICE)
        self.std = state["std"].to(DEVICE)
        r = state["report"]
        self.report = TrainReport(
            device=r["device"],
            n_samples=r["n_samples"],
            epochs=r["epochs"],
            final_loss=r["final_loss"],
            accuracy=r["accuracy"],
        )
        log.info(
            "Classifier loaded from checkpoint: acc=%.4f loss=%.4f device=%s",
            r["accuracy"],
            r["final_loss"],
            r["device"],
        )
        return True

    def load_or_train(self, n_samples: int = 4000, epochs: int = 60) -> TrainReport:
        """优先加载已有权重，不存在则现场训练并保存"""
        if self.load():
            return self.report
        self.train(n_samples, epochs)
        self.save()
        return self.report

    def train(self, n_samples: int = 4000, epochs: int = 60) -> TrainReport:
        log.info("Training tactical classifier on %s (n=%d, epochs=%d)", DEVICE, n_samples, epochs)
        X_np, y_np = _synthesize_history(n=n_samples)

        X = torch.from_numpy(X_np).to(DEVICE)
        y = torch.from_numpy(y_np).to(DEVICE)

        mean = X.mean(dim=0, keepdim=True)
        std = X.std(dim=0, keepdim=True).clamp(min=1e-6)
        Xn = (X - mean) / std

        model = TacticalMLP().to(DEVICE)
        opt = Adam(model.parameters(), lr=3e-3)
        loss_fn = nn.CrossEntropyLoss()

        batch_size = 256
        n = Xn.shape[0]
        final_loss = 0.0

        for epoch in range(epochs):
            perm = torch.randperm(n, device=DEVICE)
            total = 0.0
            for i in range(0, n, batch_size):
                idx = perm[i : i + batch_size]
                logits = model(Xn[idx])
                loss = loss_fn(logits, y[idx])
                opt.zero_grad()
                loss.backward()
                opt.step()
                total += loss.item() * idx.shape[0]
            final_loss = total / n

        model.eval()
        with torch.no_grad():
            preds = model(Xn).argmax(dim=1)
            acc = (preds == y).float().mean().item()

        self.model = model
        self.mean = mean
        self.std = std
        self.report = TrainReport(
            device=str(DEVICE),
            n_samples=n,
            epochs=epochs,
            final_loss=round(final_loss, 4),
            accuracy=round(acc, 4),
        )
        log.info("Classifier trained: loss=%.4f acc=%.4f device=%s", final_loss, acc, DEVICE)
        return self.report

    def predict_l2(self, feats: dict) -> tuple[bool, float]:
        """
        输入一条遥测特征字典，返回 (is_l2, l2_prob)。
        is_l2=True 表示分类器判定应交由云端 L2 处理。
        """
        assert self.model is not None, "classifier not trained"
        vec = np.array(
            [
                feats["depth_m"],
                feats["speed_kn"],
                feats["battery_pct"],
                float(feats["sonar_contacts"]),
                feats["hull_pressure_bar"],
                float(feats["mission_priority"]),
            ],
            dtype=np.float32,
        )
        x = torch.from_numpy(vec).to(DEVICE).unsqueeze(0)
        xn = (x - self.mean) / self.std
        with torch.no_grad():
            probs = torch.softmax(self.model(xn), dim=1)[0]
        l2_prob = float(probs[1].item())
        return l2_prob >= 0.5, l2_prob


classifier = TacticalClassifier()

