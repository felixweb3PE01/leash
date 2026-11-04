// Pure decision logic for the Leash guard contract. No NEAR imports, so it is
// unit-testable off-chain. Amounts are yoctoNEAR strings (1 NEAR = 1e24).

export const DAY_NS = 86_400_000_000_000n;
export const BLOCK_THRESHOLD = 2; // evidenced reports needed for a community block
export const RESERVE = 1_000_000_000_000_000_000_000_000n; // keep 1 NEAR for storage

// A report must carry a fee (stake) of at least MIN_STAKE to count. Fake-report
// campaigns therefore cost real money. Reports from before this rule have no
// stake and do not count.
export const MIN_STAKE = 100_000_000_000_000_000_000_000n; // 0.1 NEAR

export interface Report {
  reporter: string;
  evidence: string;
  stake?: string; // yoctoNEAR attached when reporting
}

export interface SpendEntry {
  t: string; // block timestamp, nanoseconds
  a: string; // yoctoNEAR
}

export interface Policy {
  maxPerTx: string;
  maxPerDay: string;
  receivers: string[]; // allowlist; empty means "any receiver"
  blocked: string[]; // owner blocklist
}

export interface Decision {
  ok: boolean;
  reason: string;
}

export function countsAsReport(r: Report): boolean {
  return r.evidence.trim() !== "" && BigInt(r.stake ?? "0") >= MIN_STAKE;
}

export function evidencedReports(reports: Report[]): Report[] {
  return reports.filter(countsAsReport);
}

export function pruneSpends(spends: SpendEntry[], now: bigint): SpendEntry[] {
  return spends.filter((s) => BigInt(s.t) >= now - DAY_NS);
}

export function spentInWindow(spends: SpendEntry[], now: bigint): bigint {
  return pruneSpends(spends, now).reduce((sum, s) => sum + BigInt(s.a), 0n);
}

export function decide(args: {
  policy: Policy;
  spends: SpendEntry[];
  reportsForReceiver: Report[];
  receiver: string;
  amount: bigint;
  now: bigint;
  balance: bigint;
}): Decision {
  const { policy, spends, reportsForReceiver, receiver, amount, now, balance } = args;

  if (amount <= 0n) return { ok: false, reason: "amount must be positive" };
  if (policy.blocked.includes(receiver)) {
    return { ok: false, reason: "receiver is on the owner blocklist" };
  }
  const evidenced = evidencedReports(reportsForReceiver).length;
  if (evidenced >= BLOCK_THRESHOLD) {
    return {
      ok: false,
      reason: `receiver blocked by community: ${evidenced} reports with evidence`,
    };
  }
  if (policy.receivers.length > 0 && !policy.receivers.includes(receiver)) {
    return { ok: false, reason: "receiver not on allowlist" };
  }
  if (amount > BigInt(policy.maxPerTx)) {
    return { ok: false, reason: "exceeds per-transaction cap" };
  }
  const spent = spentInWindow(spends, now);
  if (spent + amount > BigInt(policy.maxPerDay)) {
    return { ok: false, reason: "exceeds rolling 24h cap" };
  }
  if (balance < amount + RESERVE) {
    return { ok: false, reason: "guard account has insufficient funds" };
  }
  return { ok: true, reason: "within policy" };
}

export function addReport(
  existing: Report[],
  reporter: string,
  evidence: string,
  stake: bigint,
): { reports: Report[]; error?: string } {
  if (evidence.trim() === "") return { reports: existing, error: "evidence is required" };
  if (evidence.length > 300) return { reports: existing, error: "evidence too long (max 300)" };
  if (stake < MIN_STAKE) {
    return { reports: existing, error: "a report fee of at least 0.1 NEAR must be attached" };
  }
  const mine = existing.find((r) => r.reporter === reporter);
  if (mine && countsAsReport(mine)) {
    return { reports: existing, error: "this account already reported the target" };
  }
  // An old report from the same account (made before fees existed) is replaced.
  const others = existing.filter((r) => r.reporter !== reporter);
  if (others.length >= 20) return { reports: existing, error: "report limit reached" };
  return { reports: [...others, { reporter, evidence, stake: stake.toString() }] };
}

export function dismissReport(existing: Report[], reporter: string): Report[] {
  return existing.filter((r) => r.reporter !== reporter);
}
