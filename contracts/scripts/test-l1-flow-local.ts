// scripts/test-l1-flow-local.ts
//
// What this script does (English):
// 1) Loads L1 contract addresses from deployments/<network>.json
// 2) Uses available signers (works even if you only have 1 signer on localhost)
// 3) Deposits for (groupId, pollId) into L1FinalizationEscrow
// 4) Calls L1ResultRegistry.recordResult(..., Success, resultHash)
// 5) Verifies deposit becomes settled and prints balances before/after
//
// ماذا يفعل هذا السكربت (بالعربية):
// 1) يقرأ عناوين عقود L1 من deployments/<network>.json
// 2) يستخدم الحسابات المتاحة (يعمل حتى لو عندك حساب واحد فقط على localhost)
// 3) يعمل deposit لـ (groupId, pollId) داخل L1FinalizationEscrow
// 4) ينفذ recordResult (Success) داخل L1ResultRegistry
// 5) يتأكد أن الإيداع صار settled ويطبع الأرصدة قبل وبعد
//
// Note (English):
// - Balance deltas include gas costs.
// ملاحظة (بالعربية):
// - فرق الأرصدة يشمل تكلفة الغاز.

import { network } from "hardhat";
import fs from "node:fs";
import path from "node:path";

function getNetworkNameFromArgs(): string {
  const idx = process.argv.indexOf("--network");
  if (idx !== -1 && process.argv[idx + 1]) return String(process.argv[idx + 1]).trim();
  return "";
}

function pickAddress(obj: any, key: string): string {
  const candidates = [
    obj?.l1?.[key],
    obj?.l1?.contracts?.[key],
    obj?.contracts?.[key],
    obj?.[key],
  ];

  const found = candidates.find((v) => typeof v === "string" && v.startsWith("0x") && v.length === 42);
  if (!found) throw new Error(`Missing address for ${key} in deployments file`);
  return found;
}

