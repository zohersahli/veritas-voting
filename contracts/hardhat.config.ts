import type { HardhatUserConfig } from "hardhat/config";
import hardhatEthers from "@nomicfoundation/hardhat-ethers";
import hardhatIgnition from "@nomicfoundation/hardhat-ignition";
import * as dotenv from "dotenv";

dotenv.config();

// -----------------------------------------------------------------------------
// ملاحظات مستقبلية للمشروع / Future Notes for the Project:
// -----------------------------------------------------------------------------
// 1) يمكن إضافة hardhat-verify للتحقق على Etherscan عند الإطلاق النهائي.
//    hardhat-verify can be added later for contract verification on Etherscan.
//
// 2) يمكن إضافة ملف Optimizer خاص للإنتاج عند اقتراب موعد الإطلاق.
//    Custom optimizer profiles can be added for production deployments.
//
// 3) يمكن إضافة شبكات L2 إضافية لاحقاً مثل Optimism أو Arbitrum.
//    Additional L2 networks (Optimism / Arbitrum) can be added for scaling.
//
// 4) Hardhat v3 يدعم Foundry — يمكن كتابة اختبارات Forge في test/ لاحقاً.
//    Hardhat v3 is compatible with Foundry — Forge tests can be added later.
//
// 5) PRIVATE_KEY يجب أن يكون لحساب testnet فقط.
//    PRIVATE_KEY must belong to a testnet account only.
//
// 6) RPC URLs الخاصة بـ Alchemy ستضاف لاحقاً في ملف .env.
//    RPC URLs from Alchemy will be added in the .env file later.
// -----------------------------------------------------------------------------

const config: HardhatUserConfig = {
  plugins: [hardhatEthers, hardhatIgnition],
  solidity: {
    version: "0.8.31", // نسخة Solidity الأساسية — Primary Solidity version
    settings: {
      optimizer: {
        enabled: true,   // تفعيل المُحسّن — Enable optimizer
        runs: 200,       // إعداد مناسب لعقود الحوكمة — Suitable for governance contracts

      },
    },
  },

  networks: {
    // -------------------------------------------------------------------------
    // شبكة محلية للاختبار — Local simulated network for testing
    // Hardhat يوفر شبكة L1 افتراضية سريعة جداً للاختبارات.
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
    // هنا يتم تخزين نتيجة التصويت النهائية (Finalization Layer).
    // This is where final voting results are stored on L1.
    // -------------------------------------------------------------------------
    ethereumSepolia: {
      type: "http",
      chainType: "l1",
      url: process.env.ETHEREUM_SEPOLIA_RPC_URL || "", // رابط عقدة Alchemy — RPC URL from Alchemy
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [], // المفتاح الخاص لحساب الاختبار — Testnet private key
    },

    // -------------------------------------------------------------------------
    // Base Sepolia — Layer 2
    // هنا يتم تنفيذ التصويت الأساسي (Voting Layer).
    // Base uses Optimism Stack → chainType must be "op".
    // -------------------------------------------------------------------------
    baseSepolia: {
      type: "http",
      chainType: "op", // Base is OP Stack — important for correct config
      url: process.env.BASE_SEPOLIA_RPC_URL || "", // رابط عقدة L2 — RPC for Base Sepolia
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [], // نفس الحساب المستخدم على L1 — Same testnet account
    },

    // -------------------------------------------------------------------------
    // ملاحظة: يمكن إضافة شبكات أخرى مثل Optimism / Arbitrum لاحقاً.
    // Note: You can add additional networks later such as Optimism / Arbitrum.
    // -------------------------------------------------------------------------
  },
};

export default config;
