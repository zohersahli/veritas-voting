import { network } from "hardhat";

async function main() {
  const { ethers } = await network.connect();

  // Safety switch: prevent accidental testnet deploy
  // مفتاح أمان: يمنع النشر على testnet بالغلط
  const confirm = (process.env.CONFIRM_TESTNET_DEPLOY ?? "").trim();

const netName = (process.env.HARDHAT_NETWORK ?? "hardhat").trim();

  // Allow local hardhat deploys always
  // السماح دائما بالنشر المحلي على hardhat
  const isLocal = netName === "hardhat" || netName === "hardhatMainnet" || netName === "hardhatOp";

  // If it's a real testnet (like baseSepolia), require confirmation
  // إذا كانت شبكة حقيقية مثل baseSepolia, لازم تأكيد يدوي
  if (!isLocal) {
    if (confirm !== "YES") {
      throw new Error(
        `Refusing to deploy to "${netName}". Set CONFIRM_TESTNET_DEPLOY="YES" in .env to allow.`
      );
    }
  }

  const VeritasCore = await ethers.getContractFactory("VeritasCore");
  const core = await VeritasCore.deploy();
  await core.waitForDeployment();

  const coreAddress = await core.getAddress();
  console.log(`Network: ${netName}`);
  console.log("VeritasCore (L2):", coreAddress);
  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