async function main() {
  const { ethers } = await network.connect();

  // Best-effort network name (CLI first, then env, else fallback)
  const cliName = getNetworkNameFromArgs();
  const envName = (process.env.HARDHAT_NETWORK ?? "").trim();
  const networkName = cliName || envName || "hardhat";

  const deploymentsPath = path.join(process.cwd(), "deployments", `${networkName}.json`);
  if (!fs.existsSync(deploymentsPath)) {
    throw new Error(`Deployments file not found: ${deploymentsPath}`);
  }
  const deployments = JSON.parse(fs.readFileSync(deploymentsPath, "utf-8"));

  const platformConfigAddr = pickAddress(deployments, "PlatformConfig");
  const escrowAddr = pickAddress(deployments, "L1FinalizationEscrow");
  const registryAddr = pickAddress(deployments, "L1ResultRegistry");

  // Cast to any to avoid TS "BaseContract" type errors (no TypeChain)
  // Arabic: نعمل cast لأننا لا نستخدم TypeChain حاليا
  const platformConfig: any = await ethers.getContractAt("PlatformConfig", platformConfigAddr);
  const escrow: any = await ethers.getContractAt("L1FinalizationEscrow", escrowAddr);
  const registry: any = await ethers.getContractAt("L1ResultRegistry", registryAddr);

  const signers = await ethers.getSigners();

  // Works even if only 1 signer is available.
  // Arabic: يعمل حتى لو عندك حساب واحد فقط
  const creator = signers[1] ?? signers[0];
  const executor = signers[2] ?? signers[0];

  const treasury: string = await platformConfig.treasury();

  console.log("Network:", networkName);
  console.log("PlatformConfig:", platformConfigAddr);
  console.log("Escrow:", escrowAddr);
  console.log("Registry:", registryAddr);
  console.log("Treasury:", treasury);
  console.log("Creator:", creator.address);
  console.log("Executor:", executor.address);

  // Choose IDs
  let groupId = 1n;
  let pollId = 1n;

  // Compute key = keccak256(abi.encode(groupId, pollId))
  const coder = ethers.AbiCoder.defaultAbiCoder();
  const makeKey = (g: bigint, p: bigint) => ethers.keccak256(coder.encode(["uint256", "uint256"], [g, p]));

  // Pick a free (groupId, pollId)
  for (let i = 0; i < 50; i++) {
    const k = makeKey(groupId, pollId);
    const d = await escrow.deposits(k);
    const amount: bigint = d[1];
    if (amount === 0n) break;
    pollId += 1n;
  }

  const key = makeKey(groupId, pollId);

  // Deposit value
  const depositValue = ethers.parseEther("0.01");

  const bal = async (addr: string) => ethers.provider.getBalance(addr);
  const fmt = (v: bigint) => ethers.formatEther(v);

  const beforeTreasury = await bal(treasury);
  const beforeCreator = await bal(creator.address);
  const beforeExecutor = await bal(executor.address);

  console.log("\n== Before ==");
  console.log("Treasury balance:", fmt(beforeTreasury));
  console.log("Creator balance :", fmt(beforeCreator));
  console.log("Executor balance:", fmt(beforeExecutor));

  // 1) Deposit (creator)
  console.log("\n== 1) depositForPoll ==");
  const tx1 = await escrow.connect(creator).depositForPoll(groupId, pollId, { value: depositValue });
  await tx1.wait();

  const depAfter = await escrow.deposits(key);
  console.log("Deposit key:", key);
  console.log("Deposit.creator:", depAfter[0]);
  console.log("Deposit.amount :", depAfter[1].toString());
  console.log("Deposit.settled:", depAfter[2]);

  // 2) Record result (executor) with Success (enum 0)
  console.log("\n== 2) recordResult (Success) ==");
  const resultHash = ethers.keccak256(ethers.toUtf8Bytes(`demo-result:${Date.now()}`));
  const tx2 = await registry.connect(executor).recordResult(groupId, pollId, 0, resultHash);
  await tx2.wait();

  const depFinal = await escrow.deposits(key);
  console.log("Deposit.settled after record:", depFinal[2]);

  const isRecorded: boolean = await registry.recorded(key);
  console.log("Registry.recorded(key):", isRecorded);

  const afterTreasury = await bal(treasury);
  const afterCreator = await bal(creator.address);
  const afterExecutor = await bal(executor.address);

  console.log("\n== After ==");
  console.log("Treasury balance:", fmt(afterTreasury));
  console.log("Creator balance :", fmt(afterCreator));
  console.log("Executor balance:", fmt(afterExecutor));

  console.log("\n== Delta (includes gas) ==");
  console.log("Treasury delta:", fmt(afterTreasury - beforeTreasury));
  console.log("Creator delta :", fmt(afterCreator - beforeCreator));
  console.log("Executor delta:", fmt(afterExecutor - beforeExecutor));

    // -----------------------------
  // 3) FailedQuorum scenario (status = 1)
  // -----------------------------
  console.log("\n== 3) FailedQuorum scenario ==");

  // Use a new pollId to avoid AlreadyDeposited / AlreadyRecorded
  pollId += 1n;
  const key2 = makeKey(groupId, pollId);

  const beforeTreasury2 = await bal(treasury);
  const beforeCreator2 = await bal(creator.address);

  console.log("\n== Before (FailedQuorum) ==");
  console.log("Treasury balance:", fmt(beforeTreasury2));
  console.log("Creator balance :", fmt(beforeCreator2));

  // Deposit again
  const tx3 = await escrow.connect(creator).depositForPoll(groupId, pollId, { value: depositValue });
  await tx3.wait();

  const depAfter2 = await escrow.deposits(key2);
  console.log("Deposit2.settled:", depAfter2[2]);

  // Record result with FailedQuorum (enum 1)
  const resultHash2 = ethers.keccak256(ethers.toUtf8Bytes(`demo-failed:${Date.now()}`));
  const tx4 = await registry.connect(executor).recordResult(groupId, pollId, 1, resultHash2);
  await tx4.wait();

  const depFinal2 = await escrow.deposits(key2);
  console.log("Deposit2.settled after record:", depFinal2[2]);

  const afterTreasury2 = await bal(treasury);
  const afterCreator2 = await bal(creator.address);

  console.log("\n== After (FailedQuorum) ==");
  console.log("Treasury balance:", fmt(afterTreasury2));
  console.log("Creator balance :", fmt(afterCreator2));

  console.log("\n== Delta (FailedQuorum, includes gas) ==");
  console.log("Treasury delta:", fmt(afterTreasury2 - beforeTreasury2)); // expected ~0.0003 (3% of 0.01)
  console.log("Creator delta :", fmt(afterCreator2 - beforeCreator2));   // expected ~ +0.0097 minus gas


  console.log("\nDone.");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
