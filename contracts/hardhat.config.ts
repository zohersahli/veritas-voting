import type { HardhatUserConfig } from "hardhat/config";
import hardhatEthers from "@nomicfoundation/hardhat-ethers";
import hardhatIgnition from "@nomicfoundation/hardhat-ignition";
import hardhatToolboxMochaEthers from "@nomicfoundation/hardhat-toolbox-mocha-ethers";
import hardhatVerify from "@nomicfoundation/hardhat-verify";
import * as dotenv from "dotenv";

dotenv.config();

const config: HardhatUserConfig = {
  plugins: [hardhatEthers, hardhatIgnition ,
    hardhatToolboxMochaEthers, hardhatVerify],
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
  verify: {
    etherscan: {
      apiKey: process.env.ETHERSCAN_API_KEY || "",
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

  },
};

export default config;
