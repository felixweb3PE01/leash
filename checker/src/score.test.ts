import { describe, it, expect } from "vitest";
import { scoreReceiver, Signals } from "./score";

const base: Signals = {
  exists: true,
  lookupFailed: false,
  accountAgeDays: 400,
  txCount: 500,
  isContract: false,
  codeChangedDaysAgo: null,
  priorInteractions: 0,
  blocklistReports: [],
};

describe("scoreReceiver", () => {
  it("allows an old, active, unreported account", () => {
    const r = scoreReceiver(base);
    expect(r.verdict).toBe("allow");
    expect(r.risk).toBe(0);
  });

  it("blocks an account reported twice with evidence", () => {
    const r = scoreReceiver({
      ...base,
      blocklistReports: [
        { reporter: "a.testnet", evidence: "tx:abc" },
        { reporter: "b.testnet", evidence: "tx:def" },
      ],
    });
    expect(r.verdict).toBe("block");
  });

  it("warns on a single evidenced report", () => {
    const r = scoreReceiver({
      ...base,
      blocklistReports: [{ reporter: "a.testnet", evidence: "tx:abc" }],
    });
    expect(r.verdict).toBe("warn");
  });

  it("ignores reports without evidence", () => {
    const r = scoreReceiver({
      ...base,
      blocklistReports: [
        { reporter: "a.testnet", evidence: "" },
        { reporter: "b.testnet", evidence: "  " },
        { reporter: "c.testnet", evidence: "" },
      ],
    });
    expect(r.verdict).toBe("allow");
    expect(r.reasons.join(" ")).toContain("no evidence");
  });

  it("ignores reports whose fee was not paid", () => {
    const r = scoreReceiver({
      ...base,
      blocklistReports: [
        { reporter: "a.testnet", evidence: "tx:1", staked: false },
        { reporter: "b.testnet", evidence: "tx:2", staked: false },
      ],
    });
    expect(r.verdict).toBe("allow");
    expect(r.reasons.join(" ")).toContain("no report fee");
  });

  it("blocks an account that does not exist", () => {
    const r = scoreReceiver({ ...base, exists: false });
    expect(r.verdict).toBe("block");
    expect(r.reasons).toContain("account does not exist on-chain");
  });

  it("warns when the account cannot be verified at all", () => {
    const r = scoreReceiver({ ...base, lookupFailed: true });
    expect(r.verdict).toBe("warn");
    expect(r.reasons).toContain("could not verify the account on-chain");
  });

  it("warns on an account created less than a day ago", () => {
    const r = scoreReceiver({ ...base, accountAgeDays: 0.2 });
    expect(r.verdict).toBe("warn");
  });

  it("does not penalise txCount when it was not collected", () => {
    const r = scoreReceiver({ ...base, txCount: null });
    expect(r.verdict).toBe("allow");
  });

  it("blocks a new contract whose code just changed", () => {
    const r = scoreReceiver({
      ...base,
      accountAgeDays: 0.5,
      isContract: true,
      codeChangedDaysAgo: 0,
    });
    expect(r.verdict).toBe("block");
  });

  it("prior payments reduce risk but never beat an evidenced report", () => {
    const trusted = scoreReceiver({ ...base, accountAgeDays: 3, priorInteractions: 5 });
    const reported = scoreReceiver({
      ...base,
      priorInteractions: 5,
      blocklistReports: [{ reporter: "a.testnet", evidence: "tx:abc" }],
    });
    expect(trusted.risk).toBeLessThan(30);
    expect(reported.verdict).toBe("warn");
  });
});
