require("@nomicfoundation/hardhat-ethers");

// MST testnet. chainId is deliberately NOT hard-coded: scripts/deploy.js asks the node
// (eth_chainId) and uses what it returns. Set MST_PRIVATE_KEY in your shell to deploy.
const MST_RPC = process.env.MST_RPC || "https://testnetrpc.mstblockchain.com";

module.exports = {
  solidity: { version: "0.8.24", settings: { optimizer: { enabled: true, runs: 200 } } },
  networks: {
    mst: {
      url: MST_RPC,
      accounts: process.env.MST_PRIVATE_KEY ? [process.env.MST_PRIVATE_KEY] : [],
    },
  },
};
