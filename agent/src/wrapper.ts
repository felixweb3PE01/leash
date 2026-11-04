// Agent-side wrapper. The agent calls guardedPay(); it never signs directly.
//   block -> refuse, no transaction is sent
//   warn  -> ask a human; if there is no human or they decline, refuse
//   allow -> send `pay` to the guard contract with the scoped function-call key
// The contract enforces caps and lists again, so even if this wrapper is
// bypassed, a hijacked agent still cannot overspend.
import { scoreReceiver, Result, Signals } from "../../checker/src/score";

export interface PayRequest {
  receiver: string;
  amount: string; // yoctoNEAR
}

export interface Deps {
  getSignals(receiver: string): Promise<Signals>;
  askHuman(req: PayRequest, check: Result): Promise<boolean>;
  sendPay(req: PayRequest): Promise<{ ok: boolean; reason: string; txHash?: string }>;
}

export interface Outcome {
  sent: boolean;
  stage: "checker" | "human" | "contract";
  verdict: Result["verdict"];
  risk: number;
  reasons: string[];
  contract?: { ok: boolean; reason: string; txHash?: string };
}

export async function guardedPay(req: PayRequest, deps: Deps): Promise<Outcome> {
  const signals = await deps.getSignals(req.receiver);
  const check = scoreReceiver(signals);
  const base = { verdict: check.verdict, risk: check.risk, reasons: check.reasons };

  if (check.verdict === "block") {
    return { sent: false, stage: "checker", ...base };
  }
  if (check.verdict === "warn") {
    const approved = await deps.askHuman(req, check);
    if (!approved) return { sent: false, stage: "human", ...base };
  }
  const contract = await deps.sendPay(req);
  return { sent: contract.ok, stage: "contract", ...base, contract };
}
