import { describe, it, expect } from "vitest";
import { gatherSignals, BLOCKS_PER_DAY } from "./signals";
import { Rpc } from "./rpc";

const H = 10_000_000; // pretend latest block height
const B64 = (o: unknown) => Array.from(Buffer.from(JSON.stringify(o)));

// Fake node. created = block height when the account was created (undefined = never).
function fakeNode(opts: {
  created?: number;
  codeHashAt?: (height: number) => string;
  oldBlocksUnavailable?: boolean;
  reports?: unknown[];
}): Rpc {
  return (async (method: string, params: any) => {
    if (method === "block") return { header: { height: H } };
    if (method === "query" && params.request_type === "view_account") {
      const at = params.block_id ?? H;
      if (opts.oldBlocksUnavailable && params.block_id !== undefined) {
        const e: any = new Error("unknown block");
        e.rpcError = { cause: { name: "UNKNOWN_BLOCK" } };
        throw e;
      }
      if (opts.created === undefined || at < opts.created) {
        const e: any = new Error("does not exist");
        e.rpcError = { cause: { name: "UNKNOWN_ACCOUNT" } };
        throw e;
      }
      const hash = opts.codeHashAt ? opts.codeHashAt(at) : "11111111111111111111111111111111";
      return { code_hash: hash };
    }
    if (method === "query" && params.request_type === "call_function") {
      if (params.method_name === "getReports") return { result: B64(opts.reports ?? []) };
      return { result: B64([]) };
    }
    throw new Error("unexpected " + method);
  }) as Rpc;
}

const base = { receiver: "r.testnet", agent: "a.testnet", guard: "g.testnet" };

describe("gatherSignals: account age", () => {
  it("brand-new account (created 2 hours ago) is under a day old", async () => {
    const rpc = fakeNode({ created: H - 7_200 });
    const s = await gatherSignals(rpc, { ...base, archival: rpc });
    expect(s.accountAgeDays).toBe(0.5);
  });
  it("3-day-old account is 1-7 days old", async () => {
    const rpc = fakeNode({ created: H - 3 * BLOCKS_PER_DAY });
    const s = await gatherSignals(rpc, { ...base, archival: rpc });
    expect(s.accountAgeDays).toBe(3);
  });
  it("30-day-old account is 7+ days old", async () => {
    const rpc = fakeNode({ created: H - 30 * BLOCKS_PER_DAY });
    const s = await gatherSignals(rpc, { ...base, archival: rpc });
    expect(s.accountAgeDays).toBe(30);
  });
  it("without an archival node, an old account is 'at least 1 day' and not penalised", async () => {
    const rpc = fakeNode({ created: H - 30 * BLOCKS_PER_DAY });
    const s = await gatherSignals(rpc, { ...base });
    expect(s.accountAgeDays).toBe(7);
  });
  it("if the node cannot serve past blocks, age stays not-collected (null)", async () => {
    const rpc = fakeNode({ created: H - 30 * BLOCKS_PER_DAY, oldBlocksUnavailable: true });
    const s = await gatherSignals(rpc, { ...base, archival: rpc });
    expect(s.accountAgeDays).toBeNull();
    expect(s.lookupFailed).toBe(false);
  });
  it("account that does not exist is flagged and not looked up further", async () => {
    const rpc = fakeNode({});
    const s = await gatherSignals(rpc, { ...base, archival: rpc });
    expect(s.exists).toBe(false);
    expect(s.accountAgeDays).toBeNull();
  });
});

describe("gatherSignals: contract code change", () => {
  const CODE_A = "AAAA", CODE_B = "BBBB";
  it("unchanged contract code is not flagged", async () => {
    const rpc = fakeNode({ created: H - 30 * BLOCKS_PER_DAY, codeHashAt: () => CODE_A });
    const s = await gatherSignals(rpc, { ...base, archival: rpc });
    expect(s.isContract).toBe(true);
    expect(s.codeChangedDaysAgo).toBe(30);
  });
  it("contract whose code changed in the last 2 days is flagged", async () => {
    const rpc = fakeNode({
      created: H - 30 * BLOCKS_PER_DAY,
      codeHashAt: (at) => (at < H - BLOCKS_PER_DAY ? CODE_A : CODE_B),
    });
    const s = await gatherSignals(rpc, { ...base, archival: rpc });
    expect(s.codeChangedDaysAgo).toBe(1);
  });
});

describe("gatherSignals: blocklist", () => {
  it("marks reports that paid the fee as staked, and others as not", async () => {
    const rpc = fakeNode({
      created: H - 30 * BLOCKS_PER_DAY,
      reports: [
        { reporter: "paid.testnet", evidence: "tx:1", stake: "100000000000000000000000" },
        { reporter: "free.testnet", evidence: "tx:2" },
      ],
    });
    const s = await gatherSignals(rpc, { ...base, archival: rpc });
    expect(s.blocklistReports).toHaveLength(2);
    expect(s.blocklistReports[0].staked).toBe(true);
    expect(s.blocklistReports[1].staked).toBe(false);
  });
});
