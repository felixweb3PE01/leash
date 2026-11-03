// Counterparty scoring: pure logic, no network.
// Signals are gathered elsewhere (RPC / indexer / our contract) and passed in,
// so this file is deterministic and fully unit-testable.

export type Verdict = "allow" | "warn" | "block";

export interface BlocklistReport {
  reporter: string;
  evidence: string; // link or tx hash; empty string means no evidence
}

export interface Signals {
  accountAgeDays: number | null; // null = unknown (could not fetch)
  txCount: number | null;
  isContract: boolean;
  codeChangedDaysAgo: number | null; // only meaningful if isContract
  priorInteractions: number; // payments from this agent to this receiver before
  blocklistReports: BlocklistReport[];
}

export interface Result {
  verdict: Verdict;
  risk: number; // 0 (safe) to 100 (certain bad)
  reasons: string[];
}

const WARN_AT = 30;
const BLOCK_AT = 60;

export function scoreReceiver(s: Signals): Result {
  let risk = 0;
  const reasons: string[] = [];

  // Evidence-backed reports are the strongest signal. Reports with no evidence
  // are ignored so the blocklist can't be used to smear accounts for free.
  const evidenced = s.blocklistReports.filter((r) => r.evidence.trim() !== "");
  const unevidenced = s.blocklistReports.length - evidenced.length;
  if (evidenced.length >= 2) {
    risk += 100;
    reasons.push(`reported by ${evidenced.length} accounts with evidence`);
  } else if (evidenced.length === 1) {
    risk += 50;
    reasons.push("reported once with evidence");
  }
  if (unevidenced > 0) {
    reasons.push(`${unevidenced} report(s) ignored: no evidence attached`);
  }

  if (s.accountAgeDays === null || s.txCount === null) {
    risk += 20;
    reasons.push("account history unavailable");
  } else {
    if (s.accountAgeDays < 1) {
      risk += 30;
      reasons.push("account created less than a day ago");
    } else if (s.accountAgeDays < 7) {
      risk += 15;
      reasons.push("account less than a week old");
    }
    if (s.txCount < 3) {
      risk += 15;
      reasons.push("almost no activity history");
    }
  }

  if (s.isContract) {
    if (s.codeChangedDaysAgo !== null && s.codeChangedDaysAgo < 3) {
      risk += 35;
      reasons.push("contract code changed in the last 3 days");
    } else if (s.codeChangedDaysAgo === null) {
      risk += 10;
      reasons.push("contract code history unavailable");
    }
  }

  // Trust earned from successful past payments lowers risk, but never
  // overrides evidenced reports.
  if (s.priorInteractions >= 3 && evidenced.length === 0) {
    risk -= 20;
    reasons.push("agent has paid this receiver before");
  }

  risk = Math.max(0, Math.min(100, risk));
  const verdict: Verdict = risk >= BLOCK_AT ? "block" : risk >= WARN_AT ? "warn" : "allow";
  if (reasons.length === 0) reasons.push("no risk signals found");
  return { verdict, risk, reasons };
}
