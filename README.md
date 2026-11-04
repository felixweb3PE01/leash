# Leash

**Give an AI agent money without giving it the keys.** Leash is a spending guard for AI agents on NEAR. The agent can only pay through a guard contract that enforces limits on-chain, and a counterparty checker vets every receiver before the agent signs.

Built for NEAR HACKATHON 2026, track `security` (AI Security & Defense).

## The problem

An agent with a wallet key can overspend through a bug, a prompt injection, or a scam. If the key is a normal key, a hijacked agent can drain the account. A check that lives only inside the agent's own code is bypassed the moment the agent is compromised.

## How it works (three layers)

1. **Counterparty checker (agent side).** Before signing, the wrapper scores the receiver and returns `allow`, `warn` or `block` with reasons. On `block` it refuses to sign. On `warn` it asks a human (an unattended agent treats `warn` as a refusal).
   Signals used: whether the account exists; account age (under 1 day, 1-7 days, 7+ days, read from past blocks on the NEAR node); whether it is a contract and whether its code changed in the last 2 days; paid, evidenced reports on the shared blocklist; and prior successful payments from this agent to the receiver.
2. **Guard contract (on-chain, TypeScript / near-sdk-js).** Holds the funds. The agent calls `pay`; the contract enforces a per-transaction cap, a rolling 24h cap, an owner allowlist and blocklist, and the community blocklist (2 reports, each with evidence and a 0.1 NEAR report fee, block an account; the owner can dismiss bad-faith reports). Every decision, allowed or denied, is logged on-chain.
3. **Function-call key.** The agent account holds only a function-call access key restricted to `guard.pay`. It cannot transfer NEAR itself or add keys, so skipping the contract is rejected by the NEAR protocol.

Even if layer 1 is bypassed, layers 2 and 3 still stop the attack.

## Live testnet deployment

| Item | Account |
| --- | --- |
| Guard contract | `guard-leash7.testnet` |
| Owner | `felix-leash7.testnet` |
| Agent | `agent-leash7.testnet` |
| Approved merchant | `merchant-leash7.testnet` |

Limits at deployment: 5 NEAR per payment, 10 NEAR per rolling 24h.

## Try it (do X, see Y)

Requires Node 22+.

**A. Run all tests offline (no accounts needed)**

1. `cd contract && npm install && npm test` -> see `20 passed` (policy logic).
2. `cd ../checker && npm install && npm test` -> see `11 passed` (receiver scoring).
3. `cd ../agent && npm install && npm test` -> see `16 passed` (wrapper and signal collection).

**B. Read the live contract (no keys needed)**

1. `near contract call-function as-read-only guard-leash7.testnet getPolicy json-args {} network-config testnet now` -> see the limits and the authorized agent.
2. `near contract call-function as-read-only guard-leash7.testnet getLog json-args {} network-config testnet now` -> see the on-chain audit log of allowed and blocked payments.

**C. Run the attack demo (needs your own deployment and keys; see `agent/DEPLOY.md`)**

1. `cd agent && npx tsx src/demo.ts`
2. See: a normal payment `PAID`; a prompt-injected payment to an unknown account `STOPPED` by the checker; a reported scammer `STOPPED`; a 50 NEAR payment sent straight to the contract `STOPPED` by the guard ("exceeds per-transaction cap"); a direct transfer from the agent account `REJECTED` by the NEAR protocol (the key is function-call only).

## Live results (real testnet transactions)

| Scenario | Result | Transaction |
| --- | --- | --- |
| Normal payment, 1 NEAR to the approved merchant | Paid | [view](https://explorer.testnet.near.org/transactions/BKH1B15FpY77xxR2ogGBH7NQC6m18aHaLjqSroTe7nCA) |
| 50 NEAR sent straight to the contract (checker skipped) | Denied on-chain: exceeds per-transaction cap | [view](https://explorer.testnet.near.org/transactions/3m8ZHaWujDAYtjAcTAqV3tKYXFgLjs1SwUJtB2cUJG88) |
| Payment to an unknown account (prompt injection) | Stopped by the checker, no transaction sent | none |
| Payment to an account reported twice with evidence | Stopped by the checker, no transaction sent | none |
| Direct NEAR transfer from the agent account | Rejected by the NEAR protocol (function-call-only key) | none |

Each run of the demo makes one real 1 NEAR payment, which counts toward the 10 NEAR daily cap.

## NEAR features used

- Function-call access keys (agent key scoped to one contract and one method)
- Smart contract on testnet (near-sdk-js) that holds funds and transfers via promises
- NEAR JSON-RPC for receiver checks (`view_account`, contract view calls)
- near-api-js for signing the agent's calls

## Known limits (honest)

- Transaction count is **not collected** (it needs an indexer; the testnet indexer I tried returned no data). Account age and code-change recency are coarse: they come from asking the node whether the account existed 1 and 7 days ago and whether the code hash changed in the last 2 days. A regular node keeps about 2.5 days of history, so the 7-day check uses an archival node and is skipped (treated as 'at least 1 day old') if that node is unavailable.
- The contract's spendable balance excludes NEAR locked for its own storage.
- A function-call-only account cannot transfer NEAR or add keys, and it can lock itself out if the key's gas allowance runs out. Top up the allowance from the owner.
- **The community blocklist is harder to game, not impossible.** Each report must attach a 0.1 NEAR fee (kept by the guard) and the owner can dismiss bad-faith reports, so a fake-report campaign costs real money. The contract still cannot verify evidence, and an attacker with funds can still block a receiver until the owner dismisses it. Next steps would be reputation- or stake-weighted reporters.
- The "scammer" and its two reports in the demo are simulated for testing.
- Testnet only. No Intents integration (Intents has no testnet).

## Repository layout

- `contract/` guard contract and its tests
- `checker/` receiver scoring (pure logic) and tests
- `agent/` RPC reader, wrapper, signing, key generator, attack demo
- `policy.py`, `demo.py`, `test_policy.py` early offline Python prototype of the policy rules (reference only)

## License

MIT
