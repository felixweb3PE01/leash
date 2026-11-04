// Counterparty scoring: pure logic, no network.
// Signals are gathered elsewhere (RPC / our contract) and passed in, so this
// file is deterministic and fully unit-testable.

export type Verdict = "allow" | "warn" | "block";

export interface BlocklistReport {
  reporter: string;
  evidence: string; // link or tx hash; empty string means no evidence
  staked?: boolean; // paid the report fee; false = does not count (default: counts)
}

export interface Signals {
  exists: boolean; // does the receiver account exist on-chain
  lookupFailed: boolean; // true if we could not verify the account at all
  accountAgeDays: number | null; // null = could not be determined
  txCount: number | null; // null = not collected (no penalty)
  isContract: boolean;
  codeChangedDaysAgo: number | null; // only meaningful if isContract
  priorInteractions: number; // successful payments from this agent before
  blocklistReports: BlocklistReport[];
}

export interface Result {
  verdict: Verdict;
  risk: number; // 0 (safe) to 100 (certain bad)
  reasons: string[];
}

export const WARN_AT = 30;
export const BLOCK_AT = 60;

export function scoreReceiver(s: Signals): Result {
  let risk = 0;
  const reasons: string[] = [];

  // Evidence-backed reports are the strongest signal. Reports with no evidence
  // are ignored so the blocklist can't be used to smear accounts for free.
  const evidenced = s.blocklistReports.filter((r) => r.evidence.trim() !== "" && r.staked !== false);
  const unevidenced = s.blocklistReports.length - evidenced.length;
  if (evidenced.length >= 2) {
    risk += 100;
    reasons.push(`reported by ${evidenced.length} accounts with evidence`);
  } else if (evidenced.length === 1) {
    risk += 50;
    reasons.push("reported once with evidence");
  }
  if (unevidenced > 0) {
    reasons.push(`${unevidenced} report(s) ignored: no evidence or no report fee paid`);
  }

  if (s.lookupFailed) {
    risk += 35;
    reasons.push("could not verify the account on-chain");
  } else if (!s.exists) {
    risk += 70;
    reasons.push("account does not exist on-chain");
  } else {
    // accountAgeDays null = not collected (needs an indexer): no penalty.
    if (s.accountAgeDays !== null && s.accountAgeDays < 1) {
      risk += 30;
      reasons.push("account created less than a day ago");
    } else if (s.accountAgeDays !== null && s.accountAgeDays < 7) {
      risk += 15;
      reasons.push("account less than a week old");
    }
    if (s.txCount !== null && s.txCount < 3) {
      risk += 15;
      reasons.push("almost no activity history");
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
