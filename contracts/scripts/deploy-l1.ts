import { network } from "hardhat";
import { saveDeployment } from "./utils/saveDeployment";

function getNetworkNameFromArgs(): string {
  const idx = process.argv.indexOf("--network");
  if (idx !== -1 && process.argv[idx + 1]) return String(process.argv[idx + 1]).trim();
  return "";
}

async function main() {
  const { ethers } = await network.connect();

 // Best-effort network name (CLI first, then env, else fallback)
  const cliName = getNetworkNameFromArgs();
  const envName = (process.env.HARDHAT_NETWORK ?? "").trim();
  const networkName = cliName || envName || "hardhat";

  // Real chainId from provider
  const netInfo = await ethers.provider.getNetwork();
  const chainId = netInfo.chainId;


  // -----------------------------
  // Read config from .env
  // -----------------------------
  const treasury = process.env.TREASURY_ADDRESS ?? "";
  const compensationStr = process.env.EXECUTOR_COMPENSATION_WEI ?? "";

  if (!treasury || !ethers.isAddress(treasury) || treasury === "0x0000000000000000000000000000000000000000") {
  throw new Error("TREASURY_ADDRESS must be a valid 0x address");
 }

  if (!compensationStr) {
    throw new Error("Missing EXECUTOR_COMPENSATION_WEI in .env");
  }

  const executorCompensation = BigInt(compensationStr);

  // -----------------------------
  // Deploy PlatformConfig
  // -----------------------------
  const PlatformConfig = await ethers.getContractFactory("PlatformConfig");
  const platformConfig = await PlatformConfig.deploy(treasury, executorCompensation);
  await platformConfig.waitForDeployment();

  const platformConfigAddress = await platformConfig.getAddress();
  console.log("PlatformConfig:", platformConfigAddress);

  // -----------------------------
  // Deploy L1ResultRegistry
  // -----------------------------
  const L1ResultRegistry = await ethers.getContractFactory("L1ResultRegistry");
  const l1ResultRegistry = await L1ResultRegistry.deploy();
  await l1ResultRegistry.waitForDeployment();

  const registryAddress = await l1ResultRegistry.getAddress();
  console.log("L1ResultRegistry:", registryAddress);

  // -----------------------------
  // Deploy L1FinalizationEscrow
  // -----------------------------
  const L1FinalizationEscrow = await ethers.getContractFactory("L1FinalizationEscrow");
  const escrow = await L1FinalizationEscrow.deploy(platformConfigAddress);
  await escrow.waitForDeployment();

  const escrowAddress = await escrow.getAddress();
  console.log("L1FinalizationEscrow:", escrowAddress);

  // -----------------------------
  // Save deployment
  // -----------------------------
  const savedPath = await saveDeployment({
    network: networkName,
    chainId,
    layer: "l1",
    contracts: {
      PlatformConfig: platformConfigAddress,
      L1ResultRegistry: registryAddress,
      L1FinalizationEscrow: escrowAddress,
    },
  });

  console.log(`Network: ${networkName}`);
  console.log(`ChainId: ${chainId.toString()}`);
  console.log("Saved:", savedPath);
  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
