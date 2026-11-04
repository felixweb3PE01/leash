import { describe, it, expect } from "vitest";
import { decide, addReport, dismissReport, pruneSpends, DAY_NS, RESERVE, MIN_STAKE, Policy } from "./logic";

const S = MIN_STAKE.toString();

const N = 1_000_000_000_000_000_000_000_000n; // 1 NEAR in yocto
const policy: Policy = {
  maxPerTx: (5n * N).toString(),
  maxPerDay: (10n * N).toString(),
  receivers: ["merchant.testnet"],
  blocked: ["scam.testnet"],
};
const base = {
  policy,
  spends: [],
  reportsForReceiver: [],
  receiver: "merchant.testnet",
  amount: 2n * N,
  now: 1_000_000_000_000n,
  balance: 100n * N,
};

describe("decide", () => {
  it("allows a normal payment", () => {
    expect(decide(base).ok).toBe(true);
  });
  it("blocks zero or negative amounts", () => {
    expect(decide({ ...base, amount: 0n }).ok).toBe(false);
    expect(decide({ ...base, amount: -1n }).ok).toBe(false);
  });
  it("blocks owner-blocklisted receivers", () => {
    const d = decide({ ...base, receiver: "scam.testnet" });
    expect(d.ok).toBe(false);
    expect(d.reason).toContain("owner blocklist");
  });
  it("blocks receivers reported twice with evidence", () => {
    const d = decide({
      ...base,
      reportsForReceiver: [
        { reporter: "a.testnet", evidence: "tx:1", stake: S },
        { reporter: "b.testnet", evidence: "tx:2", stake: S },
      ],
    });
    expect(d.ok).toBe(false);
    expect(d.reason).toContain("community");
  });
  it("ignores reports without evidence", () => {
    const d = decide({
      ...base,
      reportsForReceiver: [
        { reporter: "a.testnet", evidence: "" },
        { reporter: "b.testnet", evidence: " " },
      ],
    });
    expect(d.ok).toBe(true);
  });
  it("blocks receivers not on the allowlist", () => {
    expect(decide({ ...base, receiver: "stranger.testnet" }).reason).toContain("allowlist");
  });
  it("blocks over the per-transaction cap", () => {
    expect(decide({ ...base, amount: 6n * N }).reason).toContain("per-transaction");
  });
  it("blocks over the rolling daily cap and releases after 24h", () => {
    const spends = [
      { t: "1000000000000", a: (5n * N).toString() },
      { t: "1000000000001", a: (5n * N).toString() },
    ];
    expect(decide({ ...base, spends, amount: 1n * N }).reason).toContain("24h");
    const later = base.now + DAY_NS + 10n;
    expect(decide({ ...base, spends, amount: 1n * N, now: later }).ok).toBe(true);
  });
  it("blocks when the guard cannot cover amount plus reserve", () => {
    const d = decide({ ...base, balance: base.amount + RESERVE - 1n });
    expect(d.ok).toBe(false);
    expect(d.reason).toContain("insufficient");
  });
  it("order: owner blocklist beats everything", () => {
    expect(decide({ ...base, receiver: "scam.testnet", amount: 1n }).ok).toBe(false);
  });
});

describe("addReport", () => {
  it("requires evidence", () => {
    expect(addReport([], "a.testnet", "  ", MIN_STAKE).error).toBeDefined();
  });
  it("requires the report fee", () => {
    expect(addReport([], "a.testnet", "tx:1", MIN_STAKE - 1n).error).toContain("fee");
    expect(addReport([], "a.testnet", "tx:1", 0n).error).toContain("fee");
  });
  it("rejects duplicate paying reporters", () => {
    const r = addReport([], "a.testnet", "tx:1", MIN_STAKE).reports;
    expect(addReport(r, "a.testnet", "tx:2", MIN_STAKE).error).toBeDefined();
  });
  it("replaces an old unstaked report from the same account", () => {
    const legacy = [{ reporter: "a.testnet", evidence: "old" }];
    const res = addReport(legacy, "a.testnet", "tx:new", MIN_STAKE);
    expect(res.error).toBeUndefined();
    expect(res.reports).toHaveLength(1);
    expect(res.reports[0].evidence).toBe("tx:new");
  });
  it("rejects over-long evidence", () => {
    expect(addReport([], "a.testnet", "x".repeat(301), MIN_STAKE).error).toBeDefined();
  });
  it("accepts valid reports and records the stake", () => {
    const res = addReport([], "a.testnet", "tx:1", MIN_STAKE);
    expect(res.error).toBeUndefined();
    expect(res.reports[0].stake).toBe(S);
  });
});

describe("community block needs paid reports", () => {
  const two = (stake?: string) => [
    { reporter: "a.testnet", evidence: "tx:1", stake },
    { reporter: "b.testnet", evidence: "tx:2", stake },
  ];
  it("blocks on two paid reports", () => {
    expect(decide({ ...base, reportsForReceiver: two(S) }).ok).toBe(false);
  });
  it("does not block on reports with no fee (legacy or sybil)", () => {
    expect(decide({ ...base, reportsForReceiver: two(undefined) }).ok).toBe(true);
    expect(decide({ ...base, reportsForReceiver: two("1") }).ok).toBe(true);
  });
});

describe("dismissReport", () => {
  it("removes only that reporter's report", () => {
    const r = [
      { reporter: "a.testnet", evidence: "x", stake: S },
      { reporter: "b.testnet", evidence: "y", stake: S },
    ];
    const out = dismissReport(r, "a.testnet");
    expect(out).toHaveLength(1);
    expect(out[0].reporter).toBe("b.testnet");
  });
});

describe("pruneSpends", () => {
  it("drops entries older than 24h", () => {
    const now = 10n * DAY_NS;
    const kept = pruneSpends(
      [
        { t: (now - DAY_NS - 1n).toString(), a: "1" },
        { t: (now - 5n).toString(), a: "1" },
      ],
      now,
    );
    expect(kept).toHaveLength(1);
  });
});
