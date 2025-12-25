import { expect } from "chai";
import { network } from "hardhat";
import { parseEther } from "ethers";

const { ethers } = await network.connect();

describe("CcipEscrowSenderL2 (Hardhat)", function () {
  let snapshotId: string;

  beforeEach(async () => {
    snapshotId = await ethers.provider.send("evm_snapshot", []);
  });

  afterEach(async () => {
    await ethers.provider.send("evm_revert", [snapshotId]);
  });

  async function setTime(ts: number) {
    await ethers.provider.send("evm_setNextBlockTimestamp", [ts]);
    await ethers.provider.send("evm_mine", []);
  }

  async function deployCore() {
    const [owner, A, B, C, D] = await ethers.getSigners();

    // LINK
    const MockLink = await ethers.getContractFactory("MockLink");
    const link = await MockLink.deploy();

    // Router (keep flatFee > 0)
    const MockCcipRouter = await ethers.getContractFactory("MockCcipRouter");
    // sourceSelector=1, flatFee=0.001 LINK
    const router = await MockCcipRouter.deploy(1n, parseEther("0.001"));

    // Deploy core with placeholder L1 receiver (we'll set the real one after)
    const VeritasCore = await ethers.getContractFactory("VeritasCore");
    const core = (await VeritasCore.deploy(
      await router.getAddress(),
      await link.getAddress(),
      1n, // destSelector
      owner.address, // placeholder l1Receiver
      B.address, // treasury = B (so we can assert opsFee)
      300000n // receiverGasLimit
    )) as any;

    // Deploy L1 receiver registry (real CCIP receiver on "L1" side in localhost)
    const VeritasCcipReceiverRegistry = await ethers.getContractFactory("VeritasCcipReceiverRegistry");
    const l1 = (await VeritasCcipReceiverRegistry.deploy(
      await router.getAddress(),
      1n, // allowedSourceChainSelector (router.sourceChainSelector)
      await core.getAddress() // allowedSender (core address, because router encodes msg.sender)
    )) as any;

    // Wire L2 -> L1 receiver
    await core.connect(owner).setL1Receiver(await l1.getAddress());

    // Configure ACK (L1 -> L2)
    // L2 must accept ACKs that come from the registry via the router
    await core.connect(owner).setAckConfig(1n, await l1.getAddress());

    // L1 registry must know where to send ACK on L2, and which token to pay fees with
    await l1.connect(owner).setAckConfig(
      1n, // ackDestinationChainSelector (non-zero; same mock selector is fine)
      await core.getAddress(), // ackL2Receiver
      await link.getAddress(), // feeToken (LINK)
      300000n // gasLimit
    );

    // Fund L1 registry with LINK so it can pay ACK fees (router.ccipSend will transferFrom)
    await link.mint(await l1.getAddress(), parseEther("10"));

    return { core, link, router, l1, owner, A, B, C, D };
  }

  async function mintAndApproveLink(link: any, holder: any, spender: string, amount: bigint) {
    await link.mint(holder.address, amount);
    await link.connect(holder).approve(spender, amount);
  }

  it("createPollWithLinkEscrow locks maxFee+platform and charges ops fee to treasury", async () => {
    const { core, link, owner, A, B } = await deployCore();

    // Create group Manual
    await core.connect(owner).createGroup("G", "D", 0);
    const groupId = await core.nextGroupId();

    // Add A so eligible snapshot includes owner + A
    await core.connect(owner).setManualMember(groupId, A.address, true);
    expect(await core.getEligibleCountForQuorum(groupId)).to.equal(2n);

    const now = (await ethers.provider.getBlock("latest"))!.timestamp;
    const start = now + 10;
    const end = now + 100;

    const options = ["Yes", "No"];

    // Over-approve
    await mintAndApproveLink(link, owner, await core.getAddress(), parseEther("100"));

    const treasuryBefore = await link.balanceOf(B.address);

    await core.connect(owner).createPollWithLinkEscrow(
      groupId,
      "T",
      "cid",
      options,
      start,
      end,
      false,
      0
    );

    const pollId = await core.nextPollId();
    const e = await core.escrows(pollId);

    expect(e.exists).to.equal(true);
    expect(e.sent).to.equal(false);
    expect(e.creator).to.equal(owner.address);
    expect(e.groupId).to.equal(groupId);

    // deposited excludes ops fee (ops fee sent directly)
    expect(e.deposited).to.be.gt(0n);
    expect(e.reservedMaxFee).to.be.gt(0n);
    expect(e.reservedPlatform).to.be.gt(0n);

    // Treasury received ops fee
    const opsFee = await core.opsFeeFlat();
    const treasuryAfter = await link.balanceOf(B.address);
    expect(treasuryAfter - treasuryBefore).to.equal(opsFee);
  });

  it("topUpLink increases escrow and cannot be called after send", async () => {
    const { core, link, owner, A } = await deployCore();

    await core.connect(owner).createGroup("G", "D", 0);
    const groupId = await core.nextGroupId();

    const now = (await ethers.provider.getBlock("latest"))!.timestamp;
    const start = now + 10;
    const end = now + 100;

    await mintAndApproveLink(link, owner, await core.getAddress(), parseEther("100"));
    await core.connect(owner).createPollWithLinkEscrow(
      groupId,
      "T",
      "cid",
      ["Yes", "No"],
      start,
      end,
      false,
      0
    );

    const pollId = await core.nextPollId();
    const before = (await core.escrows(pollId)).deposited;

    // A tops up
    await mintAndApproveLink(link, A, await core.getAddress(), parseEther("10"));
    await core.connect(A).topUpLink(pollId, parseEther("1"));

    const afterTop = (await core.escrows(pollId)).deposited;
    expect(afterTop).to.equal(before + parseEther("1"));

    // Finalize then send, then topup should revert
    await setTime(end + 1);
    await core.finalizePollOnL2(pollId);

    await core.sendResultToL1(pollId);

    await expect(core.connect(A).topUpLink(pollId, parseEther("1")))
      .to.be.revertedWithCustomError(core, "TopUpAfterSend");
  });

  it("sendResultToL1 reverts if not finalized, then works after finalize, and blocks double send", async () => {
    const { core, link, owner, A } = await deployCore();

    await core.connect(owner).createGroup("G", "D", 0);
    const groupId = await core.nextGroupId();

    // add a member (optional)
    await core.connect(owner).setManualMember(groupId, A.address, true);

    const now = (await ethers.provider.getBlock("latest"))!.timestamp;
    const start = now + 10;
    const end = now + 100;

    await mintAndApproveLink(link, owner, await core.getAddress(), parseEther("100"));
    await core.connect(owner).createPollWithLinkEscrow(
      groupId,
      "T",
      "cid",
      ["Yes", "No"],
      start,
      end,
      true,
      5000 // 50% quorum
    );

    const pollId = await core.nextPollId();

    // Not finalized yet
    await expect(core.sendResultToL1(pollId))
      .to.be.revertedWithCustomError(core, "NotFinalized");

    // Move to after end and finalize
    await setTime(end + 1);
    await core.finalizePollOnL2(pollId);

    const tx = await core.sendResultToL1(pollId);
    const receipt = await tx.wait();
    expect(receipt).to.not.equal(null);

    const e = await core.escrows(pollId);
    expect(e.sent).to.equal(true);
    expect(e.messageId).to.not.equal(ethers.ZeroHash);

    // double send
    await expect(core.sendResultToL1(pollId))
      .to.be.revertedWithCustomError(core, "AlreadySent");
  });

  it("withdrawLeftover only by creator and only after send", async () => {
    const { core, link, owner, A } = await deployCore();

    await core.connect(owner).createGroup("G", "D", 0);
    const groupId = await core.nextGroupId();

    const now = (await ethers.provider.getBlock("latest"))!.timestamp;
    const start = now + 10;
    const end = now + 100;

    await mintAndApproveLink(link, owner, await core.getAddress(), parseEther("100"));
    await core.connect(owner).createPollWithLinkEscrow(
      groupId,
      "T",
      "cid",
      ["Yes", "No"],
      start,
      end,
      false,
      0
    );

    const pollId = await core.nextPollId();

    // before send => BadConfig
    await expect(core.withdrawLeftover(pollId)).to.be.revertedWithCustomError(core, "BadConfig");

    await setTime(end + 1);
    await core.finalizePollOnL2(pollId);

    await core.sendResultToL1(pollId);

    // only creator
    await expect(core.connect(A).withdrawLeftover(pollId))
      .to.be.revertedWithCustomError(core, "NotCreator");

    // creator ok
    await core.connect(owner).withdrawLeftover(pollId);
  });
});
