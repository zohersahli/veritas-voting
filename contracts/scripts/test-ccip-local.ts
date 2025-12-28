import { network } from "hardhat";
import deployments from "../deployments/localhost.json";

function assertEqBigInt(actual: bigint, expected: bigint, label: string) {
  if (actual !== expected) {
    throw new Error(`[ASSERT FAIL] ${label}. Expected=${expected.toString()} Actual=${actual.toString()}`);
  }
}

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

async function main() {
  const { ethers } = await network.connect();
  const [deployer] = await ethers.getSigners();
  const creatorAddr = deployer.address;

  const l1ReceiverAddr = deployments.l1.VeritasCcipReceiverRegistry;
  const veritasAddr = deployments.l2.VeritasCore;
  const linkAddr = deployments.l2.MockLinkL2;

  const veritas = await ethers.getContractAt("VeritasCore", veritasAddr);
  const link = await ethers.getContractAt("MockLink", linkAddr);
  const l1Registry = await ethers.getContractAt("VeritasCcipReceiverRegistry", l1ReceiverAddr);

  const scenario = (process.env.TEST_FINAL_STATUS ?? "PASSED").trim().toUpperCase();
  const expectPassed = scenario === "PASSED";
  const expectFailedQuorum = scenario === "FAILED_QUORUM";

  if (!expectPassed && !expectFailedQuorum) {
    throw new Error(`Bad TEST_FINAL_STATUS=${scenario}. Use PASSED or FAILED_QUORUM`);
  }

  const expectedStatusEnum: bigint = expectPassed ? 1n : 2n;

  console.log("\n--- Scenario ---");
  console.log("TEST_FINAL_STATUS:", scenario);
  console.log("---\n");

  // ACK selector from mock router if available
  let ackSourceSelector = 999n;
  try {
    const routerAddr = await veritas.ccipRouter();
    const mockRouter = await ethers.getContractAt("MockCcipRouter", routerAddr);
    const s = await mockRouter.sourceChainSelector();
    ackSourceSelector = BigInt(s);
  } catch {}

  // L2 setAckConfig
  if (hasFnSig(veritas, "setAckConfig(uint64,address)")) {
    const currentSel = await veritas.ackSourceChainSelector();
    const currentSender = await veritas.ackSender();
    if (
      BigInt(currentSel) === 0n ||
      String(currentSender).toLowerCase() === "0x0000000000000000000000000000000000000000"
    ) {
      console.log("Setting L2 ACK config...");
      const tx = await veritas.setAckConfig(ackSourceSelector, l1ReceiverAddr);
      await tx.wait();
    }
  }

  // L1 setAckConfig
  if (hasFnSig(l1Registry, "setAckConfig(uint64,address,address,uint256)")) {
    const destSelector = 111n;
    const gasLimit = 300_000n;

    const curDest = await l1Registry.ackDestinationChainSelector();
    const curL2 = await l1Registry.ackL2Receiver();
    const curToken = await l1Registry.ackFeeToken();
    const curGas = await l1Registry.ackGasLimit();

    const isUnset =
      BigInt(curDest) === 0n ||
      String(curL2).toLowerCase() === "0x0000000000000000000000000000000000000000" ||
      String(curToken).toLowerCase() === "0x0000000000000000000000000000000000000000" ||
      BigInt(curGas) === 0n;

    if (isUnset) {
      console.log("Setting L1 ACK config...");
      const tx = await l1Registry.setAckConfig(destSelector, veritasAddr, linkAddr, gasLimit);
      await tx.wait();
    }
  }

  // Ensure deployer has LINK (mint if possible)
  if (hasFnSig(link, "mint(address,uint256)")) {
    const need = ethers.parseUnits("50", 18);
    const balDeployer = await link.balanceOf(creatorAddr);
    if (BigInt(balDeployer) < BigInt(need)) {
      console.log("Minting LINK to deployer for local test...");
      const txMint = await (link as any).mint(creatorAddr, need);
      await txMint.wait();
    }
  }

  // Fund L1 receiver with LINK for ACK
  console.log("Funding L1 receiver with LINK for ACK...");
  const l1Bal = await link.balanceOf(l1ReceiverAddr);
  if (BigInt(l1Bal) < BigInt(ethers.parseUnits("5", 18))) {
    const txFundL1 = await link.transfer(l1ReceiverAddr, ethers.parseUnits("10", 18));
    await txFundL1.wait();
  } else {
    console.log("L1 receiver already funded.");
  }

  // Create group
  console.log("Creating group...");
  const txG = await veritas.createGroup("Test Group", "Local CCIP test", 0);
  const rcG = await txG.wait();

  let groupId = getEventArgFromReceipt(rcG, veritas, "GroupCreated", "groupId");
  if (groupId === undefined) {
    groupId = 1n;
    console.log("Warning: Could not extract groupId from events. Falling back to 1.");
  }
  const groupIdNum = Number(groupId);
  console.log("GroupId:", groupIdNum);

  // Approve
  console.log("Approving LINK for VeritasCore...");
  const txApprove = await link.approve(veritasAddr, ethers.parseUnits("1000000", 18));
  await txApprove.wait();

  // Important fix: compute now after approve, and add safe offset
  const now = (await ethers.provider.getBlock("latest"))!.timestamp;

  const title = "Local Poll";
  const cid = "bafy-local-test";
  const startTime = now + 30;
  const endTime = now + 90;
  const quorumEnabled = false;
  const options = ["Yes", "No"];

  console.log("Creating poll with LINK escrow...");
  const opsFeeFlat = await veritas.opsFeeFlat();
  const l2Treasury = await veritas.treasury();

  console.log("opsFeeFlat:", opsFeeFlat.toString());
  console.log("L2 treasury:", l2Treasury);

  const treasuryBalBeforeCreate = await link.balanceOf(l2Treasury);

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

  const treasuryBalAfterCreate = await link.balanceOf(l2Treasury);

  const treasuryAddrOnL2 = String(l2Treasury).toLowerCase();
  const creatorAddrLower = creatorAddr.toLowerCase();

  if (treasuryAddrOnL2 !== creatorAddrLower) {
    const delta = BigInt(treasuryBalAfterCreate) - BigInt(treasuryBalBeforeCreate);
    assertEqBigInt(delta, BigInt(opsFeeFlat), "opsFeeFlat must be transferred to treasury at create time");
  } else {
    console.log("Note: treasury == creator in this run, skipping opsFee balance delta assertion.");
  }

  let pollId = getEventArgFromReceipt(rcP, veritas, "PollCreated", "pollId");
  if (pollId === undefined) {
    pollId = getEventArgFromReceipt(rcP, veritas, "EscrowLocked", "pollId");
  }
  if (pollId === undefined) {
    pollId = 1n;
    console.log("Warning: Could not extract pollId from events. Falling back to 1.");
  }
  const pollIdNum = Number(pollId);
  console.log("PollId:", pollIdNum);

  // Wait until start
  console.log("Waiting for start...");
  while ((await ethers.provider.getBlock("latest"))!.timestamp < startTime) {
    await ethers.provider.send("evm_mine", []);
  }

  console.log("Voting...");
  const txV = await veritas.vote(pollIdNum, 0);
  await txV.wait();

  console.log("Waiting for end...");
  while ((await ethers.provider.getBlock("latest"))!.timestamp < endTime) {
    await ethers.provider.send("evm_mine", []);
  }

  if (!hasFnSig(veritas, "setTestFinalStatusRaw(uint8)")) {
    throw new Error("Missing setTestFinalStatusRaw on VeritasCore.");
  }

  console.log(`Setting test finalize status: ${expectPassed ? "Passed" : "FailedQuorum"} ...`);
  const txS = await (veritas as any).setTestFinalStatusRaw(expectPassed ? 1 : 2);
  await txS.wait();

  console.log("Finalizing on L2...");
  const txF = await veritas.finalizePollOnL2(pollIdNum);
  await txF.wait();

  const l2Result = await veritas.results(pollIdNum);
  console.log("L2 result after finalize:", l2Result);

  console.log("Sending result to L1 via CCIP...");
  const txSend = await veritas.sendResultToL1(pollIdNum, { gasLimit: 5_000_000 });
  await txSend.wait();

  // L1 record check
  console.log("Checking L1 record...");

  const { keccak256, AbiCoder } = await import("ethers");
  const abiCoder = AbiCoder.defaultAbiCoder();
  const key = keccak256(abiCoder.encode(["uint256", "uint256"], [groupIdNum, pollIdNum]));

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

  console.log("L1 isRecorded:", isRecorded);
  console.log("L1 record:", rec);

  assertTrue(isRecorded, "L1 must be recorded in mock flow");

  const l1Status: bigint = BigInt((rec as any).status);
  assertEqBigInt(l1Status, expectedStatusEnum, "L1 recorded status must match scenario");

  // ACK check on L2
  console.log("Checking ACK received on L2...");
  const ackReceived = await veritas.ackReceived(key);
  console.log("ACK received:", ackReceived);
  assertTrue(ackReceived, "ACK must be received on L2 after L1 records");

  console.log("\nAll good.");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
