// H:\veritas\contracts\scripts\test-ccip-testnet.ts
import { network } from "hardhat";
import baseDeployments from "../deployments/baseSepolia.json";
import l1Deployments from "../deployments/ethereumSepolia.json";

function assertTrue(condition: boolean, label: string) {
  if (!condition) throw new Error(`[ASSERT FAIL] ${label}`);
}

function hasFnSig(contract: any, sigOrName: string): boolean {
  try {
    contract.interface.getFunction(sigOrName);
    return true;
  } catch {
    return false;
  }
}

function getEventArgFromReceipt(
  receipt: any,
  contract: any,
  eventName: string,
  argName: string
): any | undefined {
  const targetAddr = String(contract.target ?? contract.address).toLowerCase();
  for (const log of receipt.logs ?? []) {
    if (!log?.address) continue;
    if (String(log.address).toLowerCase() !== targetAddr) continue;

    try {
      const parsed = contract.interface.parseLog(log);
      if (parsed?.name === eventName) {
        return (parsed.args as any)[argName];
      }
    } catch {
      // ignore
    }
  }
  return undefined;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitUntilTimestamp(getNow: () => Promise<number>, target: number, label: string) {
  for (;;) {
    const now = await getNow();
    if (now >= target) return;
    const remaining = target - now;
    const step = Math.min(remaining, 10);
    console.log(`${label}... now=${now} target=${target} remaining=${remaining}s`);
    await sleep(step * 1000);
  }
}

async function pollUntil<T>(
  fn: () => Promise<T>,
  pred: (v: T) => boolean,
  opts: { label: string; intervalMs: number; timeoutMs: number }
): Promise<T> {
  const started = Date.now();
  for (;;) {
    const v = await fn();
    if (pred(v)) return v;
    if (Date.now() - started > opts.timeoutMs) {
      throw new Error(`[TIMEOUT] ${opts.label}`);
    }
    console.log(`${opts.label}...`);
    await sleep(opts.intervalMs);
  }
}

async function main() {
  const { ethers } = await network.connect();
  const [deployer] = await ethers.getSigners();

  const veritasAddr = (baseDeployments as any).l2?.VeritasCore ?? (baseDeployments as any).VeritasCore;
  const l1ReceiverAddr =
    (l1Deployments as any).l1?.VeritasCcipReceiverRegistry ?? (l1Deployments as any).VeritasCcipReceiverRegistry;

  if (!veritasAddr || !l1ReceiverAddr) {
    throw new Error("Missing deployments: VeritasCore (baseSepolia) or VeritasCcipReceiverRegistry (ethereumSepolia).");
  }

    const l2LinkToken =
       process.env.L2_LINK_TOKEN_ADDRESS ??
       process.env.CCIP_L2_LINK_TOKEN ??
       process.env.L2_LINK_TOKEN;
  
    if (!l2LinkToken) {
      throw new Error("Missing L2 LINK token address in env (L2_LINK_TOKEN_ADDRESS or CCIP_L2_LINK_TOKEN or L2_LINK_TOKEN).");
    }

  const L1_RPC = (process.env.ETHEREUM_SEPOLIA_RPC_URL ?? process.env.SEPOLIA_RPC_URL ?? "").trim();
  if (!L1_RPC) {
    throw new Error("Missing L1 RPC in env (ETHEREUM_SEPOLIA_RPC_URL or SEPOLIA_RPC_URL).");
  }

  console.log("\n--- Testnet CCIP Smoke Test ---");
  console.log("L2 network:", "baseSepolia");
  console.log("Deployer:", deployer.address);
  console.log("VeritasCore (L2):", veritasAddr);
  console.log("L1 Receiver Registry (L1):", l1ReceiverAddr);
  console.log("L2 LINK:", l2LinkToken);
  console.log("---\n");

  const veritas = await ethers.getContractAt("VeritasCore", veritasAddr);

  const ERC20_ABI = [
    "function balanceOf(address) view returns (uint256)",
    "function approve(address spender, uint256 amount) returns (bool)",
    "function transfer(address to, uint256 amount) returns (bool)",
    "function allowance(address owner, address spender) view returns (uint256)",
    "function decimals() view returns (uint8)",
  ];

  const linkL2 = new ethers.Contract(l2LinkToken, ERC20_ABI, deployer);

  const l1Provider = new (await import("ethers")).JsonRpcProvider(L1_RPC);

  const l1RegistryIface = (await ethers.getContractFactory("VeritasCcipReceiverRegistry")).interface;
  const l1Registry = new (await import("ethers")).Contract(l1ReceiverAddr, l1RegistryIface, l1Provider);

  const { keccak256, AbiCoder } = await import("ethers");
  const abiCoder = AbiCoder.defaultAbiCoder();

  // 1) Create groups (create two to ensure we use a fresh groupId)
  console.log("1) Creating groups on L2...");
  
  // First group (may be groupId=1 if contract was just deployed)
  const txG1 = await veritas.createGroup("Test Group 1", "First group", 0);
  await txG1.wait();
  
  // Second group (will be groupId=2, guaranteed fresh on L1)
  console.log("   Creating second group to ensure fresh groupId...");
  const txG2 = await veritas.createGroup("Testnet Group", "CCIP Smoke Test", 0);
  const rcG2 = await txG2.wait();

  let groupId = getEventArgFromReceipt(rcG2, veritas, "GroupCreated", "groupId");
  if (groupId === undefined) {
    throw new Error("Could not extract groupId from GroupCreated event.");
  }
  const groupIdNum = Number(groupId);
  console.log("Using GroupId:", groupIdNum, "(fresh, not used on L1 before)");

  // 2) Approve LINK for VeritasCore (large allowance)
  console.log("2) Approving LINK for VeritasCore...");
  const decimals = await linkL2.decimals().catch(() => 18);
  const approveAmount = ethers.parseUnits("1000000", decimals);
  const txApprove = await linkL2.approve(veritasAddr, approveAmount);
  await txApprove.wait();

  // 3) Create poll with LINK escrow
  const latest = await ethers.provider.getBlock("latest");
  const now = Number(latest?.timestamp ?? Math.floor(Date.now() / 1000));

  const title = "Testnet Poll";
  const cid = "bafy-testnet-smoke";
  const startTime = now + 15;
  const endTime = now + 60;
  const quorumEnabled = false;
  const options = ["Yes", "No"];

  console.log("3) Creating poll with LINK escrow on L2...");
  const txP = await veritas.createPollWithLinkEscrow(
    BigInt(groupIdNum),
    title,
    cid,
    options,
    BigInt(startTime),
    BigInt(endTime),
    quorumEnabled,
    0
  );
  const rcP = await txP.wait();

  let pollId = getEventArgFromReceipt(rcP, veritas, "PollCreated", "pollId");
  if (pollId === undefined) pollId = getEventArgFromReceipt(rcP, veritas, "EscrowLocked", "pollId");
  if (pollId === undefined) throw new Error("Could not extract pollId from events (PollCreated/EscrowLocked).");

  const pollIdNum = Number(pollId);
  console.log("PollId:", pollIdNum);

  // Wait until startTime (real time on testnet)
  console.log("4) Waiting for poll start...");
  await waitUntilTimestamp(async () => {
    const b = await ethers.provider.getBlock("latest");
    return Number(b?.timestamp ?? Math.floor(Date.now() / 1000));
  }, startTime, "Waiting for start");

  // 4) Vote
  console.log("5) Voting on L2...");
  const txV = await veritas.vote(pollIdNum, 0);
  await txV.wait();

  // Wait until endTime
  console.log("6) Waiting for poll end...");
  await waitUntilTimestamp(async () => {
    const b = await ethers.provider.getBlock("latest");
    return Number(b?.timestamp ?? Math.floor(Date.now() / 1000));
  }, endTime, "Waiting for end");

  // 5) Finalize
  console.log("7) Finalizing on L2...");
  const txF = await veritas.finalizePollOnL2(pollIdNum);
  await txF.wait();

  // 6) Send result to L1
  console.log("8) Sending result to L1 via CCIP...");
  const txSend = await veritas.sendResultToL1(pollIdNum, { gasLimit: 5_000_000 });
  const rcSend = await txSend.wait();
  console.log("sendResultToL1 tx:", rcSend?.hash ?? "(no hash)");

  // Extract messageId from ResultSentToL1 event
  let currentMessageId: string | undefined;
  for (const log of rcSend?.logs ?? []) {
    try {
      const parsed = veritas.interface.parseLog(log);
      if (parsed?.name === "ResultSentToL1") {
        currentMessageId = String((parsed.args as any).messageId);
        break;
      }
    } catch {
      // ignore
    }
  }
  if (!currentMessageId) {
    throw new Error("Could not extract messageId from ResultSentToL1 event.");
  }
  console.log("Current messageId:", currentMessageId);

  // Key for (groupId, pollId)
  const key = keccak256(abiCoder.encode(["uint256", "uint256"], [groupIdNum, pollIdNum]));

  // 7) Confirm L1 record (wait for NEW record with matching messageId)
  console.log("9) Waiting for L1 record...");
  const record = await pollUntil(
    async () => {
      let isRecorded: boolean;
      let rec: any;

      if (hasFnSig(l1Registry, "isRecorded(uint256,uint256)") && hasFnSig(l1Registry, "getRecord(uint256,uint256)")) {
        isRecorded = await (l1Registry as any).isRecorded(groupIdNum, pollIdNum);
        rec = await (l1Registry as any).getRecord(groupIdNum, pollIdNum);
      } else if (hasFnSig(l1Registry, "isRecorded(bytes32)") && hasFnSig(l1Registry, "getRecord(bytes32)")) {
        isRecorded = await (l1Registry as any).isRecorded(key);
        rec = await (l1Registry as any).getRecord(key);
      } else if (hasFnSig(l1Registry, "getRecord(bytes32)")) {
        rec = await (l1Registry as any).getRecord(key);
        isRecorded = Boolean((rec as any).recorded);
      } else if (hasFnSig(l1Registry, "isRecorded(uint256)") && hasFnSig(l1Registry, "getRecord(uint256)")) {
        isRecorded = await (l1Registry as any).isRecorded(pollIdNum);
        rec = await (l1Registry as any).getRecord(pollIdNum);
      } else {
        throw new Error("Unsupported L1 registry ABI: cannot find isRecorded/getRecord in any known signature.");
      }

      return { isRecorded, rec };
    },
    (v) => {
      if (!v.isRecorded) return false;
      if (!currentMessageId) return true;
      const recMsgId = String(v.rec?.inboundMessageId ?? "");
      return recMsgId.toLowerCase() === currentMessageId.toLowerCase();
    },
    { label: "Waiting for L1 to record", intervalMs: 15_000, timeoutMs: 60 * 60_000 }
  );

  console.log("L1 recorded:", record.isRecorded);
  console.log("L1 record:", record.rec);
  assertTrue(record.isRecorded, "L1 must be recorded");

  // 8) Confirm ACK received on L2
  console.log("10) Waiting for ACK on L2...");
  let ackMessageId: string | undefined;
  if (record.rec?.ackMessageId) {
    ackMessageId = String(record.rec.ackMessageId);
  }

  const ack = await pollUntil(
    async () => Boolean(await veritas.ackReceived(key)),
    (v) => v === true,
    { label: "Waiting for ACK to be received on L2", intervalMs: 15_000, timeoutMs: 60 * 60_000 }
  );

  console.log("ACK received:", ack);
  assertTrue(ack, "ACK must be received on L2");

  console.log("\n=== Test Summary ===");
  console.log("GroupId:", groupIdNum);
  console.log("PollId:", pollIdNum);
  console.log("Key:", key);
  console.log("L2->L1 MessageId:", currentMessageId);
  if (ackMessageId) {
    console.log("L1->L2 ACK MessageId:", ackMessageId);
  }

  console.log("\nSMOKE TEST PASSED.");
}

main().catch((err) => {
  console.error("\n=== Error ===");
  console.error(err.message || err);

  if (err.message?.includes("TIMEOUT")) {
    console.log("\n⚠️  Timeout occurred. Check CCIP Explorer for message status:");
    console.log("You can manually check status using:");
    console.log(`  npx hardhat run .\\scripts\\check-status.ts --network ethereumSepolia`);
    console.log(`  npx hardhat run .\\scripts\\check-status.ts --network baseSepolia`);
    console.log("\nOr check CCIP Explorer directly:");
    console.log("  https://ccip.chain.link/");
  }

  process.exitCode = 1;
});
