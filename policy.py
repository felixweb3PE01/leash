"""Leash policy engine: decides whether an AI agent's payment is allowed.

Pure logic, no network. Every decision is logged with a reason so the
demo can show exactly why a payment was allowed or blocked.
"""
from __future__ import annotations

import json
import time
from dataclasses import dataclass, field, asdict
from pathlib import Path


@dataclass
class Policy:
    max_per_tx: float = 5.0          # max NEAR per single payment
    max_per_day: float = 20.0        # max NEAR per rolling 24h
    allowlist: list[str] = field(default_factory=list)  # approved receivers
    blocklist: list[str] = field(default_factory=list)  # always denied

    @classmethod
    def load(cls, path: str | Path) -> "Policy":
        return cls(**json.loads(Path(path).read_text()))


@dataclass
class Decision:
    allowed: bool
    reason: str
    receiver: str
    amount: float
    ts: float


class Guard:
    def __init__(self, policy: Policy, log_path: str | Path | None = None):
        self.policy = policy
        self.log_path = Path(log_path) if log_path else None
        self._spent: list[tuple[float, float]] = []  # (timestamp, amount)

    def _spent_last_24h(self, now: float) -> float:
        cutoff = now - 86400
        self._spent = [(t, a) for t, a in self._spent if t >= cutoff]
        return sum(a for _, a in self._spent)

    def check(self, receiver: str, amount: float, now: float | None = None) -> Decision:
        now = time.time() if now is None else now
        p = self.policy

        if amount <= 0:
            return self._record(False, "amount must be positive", receiver, amount, now)
        if receiver in p.blocklist:
            return self._record(False, "receiver is blocklisted", receiver, amount, now)
        if p.allowlist and receiver not in p.allowlist:
            return self._record(False, "receiver not on allowlist", receiver, amount, now)
        if amount > p.max_per_tx:
            return self._record(
                False, f"exceeds per-transaction cap ({p.max_per_tx} NEAR)", receiver, amount, now
            )
        spent = self._spent_last_24h(now)
        if spent + amount > p.max_per_day:
            return self._record(
                False,
                f"exceeds daily cap ({p.max_per_day} NEAR, {spent:.2f} already spent)",
                receiver, amount, now,
            )

        self._spent.append((now, amount))
        return self._record(True, "within policy", receiver, amount, now)

    def _record(self, allowed, reason, receiver, amount, now) -> Decision:
        d = Decision(allowed, reason, receiver, amount, now)
        if self.log_path:
            with self.log_path.open("a") as f:
                f.write(json.dumps(asdict(d)) + "\n")
        return d
