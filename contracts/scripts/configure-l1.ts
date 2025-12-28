import { network } from "hardhat";
import fs from "node:fs";

/*
AR: Configure L1 after both L1 and L2 are deployed.
EN: Configure L1 after both L1 and L2 are deployed.

What it does:
1) setAllowedSender(L2 VeritasCore)
2) setAckConfig(destSelector=L2 selector, l2Receiver=L2 VeritasCore, feeToken=L1 LINK, gasLimit)
3) Optional: fund the L1 receiver with LINK for ACK fees
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

  // L1 receiver registry address (on Ethereum Sepolia)
  const l1ReceiverAddr = getAddrFromFileOrEnv(
    "L1_RECEIVER_REGISTRY_ADDRESS",
    "./deployments/ethereumSepolia.json",
    ["l1", "VeritasCcipReceiverRegistry"]
  );

  // L2 VeritasCore address (on Base Sepolia)
  const l2VeritasAddr = getAddrFromFileOrEnv(
    "L2_VERITASCORE_ADDRESS",
    "./deployments/baseSepolia.json",
    ["l2", "VeritasCore"]
  );

  // Chain selectors
  // CCIP_SOURCE_CHAIN_SELECTOR = L2 selector (used by L1 allowlist, also used as ACK destination selector)
  const l2Selector = BigInt(requireEnv("CCIP_SOURCE_CHAIN_SELECTOR"));

  // L1 LINK token (Sepolia LINK)
  const l1LinkToken = requireEnv("L1_LINK_TOKEN");

  // Gas limit for ACK execution on L2
  const ackGasLimitRaw = optionalEnv("CCIP_ACK_GAS_LIMIT") || optionalEnv("CCIP_RECEIVER_GAS_LIMIT") || "300000";
  const ackGasLimit = BigInt(ackGasLimitRaw);

  console.log("\n--- configure-l1.ts ---");
  console.log("Deployer:", deployer.address);
  console.log("L1 Receiver Registry:", l1ReceiverAddr);
  console.log("L2 VeritasCore:", l2VeritasAddr);
  console.log("L2 selector (ACK dest):", l2Selector.toString());
  console.log("L1 LINK token:", l1LinkToken);
  console.log("ACK gasLimit:", ackGasLimit.toString());

  const l1Receiver = await ethers.getContractAt("VeritasCcipReceiverRegistry", l1ReceiverAddr);

  // 1) Set allowedSender to L2 VeritasCore
  console.log("\n1) setAllowedSender(L2 VeritasCore)...");
  const tx1 = await (l1Receiver as any).setAllowedSender(l2VeritasAddr);
  await tx1.wait();
  console.log("OK: allowedSender updated");

  // 2) Set ACK config on L1
  console.log("\n2) setAckConfig(...) on L1...");
  const tx2 = await (l1Receiver as any).setAckConfig(
    l2Selector,       // destSelector (L2)
    l2VeritasAddr,    // L2 receiver (VeritasCore)
    l1LinkToken,      // feeToken (LINK on L1)
    ackGasLimit       // gasLimit for ACK execution on L2
  );
  await tx2.wait();
  console.log("OK: ACK config set on L1");

  // 3) Optional funding of L1 receiver with LINK
  // If L1_ACK_FUND_AMOUNT_LINK is set (example: "3"), we transfer that amount to the L1 receiver.
  const fundAmount = optionalEnv("L1_ACK_FUND_AMOUNT_LINK");
  if (fundAmount) {
    const amt = ethers.parseUnits(fundAmount, 18);

    // Minimal ERC20 ABI, no IERC20 artifact needed.
    const erc20Abi = [
      "function transfer(address to, uint256 amount) external returns (bool)",
      "function balanceOf(address owner) external view returns (uint256)"
    ];

    const link = new ethers.Contract(l1LinkToken, erc20Abi, deployer);

    const balBefore: bigint = BigInt(await link.balanceOf(l1ReceiverAddr));
    console.log("\n3) Funding L1 receiver with LINK...");
    console.log("Receiver LINK balance before:", balBefore.toString());

    const tx3 = await link.transfer(l1ReceiverAddr, amt);
    await tx3.wait();

    const balAfter: bigint = BigInt(await link.balanceOf(l1ReceiverAddr));
    console.log("Receiver LINK balance after:", balAfter.toString());
    console.log("OK: funded L1 receiver");
  } else {
    console.log("\n3) Funding skipped (L1_ACK_FUND_AMOUNT_LINK not set).");
  }

  console.log("\nDone configure-l1.ts");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
