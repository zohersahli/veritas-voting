import { network } from "hardhat";
import { saveDeployment } from "./utils/saveDeployment.js";

/*
Deploy L1 Receiver+Registry.

Localhost:
- Deploy MockCcipRouter (selector=999)
- Deploy VeritasCcipReceiverRegistry with allowedSourceChainSelector=999 and temporary allowedSender=deployer

Testnet:
- Use L1_CCIP_ROUTER and CCIP_SOURCE_CHAIN_SELECTOR from .env
- Deploy VeritasCcipReceiverRegistry with temporary allowedSender=deployer
*/

function getNetworkNameFromArgs(): string {
  const idx = process.argv.indexOf("--network");
  if (idx !== -1 && process.argv[idx + 1]) return String(process.argv[idx + 1]).trim();
  return "";
}

function requireEnv(name: string): string {
  const v = (process.env[name] ?? "").trim();
  if (!v) throw new Error(`Missing ${name} in .env`);
  return v;
}

async function main() {
  const { ethers } = await network.connect();

  const cliName = getNetworkNameFromArgs();
  const envName = (process.env.HARDHAT_NETWORK ?? "").trim();
  const networkName = cliName || envName || "hardhat";

  const netInfo = await ethers.provider.getNetwork();
  const chainId = netInfo.chainId;

  const [deployer] = await ethers.getSigners();

  const isLocal =
    networkName === "hardhat" ||
    networkName === "localhost" ||
    chainId === 31337n;

  let routerAddress: string;
  let allowedSourceSelector: bigint;

  if (isLocal) {
    // Deploy mock CCIP router on localhost
    const MockRouter = await ethers.getContractFactory("MockCcipRouter");

    // selector=999, flatFee=1 LINK (in wei units of LINK token decimals, mock usage)
    const mockRouter = await MockRouter.deploy(999, ethers.parseUnits("1", 18));
    await mockRouter.waitForDeployment();

    routerAddress = await mockRouter.getAddress();
    allowedSourceSelector = 999n;

    console.log("MockCcipRouter (L1):", routerAddress);
  } else {
    routerAddress = requireEnv("L1_CCIP_ROUTER");
    allowedSourceSelector = BigInt(requireEnv("CCIP_SOURCE_CHAIN_SELECTOR"));
  }

  // allowedSender temporary deployer, will be updated later to VeritasCore on L2
  const initialAllowedSender = deployer.address;

  const ReceiverRegistry = await ethers.getContractFactory("VeritasCcipReceiverRegistry");
  const receiverRegistry = await ReceiverRegistry.deploy(
    routerAddress,
    allowedSourceSelector,
    initialAllowedSender
  );
  await receiverRegistry.waitForDeployment();

  const receiverRegistryAddress = await receiverRegistry.getAddress();
  console.log("VeritasCcipReceiverRegistry:", receiverRegistryAddress);

  const savedPath = await saveDeployment({
    network: networkName,
    chainId,
    layer: "l1",
    contracts: {
      VeritasCcipReceiverRegistry: receiverRegistryAddress,
      ...(isLocal ? { MockCcipRouterL1: routerAddress } : {}),
    },
  });

  console.log(`Network: ${networkName}`);
  console.log(`ChainId: ${chainId.toString()}`);
  console.log("Saved:", savedPath);
  console.log("Deployer:", deployer.address);
  console.log("Router:", routerAddress);
  console.log("allowedSourceChainSelector:", allowedSourceSelector.toString());
  console.log("Initial allowedSender:", initialAllowedSender);

  if (!isLocal) {
    console.log("\nNext (testnet):");
    console.log("- Deploy L2 (deploy-l2.ts) on baseSepolia");
    console.log("- Then run configure scripts on L1 and L2 to set allowedSender and ACK config");
  }

  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
