# Leash

A spending guard for AI agents that hold money. Leash sits between an agent and its wallet and enforces rules (per-transaction cap, daily cap, receiver allowlist/blocklist) before any payment is sent. Every decision is logged with a reason.

**Track:** AI Security & Defense (`security`), NEAR HACKATHON 2026.

## Problem

An AI agent with wallet access can overspend through a bug, a prompt injection, or a scam. Giving it a key means giving it everything. Leash gives the agent money without giving it unlimited authority.

## Status (honest)

| Part | State |
| --- | --- |
| Policy engine (caps, allowlist, blocklist, rolling 24h window) | Done, 7 tests passing |
| Simulated agent demo (offline) | Done |
| NEAR testnet payments through the guard | In progress |
| NEAR function call key scoped to the guard | Planned |

NEAR integration is built during the hackathon window (2026-11-01 to 2026-11-14). Nothing here is pre-hackathon code.

## Try it

Requires Python 3.10+.

1. `cd leash && pip install pytest`
2. `python -m pytest -q` -> see `7 passed`.
3. `python demo.py` -> see 3 payments ALLOWED and 4 BLOCKED, each with a reason (not on allowlist, over per-transaction cap, blocklisted, over daily cap).
4. Edit `policy.json` (for example set `max_per_tx` to `1.0`) and rerun `python demo.py` -> see more payments blocked.
5. `cat decisions.log` -> see one JSON line per decision.

## How it works

- `policy.py`: `Policy` (rules, loaded from JSON) and `Guard.check(receiver, amount)` which returns a `Decision(allowed, reason, ...)`. Checks run in order: amount valid, blocklist, allowlist, per-transaction cap, rolling 24h cap.
- `demo.py`: a scripted agent that attempts normal, buggy, injected and scam payments.
- `policy.json`: the rules.

## NEAR usage

Planned: payments execute on NEAR testnet only after the guard allows them, using a function call key with limited allowance so the agent cannot bypass the guard. This section will list exactly what is used once built.

## License

MIT
