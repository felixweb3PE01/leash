// Generates a fresh keypair for the agent and saves the PRIVATE key to .env
// (git-ignored). Prints only the public key, which is safe to share.
import { KeyPair } from "near-api-js";
import { existsSync, writeFileSync } from "node:fs";

if (existsSync(".env")) {
  console.error(".env already exists. Delete it first if you really want a new key.");
  process.exit(1);
}
const kp = KeyPair.fromRandom("ed25519");
writeFileSync(
  ".env",
  [
    `LEASH_AGENT_KEY=${kp.toString()}`,
    "LEASH_AGENT_ID=agent-leash7.testnet",
    "LEASH_GUARD_ID=guard-leash7.testnet",
    "",
  ].join("\n"),
);
console.log("Saved the private key to .env (never share or commit that file).");
console.log("PUBLIC KEY:", kp.getPublicKey().toString());
