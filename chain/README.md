# chain/ — on-chain verifier and JS reference (SHARED SPEC v1)

- `contracts/SmtVerifier.sol` — depth-256 keccak256 SMT proof verification (bitmap + siblings).
- `contracts/ChainTraceRegistry.sol` — owner publishes one root per epoch; anyone can call
  `verifyScore` / `verifyAbsent` with a proof from `python -m src.mst.export`.
- `src/smt.js` — JS verifier (ethers `keccak256`), same logic as the contract and the Python reference.
- `test/vectors.test.js` — every case in `../tests/vectors/smt_vectors.json` must agree in JS **and** Solidity.

```
npm install
npx hardhat test
```

Deploy (needs a funded MST testnet key in `MST_PRIVATE_KEY`; the script reads `eth_chainId` from the node):

```
npx hardhat run scripts/deploy.js --network mst
EPOCH=1 ROOT=0x<root from outputs/mst/latest_root.json> npx hardhat run scripts/deploy.js --network mst
```

Deployer wallet (MST testnet, funded with 10 MST, no transactions yet): `0x376299fD751DF962354bc1F0a235e85615F5eED3`.
Only the address is recorded here; the private key stays in your shell as `MST_PRIVATE_KEY`.
