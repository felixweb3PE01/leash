// Minimal read-only NEAR JSON-RPC client (plain fetch, no signing).
export const DEFAULT_RPC = "https://test.rpc.fastnear.com";

export interface AccountView {
  exists: boolean;
  isContract: boolean;
  codeHash: string | null;
}

export type Rpc = <T = any>(method: string, params: object) => Promise<T>;

export function makeRpc(url: string = DEFAULT_RPC): Rpc {
  return async function rpc<T = any>(method: string, params: object): Promise<T> {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: "leash", method, params }),
    });
    if (!res.ok) throw new Error(`RPC HTTP ${res.status}`);
    const body: any = await res.json();
    if (body.error) {
      const e = new Error(JSON.stringify(body.error));
      (e as any).rpcError = body.error;
      throw e;
    }
    return body.result as T;
  };
}

const ZERO_HASH = "11111111111111111111111111111111";

export async function latestHeight(rpc: Rpc): Promise<number> {
  const r: any = await rpc("block", { finality: "final" });
  return Number(r.header.height);
}

// blockId = a block height to look at the past; omit for the latest state.
export async function viewAccount(
  rpc: Rpc,
  accountId: string,
  blockId?: number,
): Promise<AccountView> {
  try {
    const r: any = await rpc("query", {
      request_type: "view_account",
      ...(blockId === undefined ? { finality: "final" } : { block_id: blockId }),
      account_id: accountId,
    });
    const has = r.code_hash && r.code_hash !== ZERO_HASH;
    return { exists: true, isContract: !!has, codeHash: has ? r.code_hash : null };
  } catch (e: any) {
    const err = e.rpcError;
    const name = err?.cause?.name ?? err?.name ?? "";
    const text = JSON.stringify(err ?? "");
    if (name === "UNKNOWN_ACCOUNT" || text.includes("does not exist")) {
      return { exists: false, isContract: false, codeHash: null };
    }
    throw e; // network or other failure: caller decides (treated as lookupFailed)
  }
}

export async function viewFunction<T = any>(
  rpc: Rpc,
  contractId: string,
  methodName: string,
  args: object = {},
): Promise<T> {
  const r: any = await rpc("query", {
    request_type: "call_function",
    finality: "final",
    account_id: contractId,
    method_name: methodName,
    args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
  });
  return JSON.parse(Buffer.from(r.result).toString("utf8")) as T;
}
