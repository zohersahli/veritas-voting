import type { HardhatUserConfig } from "hardhat/config";
import hardhatEthers from "@nomicfoundation/hardhat-ethers";
import hardhatIgnition from "@nomicfoundation/hardhat-ignition";
import hardhatToolboxMochaEthers from "@nomicfoundation/hardhat-toolbox-mocha-ethers";
import * as dotenv from "dotenv";

dotenv.config();

// -----------------------------------------------------------------------------
// Future Notes for the Project:
// -----------------------------------------------------------------------------
// 1) hardhat-verify can be added later for contract verification on Etherscan.
//
// 2) Custom optimizer profiles can be added for production deployments.
//
// 3) Additional L2 networks (Optimism / Arbitrum) can be added for scaling.
//
// 4) Hardhat v3 is compatible with Foundry — Forge tests can be added later.
//
// 5) PRIVATE_KEY must belong to a testnet account only.
//
// 6) RPC URLs from Alchemy will be added in the .env file later.
// -----------------------------------------------------------------------------

const config: HardhatUserConfig = {
  plugins: [hardhatEthers, hardhatIgnition ,
    hardhatToolboxMochaEthers],
  solidity: {
    version: "0.8.31", // Primary Solidity version
    settings: {
      optimizer: {
        enabled: true,   // Enable optimizer
        runs: 200,       // Suitable for governance contracts

      },
      viaIR: true, // Additional optimization via IR
    },
  },

  networks: {
    // -------------------------------------------------------------------------
    // Local simulated network for testing
    // Hardhat provides a fast local L1 network for testing.
    // -------------------------------------------------------------------------
    hardhat: {
      type: "edr-simulated",
      chainType: "l1",
    },

    localhost: {
      type: "http",
      chainType: "l1",
      url: "http://127.0.0.1:8545",
      //accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
      accounts: {
      mnemonic: "test test test test test test test test test test test junk",
      count: 10,
      },
    },

    


    // -------------------------------------------------------------------------
    // Ethereum Sepolia — Layer 1
    // This is where final voting results are stored on L1.
    // -------------------------------------------------------------------------
    ethereumSepolia: {
      type: "http",
      chainType: "l1",
      url: process.env.ETHEREUM_SEPOLIA_RPC_URL || "", // RPC URL from Alchemy
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [], // Testnet private key
    },

    // -------------------------------------------------------------------------
    // Base Sepolia — Layer 2
    // Base uses Optimism Stack → chainType must be "op".
    // -------------------------------------------------------------------------
    baseSepolia: {
      type: "http",
      chainType: "op", // Base is OP Stack — important for correct config
      url: process.env.BASE_SEPOLIA_RPC_URL || "", // RPC for Base Sepolia
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [], // Same testnet account
    },

    // -------------------------------------------------------------------------
    // Note: You can add additional networks later such as Optimism / Arbitrum.
    // -------------------------------------------------------------------------
  },
};

export default config;
