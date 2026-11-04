import { describe, it, expect, vi } from "vitest";
import { guardedPay, Deps } from "./wrapper";
import { Signals } from "../../checker/src/score";

const clean: Signals = {
  exists: true, lookupFailed: false, accountAgeDays: null, txCount: null,
  isContract: false, codeChangedDaysAgo: null, priorInteractions: 0, blocklistReports: [],
};
const req = { receiver: "merchant.testnet", amount: "1" };

function deps(signals: Signals, human = false): Deps & { sendPay: any; askHuman: any } {
  return {
    getSignals: async () => signals,
    askHuman: vi.fn(async () => human),
    sendPay: vi.fn(async () => ({ ok: true, reason: "within policy", txHash: "tx" })),
  };
}

describe("guardedPay", () => {
  it("sends a clean payment to the contract", async () => {
    const d = deps(clean);
    const o = await guardedPay(req, d);
    expect(o.sent).toBe(true);
    expect(d.sendPay).toHaveBeenCalledOnce();
    expect(d.askHuman).not.toHaveBeenCalled();
  });

  it("refuses to sign when the checker says block", async () => {
    const d = deps({
      ...clean,
      blocklistReports: [
        { reporter: "a", evidence: "tx:1" },
        { reporter: "b", evidence: "tx:2" },
      ],
    });
    const o = await guardedPay(req, d);
    expect(o.sent).toBe(false);
    expect(o.stage).toBe("checker");
    expect(d.sendPay).not.toHaveBeenCalled();
  });

  it("blocks an account that does not exist without sending", async () => {
    const d = deps({ ...clean, exists: false });
    expect((await guardedPay(req, d)).sent).toBe(false);
    expect(d.sendPay).not.toHaveBeenCalled();
  });

  it("on warn, asks a human and refuses if declined", async () => {
    const d = deps({ ...clean, blocklistReports: [{ reporter: "a", evidence: "tx:1" }] }, false);
    const o = await guardedPay(req, d);
    expect(d.askHuman).toHaveBeenCalledOnce();
    expect(o.sent).toBe(false);
    expect(o.stage).toBe("human");
    expect(d.sendPay).not.toHaveBeenCalled();
  });

  it("on warn, sends if the human approves", async () => {
    const d = deps({ ...clean, blocklistReports: [{ reporter: "a", evidence: "tx:1" }] }, true);
    const o = await guardedPay(req, d);
    expect(o.sent).toBe(true);
    expect(d.sendPay).toHaveBeenCalledOnce();
  });

  it("reports a contract-level denial as not sent", async () => {
    const d = deps(clean);
    d.sendPay = vi.fn(async () => ({ ok: false, reason: "exceeds per-transaction cap" }));
    const o = await guardedPay(req, d);
    expect(o.sent).toBe(false);
    expect(o.stage).toBe("contract");
    expect(o.contract?.reason).toContain("per-transaction");
  });

  it("warns (not allows) when the lookup failed", async () => {
    const d = deps({ ...clean, lookupFailed: true }, false);
    const o = await guardedPay(req, d);
    expect(o.verdict).toBe("warn");
    expect(o.sent).toBe(false);
  });
});
