// Gathers the signals the scorer needs, from NEAR RPC and the Leash contract.
// Account age and code-change recency come from asking the node about PAST
// blocks (no third-party indexer): did the account exist 1 day ago? 7 days ago?
// did the contract code change in the last 2 days?
import { Signals } from "../../checker/src/score";
import { Rpc, latestHeight, viewAccount, viewFunction, AccountView } from "./rpc";

interface LogEntry {
  agent: string;
  receiver: string;
  ok: boolean;
}

export const BLOCKS_PER_DAY = 86_400; // NEAR produces about one block per second
const DEFAULT_MIN_STAKE = 100_000_000_000_000_000_000_000n; // 0.1 NEAR, matches the contract

interface ChainReport {
  reporter: string;
  evidence: string;
  stake?: string;
}

// null = the node could not answer (for example, the block is too old for it)
async function accountAt(rpc: Rpc, id: string, height: number): Promise<AccountView | null> {
  try {
    return await viewAccount(rpc, id, height);
  } catch {
    return null;
  }
}

export async function gatherSignals(
  rpc: Rpc,
  opts: { receiver: string; agent: string; guard: string; archival?: Rpc },
): Promise<Signals> {
  const { receiver, agent, guard, archival } = opts;

  const signals: Signals = {
    exists: true,
    lookupFailed: false,
    accountAgeDays: null,
    txCount: null, // not collected: needs an indexer
    isContract: false,
    codeChangedDaysAgo: null,
    priorInteractions: 0,
    blocklistReports: [],
  };

  let nowHash: string | null = null;
  try {
    const acc = await viewAccount(rpc, receiver);
    signals.exists = acc.exists;
    signals.isContract = acc.isContract;
    nowHash = acc.codeHash;
  } catch {
    signals.lookupFailed = true;
  }

  if (signals.exists && !signals.lookupFailed) {
    try {
      const h = await latestHeight(rpc);

      // Account age, in coarse buckets: <1 day, 1-7 days, 7+ days.
      const d1 = await accountAt(rpc, receiver, h - BLOCKS_PER_DAY);
      if (d1 !== null) {
        if (!d1.exists) {
          signals.accountAgeDays = 0.5;
        } else {
          // Needs an archival node for 7 days back. If unavailable, we only know ">= 1 day".
          const d7 = archival ? await accountAt(archival, receiver, h - 7 * BLOCKS_PER_DAY) : null;
          if (d7 === null) signals.accountAgeDays = 7; // at least a day old; not penalised
          else signals.accountAgeDays = d7.exists ? 30 : 3;
        }
      }

      // Contract code change in the last 2 days (a regular node keeps ~2.5 days).
      if (signals.isContract) {
        const c2 = await accountAt(rpc, receiver, h - 2 * BLOCKS_PER_DAY);
        if (c2 !== null) {
          const unchanged = c2.exists && c2.codeHash === nowHash;
          signals.codeChangedDaysAgo = unchanged ? 30 : 1;
        }
      }
    } catch {
      // history is optional: leave age and code-change as "not collected"
    }
  }

  try {
    let minStake = DEFAULT_MIN_STAKE;
    try {
      const pol = await viewFunction<{ minStake?: string }>(rpc, guard, "getPolicy", {});
      if (pol.minStake) minStake = BigInt(pol.minStake);
    } catch {
      // keep the default
    }
    const raw = await viewFunction<ChainReport[]>(rpc, guard, "getReports", { account: receiver });
    signals.blocklistReports = raw.map((r) => ({
      reporter: r.reporter,
      evidence: r.evidence,
      staked: BigInt(r.stake ?? "0") >= minStake,
    }));
  } catch {
    signals.lookupFailed = true; // cannot read the shared blocklist: do not assume clean
  }

  try {
    const log = await viewFunction<LogEntry[]>(rpc, guard, "getLog", {});
    signals.priorInteractions = log.filter(
      (e) => e.ok && e.agent === agent && e.receiver === receiver,
    ).length;
  } catch {
    // history is only a trust bonus; failing to read it just means no bonus
  }

  return signals;
}
