// Signing layer. The agent signs with a FUNCTION-CALL key restricted to the
// guard contract's `pay` method, never a full-access key.
import { connect, keyStores, KeyPair } from "near-api-js";
import { PayRequest } from "./wrapper";

export interface SendConfig {
  agentId: string;
  guardId: string;
  privateKey: string; // function-call key, from env, never committed
  nodeUrl: string;
}

const GAS_30T = 30_000_000_000_000n;

async function agentAccount(cfg: SendConfig) {
  const keyStore = new keyStores.InMemoryKeyStore();
  await keyStore.setKey("testnet", cfg.agentId, KeyPair.fromString(cfg.privateKey as any));
  const near = await connect({ networkId: "testnet", nodeUrl: cfg.nodeUrl, keyStore });
  return near.account(cfg.agentId);
}

export function makeSendPay(cfg: SendConfig) {
  return async (req: PayRequest): Promise<{ ok: boolean; reason: string; txHash?: string }> => {
    const account = await agentAccount(cfg);
    const outcome: any = await account.functionCall({
      contractId: cfg.guardId,
      methodName: "pay",
      args: { receiver: req.receiver, amount: req.amount },
      gas: GAS_30T,
      attachedDeposit: 0n,
    });
    const raw = outcome?.status?.SuccessValue as string | undefined;
    const result = raw ? JSON.parse(Buffer.from(raw, "base64").toString("utf8")) : { ok: false, reason: "no return value" };
    return { ok: !!result.ok, reason: String(result.reason), txHash: outcome?.transaction?.hash };
  };
}

// Attack: the agent tries to move NEAR out of its own account directly,
// skipping the guard. A function-call-only key must be rejected by the protocol.
export async function attemptDirectTransfer(
  cfg: SendConfig,
  to: string,
  amountYocto: bigint,
): Promise<{ rejected: boolean; message: string }> {
  try {
    const account = await agentAccount(cfg);
    await account.sendMoney(to, amountYocto);
    return { rejected: false, message: "transfer succeeded (the agent key is too powerful!)" };
  } catch (e: any) {
    return { rejected: true, message: String(e?.message ?? e).split("\n")[0].slice(0, 200) };
  }
}
