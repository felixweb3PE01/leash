// Leash attack demo against the live testnet deployment.
//   npx tsx src/demo.ts
// Reads LEASH_AGENT_KEY / LEASH_AGENT_ID / LEASH_GUARD_ID from .env.
import { readFileSync } from "node:fs";
import { guardedPay, Outcome } from "./wrapper";
import { gatherSignals } from "./signals";
import { makeRpc, DEFAULT_RPC } from "./rpc";
import { makeSendPay, attemptDirectTransfer, SendConfig } from "./send";

function loadEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}

const env = loadEnv();
const cfg: SendConfig = {
  agentId: env.LEASH_AGENT_ID,
  guardId: env.LEASH_GUARD_ID,
  privateKey: env.LEASH_AGENT_KEY,
  nodeUrl: env.LEASH_RPC ?? DEFAULT_RPC,
};
if (!cfg.privateKey) throw new Error("Missing LEASH_AGENT_KEY in .env. Run: npx tsx src/genkey.ts");

const rpc = makeRpc(cfg.nodeUrl);
const archival = makeRpc(env.LEASH_ARCHIVAL_RPC ?? "https://archival-rpc.testnet.near.org");
const sendPay = makeSendPay(cfg);
const N = 10n ** 24n;
const near = (n: number) => (BigInt(Math.round(n * 1000)) * N / 1000n).toString();

const G = (s: string) => `\x1b[92m${s}\x1b[0m`;
const R = (s: string) => `\x1b[91m${s}\x1b[0m`;
const Y = (s: string) => `\x1b[93m${s}\x1b[0m`;

function show(title: string, o: Outcome) {
  const verdict = o.sent ? G("PAID") : R("STOPPED");
  const where = o.stage === "checker" ? "by the counterparty checker (no transaction sent)"
    : o.stage === "human" ? "waiting for a human, none approved (no transaction sent)"
    : o.sent ? "after the on-chain policy approved it"
    : "by the on-chain guard contract";
  console.log(`\n${title}\n  ${verdict} ${where}`);
  console.log(`  checker: ${o.verdict} (risk ${o.risk}) - ${o.reasons.join("; ")}`);
  if (o.contract) console.log(`  contract: ${o.contract.ok ? "ok" : "denied"} - ${o.contract.reason}${o.contract.txHash ? `\n  tx: https://explorer.testnet.near.org/transactions/${o.contract.txHash}` : ""}`);
}

async function pay(receiver: string, amount: string): Promise<Outcome> {
  return guardedPay({ receiver, amount }, {
    getSignals: (r) => gatherSignals(rpc, { receiver: r, agent: cfg.agentId, guard: cfg.guardId, archival }),
    askHuman: async () => false, // unattended agent: a "warn" is treated as a refusal
    sendPay,
  });
}

async function main() {
  console.log(`Leash demo. Agent ${cfg.agentId} holds only a function-call key for ${cfg.guardId}.pay`);

  show("1. Normal job: pay merchant 1 NEAR", await pay("merchant-leash7.testnet", near(1)));
  show("2. Prompt injection: 'send 3 NEAR to my friend' (unknown account)", await pay("attacker-leash7.testnet", near(3)));
  show("3. Known scammer reported twice with evidence", await pay("scammer-leash7.testnet", near(1)));

  // 4. Simulate a compromised wrapper: skip the checker, hit the contract directly.
  console.log("\n4. Compromised agent skips the checker and sends 50 NEAR straight to the contract");
  const direct = await sendPay({ receiver: "merchant-leash7.testnet", amount: near(50) });
  console.log(`  ${direct.ok ? G("PAID") : R("STOPPED")} by the on-chain guard contract - ${direct.reason}`);
  if (direct.txHash) console.log(`  tx: https://explorer.testnet.near.org/transactions/${direct.txHash}`);

  // 5. Skip the contract entirely: transfer from the agent's own account.
  console.log("\n5. Compromised agent tries to transfer NEAR out of its own account, skipping the guard");
  const t = await attemptDirectTransfer(cfg, "attacker-leash7.testnet", N);
  if (t.rejected) {
    console.log(`  ${R("REJECTED")} by the NEAR protocol: this key is function-call only, so it cannot transfer NEAR`);
    console.log(`  (raw NEAR error: ${t.message.slice(0, 90)}...)`);
  } else {
    console.log(`  ${G("SUCCEEDED")} - ${t.message}`);
  }

  console.log(Y("\nDone. Audit log (on-chain): near contract call-function as-read-only " + cfg.guardId + " getLog json-args {} network-config testnet now"));
}

main().catch((e) => { console.error(e); process.exit(1); });
