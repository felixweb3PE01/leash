// Leash guard contract (NEAR, near-sdk-js).
//
// The contract holds the funds. An AI agent gets only a function-call access key
// scoped to this contract's `pay` method, so even a hijacked agent can only
// move money the policy allows. Every decision (allowed or blocked) is logged
// on-chain.
import { NearBindgen, near, call, view, initialize, assert, validateAccountId } from "near-sdk-js";
import {
  Policy,
  Report,
  SpendEntry,
  addReport,
  decide,
  evidencedReports,
  pruneSpends,
  spentInWindow,
  BLOCK_THRESHOLD,
} from "./logic";

interface LogEntry {
  t: string;
  agent: string;
  receiver: string;
  amount: string;
  ok: boolean;
  reason: string;
}

const MAX_LOG = 50;

@NearBindgen({ requireInit: true })
export class Guard {
  owner = "";
  maxPerTx = "0";
  maxPerDay = "0";
  agents: string[] = [];
  receivers: string[] = [];
  blocked: string[] = [];
  reports: Record<string, Report[]> = {};
  spends: SpendEntry[] = [];
  log: LogEntry[] = [];

  @initialize({})
  init({ owner, maxPerTx, maxPerDay }: { owner: string; maxPerTx: string; maxPerDay: string }): void {
    assert(validateAccountId(owner), "invalid owner account");
    this.owner = owner;
    this.maxPerTx = maxPerTx;
    this.maxPerDay = maxPerDay;
  }

  // ---- owner-only configuration -------------------------------------------

  private onlyOwner(): void {
    assert(near.predecessorAccountId() === this.owner, "only the owner can do this");
  }

  @call({})
  setLimits({ maxPerTx, maxPerDay }: { maxPerTx: string; maxPerDay: string }): void {
    this.onlyOwner();
    this.maxPerTx = maxPerTx;
    this.maxPerDay = maxPerDay;
  }

  @call({})
  addAgent({ agent }: { agent: string }): void {
    this.onlyOwner();
    assert(validateAccountId(agent), "invalid agent account");
    if (!this.agents.includes(agent)) this.agents.push(agent);
  }

  @call({})
  removeAgent({ agent }: { agent: string }): void {
    this.onlyOwner();
    this.agents = this.agents.filter((a) => a !== agent);
  }

  @call({})
  allowReceiver({ receiver }: { receiver: string }): void {
    this.onlyOwner();
    assert(validateAccountId(receiver), "invalid receiver account");
    if (!this.receivers.includes(receiver)) this.receivers.push(receiver);
  }

  @call({})
  blockReceiver({ receiver }: { receiver: string }): void {
    this.onlyOwner();
    if (!this.blocked.includes(receiver)) this.blocked.push(receiver);
  }

  // ---- the agent-facing method (callable with a function-call key) --------

  @call({})
  pay({ receiver, amount }: { receiver: string; amount: string }): { ok: boolean; reason: string } {
    const agent = near.predecessorAccountId();
    assert(this.agents.includes(agent), "caller is not an authorized agent");
    assert(validateAccountId(receiver), "invalid receiver account");

    const now = near.blockTimestamp();
    this.spends = pruneSpends(this.spends, now);

    const d = decide({
      policy: this.policy(),
      spends: this.spends,
      reportsForReceiver: this.reports[receiver] ?? [],
      receiver,
      amount: BigInt(amount),
      now,
      balance: near.accountBalance(),
    });

    // Denials return normally (not a panic) so the audit log is kept on-chain.
    this.record({ t: now.toString(), agent, receiver, amount, ok: d.ok, reason: d.reason });
    if (!d.ok) return d;

    this.spends.push({ t: now.toString(), a: amount });
    const p = near.promiseBatchCreate(receiver);
    near.promiseBatchActionTransfer(p, BigInt(amount));
    return d;
  }

  // ---- shared blocklist: anyone can report, but evidence is required ------

  @call({})
  report({ account, evidence }: { account: string; evidence: string }): void {
    assert(validateAccountId(account), "invalid account");
    const res = addReport(this.reports[account] ?? [], near.predecessorAccountId(), evidence);
    assert(!res.error, res.error ?? "");
    this.reports[account] = res.reports;
  }

  // ---- views ---------------------------------------------------------------

  @view({})
  getPolicy(): Policy & { owner: string; agents: string[]; spentToday: string } {
    return {
      owner: this.owner,
      agents: this.agents,
      spentToday: spentInWindow(this.spends, near.blockTimestamp()).toString(),
      ...this.policy(),
    };
  }

  @view({})
  getLog(): LogEntry[] {
    return this.log;
  }

  @view({})
  getReports({ account }: { account: string }): Report[] {
    return this.reports[account] ?? [];
  }

  @view({})
  isCommunityBlocked({ account }: { account: string }): boolean {
    return evidencedReports(this.reports[account] ?? []).length >= BLOCK_THRESHOLD;
  }

  // ---- helpers -------------------------------------------------------------

  private policy(): Policy {
    return {
      maxPerTx: this.maxPerTx,
      maxPerDay: this.maxPerDay,
      receivers: this.receivers,
      blocked: this.blocked,
    };
  }

  private record(e: LogEntry): void {
    this.log.push(e);
    if (this.log.length > MAX_LOG) this.log = this.log.slice(this.log.length - MAX_LOG);
    near.log(JSON.stringify({ event: e.ok ? "pay_allowed" : "pay_blocked", ...e }));
  }
}
