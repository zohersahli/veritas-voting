import { network } from "hardhat";

function getNetworkNameFromArgs(): string {
  const idx = process.argv.indexOf("--network");
  if (idx !== -1 && process.argv[idx + 1]) return String(process.argv[idx + 1]).trim();
  return "";
}

async function main() {
  const { ethers } = await network.connect();

  // Real chainId from provider
  const netInfo = await ethers.provider.getNetwork();
  const chainId = netInfo.chainId; // bigint (ethers v6)

  // Best-effort network name (CLI first, then env, else fallback)
  const cliName = getNetworkNameFromArgs();
  const envName = (process.env.HARDHAT_NETWORK ?? "").trim();
  const networkName = cliName || envName || "hardhat";

  // Local detection
  const isLocalByName = networkName.startsWith("hardhat");
  const isLocalByChainId = chainId === 31337n;
  const isLocal = isLocalByName || isLocalByChainId;

  // Safety switch
  const confirm = (process.env.CONFIRM_TESTNET_DEPLOY ?? "").trim();
  if (!isLocal && confirm !== "YES") {
    throw new Error(
      `Refusing to deploy. network="${networkName}", chainId=${chainId.toString()}. ` +
        `Set CONFIRM_TESTNET_DEPLOY="YES" in .env to allow.`
    );
  }

  const VeritasCore = await ethers.getContractFactory("VeritasCore");
  const core = await VeritasCore.deploy();
  await core.waitForDeployment();

  const coreAddress = await core.getAddress();
  console.log(`Network: ${networkName}`);
  console.log(`ChainId: ${chainId.toString()}`);
  console.log("VeritasCore (L2):", coreAddress);
  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
