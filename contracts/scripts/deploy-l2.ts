import { network } from "hardhat";
import { saveDeployment } from "./utils/saveDeployment.js";
import fs from "node:fs";

/*
AR: Deploy L2 VeritasCore (Sender + modules).
EN: Deploy L2 VeritasCore (Sender + modules).

Localhost:
- Read deployments/localhost.json to reuse L1 MockCcipRouter
- Deploy MockLink and mint to deployer
- Deploy VeritasCore using shared router and MockLink
- Configure L1 allowedSender to VeritasCore
- Configure ACK:
  - L1 setAckConfig(destSelector=111, l2Receiver=VeritasCore, feeToken=MockLink, gasLimit)
  - L2 setAckConfig(sourceSelector=999, sender=L1ReceiverRegistry)

Testnet:
- Uses env:
  L2_CCIP_ROUTER, L2_LINK_TOKEN, CCIP_DEST_CHAIN_SELECTOR, L1_RECEIVER_REGISTRY_ADDRESS, TREASURY_ADDRESS, CCIP_RECEIVER_GAS_LIMIT
- Skips cross-chain updates (must be done with separate configure scripts)
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

  // AR: Safety switch للتست نت فقط
  // EN: Safety switch for testnet only
  const confirm = (process.env.CONFIRM_TESTNET_DEPLOY ?? "").trim();
  if (!isLocal && confirm !== "YES") {
    throw new Error(
      `Refusing to deploy to ${networkName} (chainId=${chainId}) without CONFIRM_TESTNET_DEPLOY="YES"`
    );
  }

  // Local deployments (needed for shared router and L1 receiver address)
  let depLocal: any = null;
  if (isLocal) {
    depLocal = JSON.parse(fs.readFileSync("./deployments/localhost.json", "utf8"));
  }

  // L1 receiver address
  let l1ReceiverAddress: string;
  if (isLocal) {
    const fromDep = depLocal?.l1?.VeritasCcipReceiverRegistry;
    if (!fromDep) throw new Error("Missing l1.VeritasCcipReceiverRegistry in deployments/localhost.json");
    l1ReceiverAddress = String(fromDep).trim();

    const envDep = (process.env.L1_RECEIVER_REGISTRY_ADDRESS ?? "").trim();
    if (envDep && envDep.toLowerCase() !== l1ReceiverAddress.toLowerCase()) {
      throw new Error(
        `Mismatch: .env L1_RECEIVER_REGISTRY_ADDRESS=${envDep} but deployments=${l1ReceiverAddress}`
      );
    }
  } else {
    l1ReceiverAddress = requireEnv("L1_RECEIVER_REGISTRY_ADDRESS");
  }

  const treasury = requireEnv("TREASURY_ADDRESS");
  const gasLimitStr = (process.env.CCIP_RECEIVER_GAS_LIMIT ?? "300000").trim();
  const gasLimit = BigInt(gasLimitStr);

  let l2RouterAddress: string;
  let l2LinkAddress: string;
  let destSelector: bigint;

  if (isLocal) {
    // AR: Deploy MockLink + mint
    // EN: Deploy MockLink + mint
    const MockLink = await ethers.getContractFactory("MockLink");
    const link = await MockLink.deploy();
    await link.waitForDeployment();
    l2LinkAddress = await link.getAddress();

    const mintTx = await link.mint(deployer.address, ethers.parseUnits("1000", 18));
    await mintTx.wait();

    // AR: reuse the L1 router on localhost (shared) to keep receiver/router consistent
    // EN: reuse the L1 router on localhost (shared) to keep receiver/router consistent
    const fromDepRouter = depLocal?.l1?.MockCcipRouterL1;
    if (!fromDepRouter) throw new Error("Missing l1.MockCcipRouterL1 in deployments/localhost.json");
    l2RouterAddress = String(fromDepRouter).trim();

    // Local-only destination selector (used by mock router)
    destSelector = 111n;

    console.log("MockLink (L2):", l2LinkAddress);
    console.log("MockCcipRouter (shared L1/L2):", l2RouterAddress);
  } else {
    l2RouterAddress = requireEnv("L2_CCIP_ROUTER");
    l2LinkAddress = requireEnv("L2_LINK_TOKEN");
    destSelector = BigInt(requireEnv("CCIP_DEST_CHAIN_SELECTOR"));
  }

  // Deploy VeritasCore
  const VeritasCore = await ethers.getContractFactory("VeritasCore");
  const veritas = await VeritasCore.deploy(
    l2RouterAddress,
    l2LinkAddress,
    destSelector,
    l1ReceiverAddress,
    treasury,
    gasLimit
  );
  await veritas.waitForDeployment();

  const veritasAddress = await veritas.getAddress();
  console.log("VeritasCore:", veritasAddress);

  const savedPath = await saveDeployment({
    network: networkName,
    chainId,
    layer: "l2",
    contracts: {
      VeritasCore: veritasAddress,
      ...(isLocal ? { MockLinkL2: l2LinkAddress, MockCcipRouterShared: l2RouterAddress } : {}),
    },
  });

  console.log(`Network: ${networkName}`);
  console.log(`ChainId: ${chainId.toString()}`);
  console.log("Saved:", savedPath);
  console.log("Deployer:", deployer.address);

  if (isLocal) {
    // Local only: same chain, so we can configure both sides here.

    const l1Receiver = await ethers.getContractAt(
      "VeritasCcipReceiverRegistry",
      l1ReceiverAddress
    );

    console.log("\nConfiguring local cross-chain settings...");

    // 1) L1 allowlist: allowedSender = VeritasCore
    console.log("Updating L1 allowedSender (local) to:", veritasAddress);
    const tx1 = await (l1Receiver as any).setAllowedSender(veritasAddress);
    await tx1.wait();

    // 2) L1 ACK config
    // destSelector must match what L2 uses as destinationChainSelector in local mock
    // feeToken is the MockLink on this same chain (single-chain simulation)
    const ackDestSelector = 111n;
    const ackFeeToken = l2LinkAddress;
    const ackGasLimit = gasLimit;

    console.log("Setting L1 ACK config (local)...");
    const tx2 = await (l1Receiver as any).setAckConfig(
      ackDestSelector,
      veritasAddress,
      ackFeeToken,
      ackGasLimit
    );
    await tx2.wait();

    // 3) L2 ACK allowlist
    // source selector for messages coming from mock router is 999 (router's configured selector)
    const ackSourceSelector = 999n;
    console.log("Setting L2 ACK allowlist (local)...");
    const tx3 = await (veritas as any).setAckConfig(ackSourceSelector, l1ReceiverAddress);
    await tx3.wait();

    console.log("Local config done.");
  } else {
    console.log("\nSkipping cross-chain updates on testnet.");
    console.log("Next (testnet):");
    console.log("- Run configure-l1.ts on ethereumSepolia to setAllowedSender(L2 VeritasCore) and setAckConfig");
    console.log("- Run configure-l2.ts on baseSepolia to setAckConfig(L1 selector, L1 receiver)");
  }

  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
