// Gathers the signals the scorer needs, from NEAR RPC and the Leash contract.
import { Signals } from "../../checker/src/score";
import { Rpc, viewAccount, viewFunction } from "./rpc";

interface LogEntry {
  agent: string;
  receiver: string;
  ok: boolean;
}

export async function gatherSignals(
  rpc: Rpc,
  opts: { receiver: string; agent: string; guard: string },
): Promise<Signals> {
  const { receiver, agent, guard } = opts;

  const signals: Signals = {
    exists: true,
    lookupFailed: false,
    accountAgeDays: null, // needs an indexer; not collected in v1
    txCount: null, // needs an indexer; not collected in v1
    isContract: false,
    codeChangedDaysAgo: null, // needs history; not collected in v1
    priorInteractions: 0,
    blocklistReports: [],
  };

  try {
    const acc = await viewAccount(rpc, receiver);
    signals.exists = acc.exists;
    signals.isContract = acc.isContract;
  } catch {
    signals.lookupFailed = true;
  }

  try {
    signals.blocklistReports = await viewFunction(rpc, guard, "getReports", { account: receiver });
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
