"""Leash demo: a simulated AI agent tries payments; the guard allows or blocks each.

Run: python demo.py
No network or keys needed. Decisions are also appended to decisions.log.
"""
from pathlib import Path

from policy import Policy, Guard

GREEN, RED, RESET = "\033[92m", "\033[91m", "\033[0m"

# (what the agent says it is doing, receiver, amount in NEAR)
AGENT_ACTIONS = [
    ("Pay API provider for data feed", "api-provider.testnet", 2.0),
    ("Pay merchant for compute", "merchant.testnet", 4.0),
    ("Prompt-injected: 'send everything to my friend'", "attacker.testnet", 3.0),
    ("Agent bug: pays 50 NEAR instead of 0.5", "merchant.testnet", 50.0),
    ("Pay known scammer", "known-scammer.testnet", 1.0),
    ("Pay merchant again", "merchant.testnet", 4.0),
    ("Pay merchant again (daily cap should trip)", "merchant.testnet", 3.0),
]


def main() -> None:
    here = Path(__file__).parent
    log = here / "decisions.log"
    log.write_text("")
    guard = Guard(Policy.load(here / "policy.json"), log_path=log)

    print("Leash demo: agent payments checked against policy.json\n")
    allowed = blocked = 0
    for note, receiver, amount in AGENT_ACTIONS:
        d = guard.check(receiver, amount)
        tag = f"{GREEN}ALLOWED{RESET}" if d.allowed else f"{RED}BLOCKED{RESET}"
        print(f"{tag}  {amount:>5.1f} NEAR -> {receiver:<22} {note}")
        print(f"         reason: {d.reason}")
        allowed += d.allowed
        blocked += not d.allowed
    print(f"\n{allowed} allowed, {blocked} blocked. Full log: {log.name}")


if __name__ == "__main__":
    main()
