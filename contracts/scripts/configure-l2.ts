import { network } from "hardhat";
import fs from "node:fs";

/*
AR: Configure L2 ACK allowlist after deployments.
EN: Configure L2 ACK allowlist after deployments.

What it does:
- VeritasCore.setAckConfig(sourceSelector=L1 selector, sender=L1 receiver registry)
*/

function requireEnv(name: string): string {
  const v = (process.env[name] ?? "").trim();
  if (!v) throw new Error(`Missing ${name} in .env`);
  return v;
}

function optionalEnv(name: string): string {
  return (process.env[name] ?? "").trim();
}

function readDeployment(path: string): any | null {
  try {
    return JSON.parse(fs.readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function getAddrFromFileOrEnv(envName: string, filePath: string, pointer: string[]): string {
  const direct = optionalEnv(envName);
  if (direct) return direct;

  const dep = readDeployment(filePath);
  let cur: any = dep;
  for (const key of pointer) {
    cur = cur?.[key];
  }
  if (!cur) {
    throw new Error(`Missing ${envName}, and could not find ${pointer.join(".")} in ${filePath}`);
  }
  return String(cur).trim();
}

async function main() {
  const { ethers } = await network.connect();
  const [deployer] = await ethers.getSigners();

  // L2 VeritasCore address (Base Sepolia)
  const l2VeritasAddr = getAddrFromFileOrEnv(
    "L2_VERITASCORE_ADDRESS",
    "./deployments/baseSepolia.json",
    ["l2", "VeritasCore"]
  );

  // L1 receiver registry address (Ethereum Sepolia)
  const l1ReceiverAddr = getAddrFromFileOrEnv(
    "L1_RECEIVER_REGISTRY_ADDRESS",
    "./deployments/ethereumSepolia.json",
    ["l1", "VeritasCcipReceiverRegistry"]
  );

  // CCIP_DEST_CHAIN_SELECTOR = L1 selector (used by L2 when sending to L1)
  // For ACK verification on L2, ACK source selector must be L1 selector.
  const l1Selector = BigInt(requireEnv("CCIP_DEST_CHAIN_SELECTOR"));

  console.log("\n--- configure-l2.ts ---");
  console.log("Deployer:", deployer.address);
  console.log("L2 VeritasCore:", l2VeritasAddr);
  console.log("L1 Receiver Registry (ACK sender):", l1ReceiverAddr);
  console.log("L1 selector (ACK source):", l1Selector.toString());

  const veritas = await ethers.getContractAt("VeritasCore", l2VeritasAddr);

  console.log("\n1) setAckConfig(sourceSelector=L1, sender=L1Receiver) on L2...");
  const tx = await (veritas as any).setAckConfig(l1Selector, l1ReceiverAddr);
  await tx.wait();

  console.log("OK: ACK allowlist set on L2");
  console.log("\nDone configure-l2.ts");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
