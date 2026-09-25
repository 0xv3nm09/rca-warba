"""Confidence calibrator, stored as reviewable JSON (never pickled)."""

import json
from pathlib import Path

DEFAULT_POINTS = [(0.0, 0.0), (0.70, 0.74), (0.78, 0.90), (0.85, 0.94), (0.90, 0.97), (1.0, 1.0)]


def fit(raw: list[float], correct: list[bool], path: str = "models/calibrator.json") -> None:
    """Fit bins on the labelled golden set; monotone by construction (pooled bins)."""
    pairs = sorted(zip(raw, (1.0 if c else 0.0 for c in correct), strict=True))
    n = len(pairs) or 1
    bins = max(2, min(20, n // 8))
    xs, ys = [], []
    for i in range(bins):
        chunk = pairs[i * len(pairs) // bins : (i + 1) * len(pairs) // bins] or pairs[-1:]
        xs.append(chunk[-1][0])
        ys.append(sum(y for _, y in chunk) / len(chunk))
    # enforce monotonicity
    for i in range(1, len(ys)):
        ys[i] = max(ys[i], ys[i - 1])
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    json.dump({"x": xs, "y": ys}, open(path, "w"))


class Calibrator:
    def __init__(self, path: str = "models/calibrator.json"):
        try:
            d = json.load(open(path))
            self.x, self.y = d["x"], d["y"]
        except FileNotFoundError:
            self.x, self.y = (tuple(t) for t in zip(*DEFAULT_POINTS, strict=True))

    def __call__(self, raw: float) -> float:
        if raw <= 0.0:
            return 0.0
        x, y = self.x, self.y
        if raw >= x[-1]:
            return y[-1]
        for i in range(1, len(x)):
            if raw <= x[i]:
                frac = (raw - x[i - 1]) / (x[i] - x[i - 1])
                return y[i - 1] + frac * (y[i] - y[i - 1])
        return y[-1]
