# Leash

**Give an AI agent money without giving it the keys.** Leash is a spending guard for AI agents on NEAR. The agent can only pay through a guard contract that enforces limits on-chain, and a counterparty checker vets every receiver before the agent signs.

Built for NEAR HACKATHON 2026, track `security` (AI Security & Defense).

## The problem

An agent with a wallet key can overspend through a bug, a prompt injection, or a scam. If the key is a normal key, a hijacked agent can drain the account. A check that lives only inside the agent's own code is bypassed the moment the agent is compromised.

## How it works (three layers)

1. **Counterparty checker (agent side).** Before signing, the wrapper scores the receiver and returns `allow`, `warn` or `block` with reasons. On `block` it refuses to sign. On `warn` it asks a human (an unattended agent treats `warn` as a refusal).
   Signals used: whether the account exists, whether it is a contract, evidenced reports on the shared blocklist, and prior successful payments from this agent to the receiver.
2. **Guard contract (on-chain, TypeScript / near-sdk-js).** Holds the funds. The agent calls `pay`; the contract enforces a per-transaction cap, a rolling 24h cap, an owner allowlist and blocklist, and the community blocklist (2 reports with evidence blocks an account). Every decision, allowed or denied, is logged on-chain.
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

1. `cd contract && npm install && npm test` -> see `15 passed` (policy logic).
2. `cd ../checker && npm install && npm test` -> see `10 passed` (receiver scoring).
3. `cd ../agent && npm install && npm test` -> see `7 passed` (wrapper: refuses on block, asks a human on warn).

**B. Read the live contract (no keys needed)**

1. `near contract call-function as-read-only guard-leash7.testnet getPolicy json-args {} network-config testnet now` -> see the limits and the authorized agent.
2. `near contract call-function as-read-only guard-leash7.testnet getLog json-args {} network-config testnet now` -> see the on-chain audit log of allowed and blocked payments.

**C. Run the attack demo (needs your own deployment and keys; see `agent/DEPLOY.md`)**

1. `cd agent && npx tsx src/demo.ts`
2. See: a normal payment `PAID`; a prompt-injected payment to an unknown account `STOPPED` by the checker; a reported scammer `STOPPED`; a 50 NEAR payment sent straight to the contract `STOPPED` by the guard ("exceeds per-transaction cap"); a direct transfer from the agent account `REJECTED` by the NEAR protocol.

## NEAR features used

- Function-call access keys (agent key scoped to one contract and one method)
- Smart contract on testnet (near-sdk-js) that holds funds and transfers via promises
- NEAR JSON-RPC for receiver checks (`view_account`, contract view calls)
- near-api-js for signing the agent's calls

## Known limits (honest)

- Account age, transaction history and code-change recency are **not collected** in this version (they need an indexer). The scorer supports them; the signal collector leaves them empty.
- The contract's spendable balance excludes NEAR locked for its own storage.
- A function-call-only account cannot transfer NEAR or add keys, and it can lock itself out if the key's gas allowance runs out. Top up the allowance from the owner.
- Testnet only. No Intents integration (Intents has no testnet).

## Repository layout

- `contract/` guard contract and its tests
- `checker/` receiver scoring (pure logic) and tests
- `agent/` RPC reader, wrapper, signing, key generator, attack demo
- `policy.py`, `demo.py`, `test_policy.py` early offline Python prototype of the policy rules (reference only)

## License

MIT
