import type { HardhatUserConfig } from "hardhat/config";
import hardhatEthers from "@nomicfoundation/hardhat-ethers";
import hardhatIgnition from "@nomicfoundation/hardhat-ignition";
import hardhatToolboxMochaEthers from "@nomicfoundation/hardhat-toolbox-mocha-ethers";
import * as dotenv from "dotenv";


dotenv.config();

// -----------------------------------------------------------------------------
// Coverage-specific configuration
//  This config uses Solidity 0.8.30 for coverage compatibility.
//  هذا الإعداد يستخدم Solidity 0.8.30 لتوافق coverage.
// -----------------------------------------------------------------------------
// NOTE: Use this config only for coverage: npx hardhat coverage --config hardhat.coverage.config.ts
//  Coverage tool currently doesn't support Solidity 0.8.31, so we use 0.8.30 here.
//  أداة coverage لا تدعم Solidity 0.8.31 حالياً، لذا نستخدم 0.8.30 هنا.
// -----------------------------------------------------------------------------

const config: HardhatUserConfig = {
  plugins: [hardhatEthers, hardhatIgnition, hardhatToolboxMochaEthers],
  solidity: {
    version: "0.8.30", // Coverage-compatible version — نسخة متوافقة مع coverage
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
      viaIR: true,
    },
  },

  networks: {
    // -------------------------------------------------------------------------
    // Local network for testing
    // -------------------------------------------------------------------------
    hardhat: {
      type: "edr-simulated",
      chainType: "l1",
    },

    localhost: {
      type: "http",
      chainType: "l1",
      url: "http://127.0.0.1:8545",
      accounts: {
        mnemonic: "test test test test test test test test test test test junk",
        count: 10,
      },
    },

    // -------------------------------------------------------------------------
    // Ethereum Sepolia — Layer 1
    // -------------------------------------------------------------------------
    ethereumSepolia: {
      type: "http",
      chainType: "l1",
      url: process.env.ETHEREUM_SEPOLIA_RPC_URL || "",
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
    },

    // -------------------------------------------------------------------------
    // Base Sepolia — Layer 2
    // -------------------------------------------------------------------------
    baseSepolia: {
      type: "http",
      chainType: "op",
      url: process.env.BASE_SEPOLIA_RPC_URL || "",
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
    },
  },
};

export default config;


