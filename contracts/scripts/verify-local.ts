import { network } from "hardhat";
import fs from "node:fs";
import path from "node:path";

type Deployments = {
  network: string;
  chainId: number;
  l1?: {
    PlatformConfig?: string;
    L1ResultRegistry?: string;
    L1FinalizationEscrow?: string;
  };
  l2?: {
    VeritasCore?: string;
  };
};

function mustAddress(label: string, v: unknown): string {
  if (typeof v !== "string") throw new Error(`${label} missing in deployments file`);
  return v;
}

async function main() {
  const { ethers } = await network.connect();

  const net = await ethers.provider.getNetwork();
  const chainId = Number(net.chainId);

  const deploymentsPath = path.join(process.cwd(), "deployments", "localhost.json");
  if (!fs.existsSync(deploymentsPath)) {
    throw new Error(`Missing deployments file: ${deploymentsPath}. Run deploy-l1 and deploy-l2 first.`);
  }

  const raw = fs.readFileSync(deploymentsPath, "utf-8");
  const d = JSON.parse(raw) as Deployments;

  console.log(`Network: localhost`);
  console.log(`ChainId: ${chainId}`);

  const pcAddr = mustAddress("l1.PlatformConfig", d.l1?.PlatformConfig);
  const coreAddr = mustAddress("l2.VeritasCore", d.l2?.VeritasCore);

  // 1) Ensure contracts actually exist on-chain (code length > 2)
  const pcCode = await ethers.provider.getCode(pcAddr);
  const coreCode = await ethers.provider.getCode(coreAddr);

  if (pcCode === "0x") throw new Error(`PlatformConfig has no code at ${pcAddr}`);
  if (coreCode === "0x") throw new Error(`VeritasCore has no code at ${coreAddr}`);

  // 2) Read a few critical values from PlatformConfig
  const pc = await ethers.getContractAt("PlatformConfig", pcAddr);

  const treasury = await pc.treasury();
  const owner = await pc.owner();
  const feeSuccess = await pc.feeOnSuccessBps();
  const feeRefund = await pc.feeOnFailedRefundBps();
  const execComp = await pc.executorCompensation();

  console.log("PlatformConfig:", pcAddr);
  console.log("  treasury:", treasury);
  console.log("  owner:", owner);
  console.log("  feeOnSuccessBps:", feeSuccess.toString());
  console.log("  feeOnFailedRefundBps:", feeRefund.toString());
  console.log("  executorCompensation:", execComp.toString());

  console.log("VeritasCore:", coreAddr);
  console.log("OK: deployments look valid.");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
