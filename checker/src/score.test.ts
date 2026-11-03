import { describe, it, expect } from "vitest";
import { scoreReceiver, Signals } from "./score";

const base: Signals = {
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

  it("warns on a brand-new account with no history", () => {
    const r = scoreReceiver({ ...base, accountAgeDays: 0.2, txCount: 0 });
    expect(r.verdict).toBe("warn");
  });

  it("blocks a new contract whose code just changed", () => {
    const r = scoreReceiver({
      ...base,
      accountAgeDays: 0.5,
      txCount: 1,
      isContract: true,
      codeChangedDaysAgo: 0,
    });
    expect(r.verdict).toBe("block");
  });

  it("treats unavailable history as risky, not safe", () => {
    const r = scoreReceiver({ ...base, accountAgeDays: null, txCount: null });
    expect(r.verdict).toBe("allow"); // 20 risk alone stays under warn
    expect(r.risk).toBe(20);
    expect(r.reasons).toContain("account history unavailable");
  });

  it("prior payments reduce risk but never beat an evidenced report", () => {
    const trusted = scoreReceiver({
      ...base,
      accountAgeDays: 3,
      txCount: 2,
      priorInteractions: 5,
    });
    const reported = scoreReceiver({
      ...base,
      priorInteractions: 5,
      blocklistReports: [{ reporter: "a.testnet", evidence: "tx:abc" }],
    });
    expect(trusted.risk).toBeLessThan(30);
    expect(reported.verdict).toBe("warn");
  });
});
