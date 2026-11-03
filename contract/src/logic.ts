// Pure decision logic for the Leash guard contract. No NEAR imports, so it is
// unit-testable off-chain. Amounts are yoctoNEAR strings (1 NEAR = 1e24).

export const DAY_NS = 86_400_000_000_000n;
export const BLOCK_THRESHOLD = 2; // evidenced reports needed for a community block
export const RESERVE = 1_000_000_000_000_000_000_000_000n; // keep 1 NEAR for storage

export interface Report {
  reporter: string;
  evidence: string;
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

export function evidencedReports(reports: Report[]): Report[] {
  return reports.filter((r) => r.evidence.trim() !== "");
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
): { reports: Report[]; error?: string } {
  if (evidence.trim() === "") return { reports: existing, error: "evidence is required" };
  if (evidence.length > 300) return { reports: existing, error: "evidence too long (max 300)" };
  if (existing.some((r) => r.reporter === reporter)) {
    return { reports: existing, error: "this account already reported the target" };
  }
  if (existing.length >= 20) return { reports: existing, error: "report limit reached" };
  return { reports: [...existing, { reporter, evidence }] };
}
