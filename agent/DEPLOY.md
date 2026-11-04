# Reproduce the live demo on your own testnet accounts

You need `near-cli-rs` (`npm install -g near-cli-rs`), Node 22+, and testnet accounts for: owner, guard (contract), agent, merchant, scammer. Create each with `near create-account NAME.testnet --useFaucet`.

1. Build the contract: `cd contract && npm install && npm run build` (output: `build/guard.wasm`).
2. Deploy: `near contract deploy GUARD use-file build/guard.wasm without-init-call network-config testnet sign-with-keychain send`.
3. Initialise (limits are in yoctoNEAR): call `init` with `{"owner","maxPerTx","maxPerDay"}`.
4. As owner: `addAgent` with the agent account, `allowReceiver` with the merchant.
5. Fund the guard account with testnet NEAR (it holds the money).
6. Generate the agent key: `cd agent && npm install && npx tsx src/genkey.ts`. This writes the private key to `.env` and prints the public key. Edit the account names in `.env` to match yours.
7. Give the agent account a function-call key restricted to `pay`:
   `near account add-key AGENT grant-function-call-access --allowance '2 NEAR' --contract-account-id GUARD --function-names pay use-manually-provided-public-key PUBLIC_KEY network-config testnet sign-with-keychain send`
8. Remove the agent's original full-access key so only the restricted key remains:
   `near account delete-key AGENT public-key OLD_FULL_ACCESS_KEY network-config testnet sign-with-keychain send`
9. Report the scammer from two different accounts. Each report must attach the 0.1 NEAR fee:
   `near contract call-function as-transaction GUARD report json-args '{"account":"SCAMMER","evidence":"your evidence"}' prepaid-gas '30.0 Tgas' attached-deposit '0.1 NEAR' sign-as REPORTER network-config testnet sign-with-keychain send`
10. Run `npx tsx src/demo.ts`.
