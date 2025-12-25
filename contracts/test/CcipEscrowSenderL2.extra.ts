import { expect } from "chai";
import { network } from "hardhat";
import { parseEther } from "ethers";

const { ethers } = await network.connect();

describe("CcipEscrowSenderL2 extra coverage (Hardhat)", function () {
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
    const [owner, A, B, C] = await ethers.getSigners();

    const MockLink = await ethers.getContractFactory("MockLink");
    const link = await MockLink.deploy();

    const MockCcipRouter = await ethers.getContractFactory("MockCcipRouter");
    const router = await MockCcipRouter.deploy(1111n, parseEther("0.001"));

    const VeritasCore = await ethers.getContractFactory("VeritasCore");
    const core = await VeritasCore.deploy(
      await router.getAddress(),
      await link.getAddress(),
      2222n,
      owner.address,
      owner.address,
      300000n
    );

    return { core, link, router, owner, A, B, C };
  }

  async function mintAndApprove(link: any, holder: any, spender: string, amount: bigint) {
    await link.mint(holder.address, amount);
    await link.connect(holder).approve(spender, amount);
  }

  async function finalize(core: any, pollId: bigint) {
    // AR: اسم الدالة عندك finalizePollOnL2
    // EN: call finalizePollOnL2
    await core.finalizePollOnL2(pollId);
  }

  it("admin setters revert on bad config and work on valid values", async () => {
    const { core, owner, A } = await deployCore();

    await expect(core.connect(owner).setTreasury(ethers.ZeroAddress)).to.revert(ethers);
    await expect(core.connect(owner).setL1Receiver(ethers.ZeroAddress)).to.revert(ethers);
    await expect(core.connect(owner).setReceiverGasLimit(0n)).to.revert(ethers);

    await core.connect(owner).setTreasury(A.address);
    expect(await core.treasury()).to.equal(A.address);

    await core.connect(owner).setL1Receiver(A.address);
    expect(await core.l1Receiver()).to.equal(A.address);

    await core.connect(owner).setReceiverGasLimit(123456n);
    expect(await core.receiverGasLimit()).to.equal(123456n);

    await expect(core.connect(owner).setPlatformFeeBps(10001)).to.revert(ethers);
    await expect(core.connect(owner).setFeeMargin(10001, 0n)).to.revert(ethers);

    await core.connect(owner).setPlatformFeeBps(700);
    expect(await core.platformFeeBps()).to.equal(700);

    await core.connect(owner).setFeeMargin(2000, 5n);
    expect(await core.feeMarginBps()).to.equal(2000);
    expect(await core.feeMarginFlat()).to.equal(5n);
  });

  it("topUpLink rejects missing escrow, zero amount, and after send", async () => {
    const { core, link, owner, A, router } = await deployCore();
    await router.setFlatFee(0n);

    await expect(core.connect(A).topUpLink(123n, 1n)).to.revert(ethers);

    await core.connect(owner).createGroup("G", "D", 0);
    const groupId = await core.nextGroupId();

    const now = (await ethers.provider.getBlock("latest"))!.timestamp;
    const start = now + 10;
    const end = now + 100;

    await mintAndApprove(link, owner, await core.getAddress(), parseEther("10"));
    await core.connect(owner).createPollWithLinkEscrow(groupId, "T", "cid", ["Yes", "No"], start, end, false, 0);

    const pollId = await core.nextPollId();

    await expect(core.connect(A).topUpLink(pollId, 0n)).to.revert(ethers);

    await mintAndApprove(link, A, await core.getAddress(), parseEther("1"));
    await core.connect(A).topUpLink(pollId, parseEther("1"));

    await setTime(end + 1);
    await finalize(core, pollId);

    await core.sendResultToL1(pollId);
    await expect(core.connect(A).topUpLink(pollId, 1n)).to.revert(ethers);
  });

  it("sendResultToL1 reverts on MissingEscrow and InsufficientEscrow", async () => {
    const { core, link, owner, router, A } = await deployCore();

    await expect(core.sendResultToL1(999n)).to.revert(ethers);

    // Force high fee so escrow becomes insufficient
    await router.setFlatFee(parseEther("5"));

    await core.connect(owner).createGroup("G", "D", 0);
    const groupId = await core.nextGroupId();
    await core.connect(owner).setManualMember(groupId, A.address, true);

    const now = (await ethers.provider.getBlock("latest"))!.timestamp;
    const start = now + 10;
    const end = now + 100;

    // Give small amount only, create should still compute required and pull it.
    await mintAndApprove(link, owner, await core.getAddress(), parseEther("100"));
    await core.connect(owner).createPollWithLinkEscrow(groupId, "T", "cid", ["Yes", "No"], start, end, false, 0);
    const pollId = await core.nextPollId();

    // Drain escrow manually by setting router fee even higher at send time
    await router.setFlatFee(parseEther("999"));

    await setTime(end + 1);
    await finalize(core, pollId);

    await expect(core.sendResultToL1(pollId)).to.revert(ethers);
  });

  it("claimPlatformFee: fails without ack, then succeeds after ack, and onlyOwner enforced", async () => {
    const { core, link, owner, A, router } = await deployCore();

    await core.connect(owner).createGroup("G", "D", 0);
    const groupId = await core.nextGroupId();
    await core.connect(owner).setManualMember(groupId, A.address, true);

    const now = (await ethers.provider.getBlock("latest"))!.timestamp;
    const start = now + 10;
    const end = now + 100;

    await mintAndApprove(link, owner, await core.getAddress(), parseEther("100"));
    await core.connect(owner).createPollWithLinkEscrow(groupId, "T", "cid", ["Yes", "No"], start, end, false, 0);
    const pollId = await core.nextPollId();

    // Make CCIP fee zero so send and ack do not require LINK balance (after poll creation)
    await router.setFlatFee(0n);

    // Vote to make result Passed
    await setTime(start + 1);
    await core.connect(owner).vote(pollId, 0);

    await setTime(end + 1);
    await finalize(core, pollId);

    await core.sendResultToL1(pollId);

    // Configure ACK allowlist
    await core.connect(owner).setAckConfig(1111n, owner.address);

    // Without ACK -> revert
    await expect(core.connect(owner).claimPlatformFee(pollId)).to.revert(ethers);

    // Send ACK to L2 core through router.ccipSend called by owner
    const inboundMessageId = ethers.hexlify(ethers.randomBytes(32));
    const resultHash = ethers.keccak256(ethers.toUtf8Bytes("result"));
    const data = ethers.AbiCoder.defaultAbiCoder().encode(
      ["uint256", "uint256", "uint8", "bytes32", "bytes32"],
      [groupId, pollId, 1, resultHash, inboundMessageId]
    );

    const receiver = ethers.AbiCoder.defaultAbiCoder().encode(["address"], [await core.getAddress()]);

    const ackMsg = {
      receiver,
      data,
      tokenAmounts: [] as any[],
      extraArgs: "0x",
      feeToken: await link.getAddress(),
    };

    await router.connect(owner).ccipSend(2222n, ackMsg as any);

    // Non-owner cannot claim
    await expect(core.connect(A).claimPlatformFee(pollId)).to.revert(ethers);

    // Owner can claim now
    const treasuryBefore = await link.balanceOf(await core.treasury());
    await core.connect(owner).claimPlatformFee(pollId);
    const treasuryAfter = await link.balanceOf(await core.treasury());
    expect(treasuryAfter).to.be.gte(treasuryBefore);
  });

  it("ccipReceive: rejects wrong router, wrong source selector, wrong sender, and rejects duplicate ack", async () => {
    const { core, link, owner, router } = await deployCore();

    await core.connect(owner).setAckConfig(1111n, owner.address);

    const inboundMessageId = ethers.hexlify(ethers.randomBytes(32));
    const groupId = 1n;
    const pollId = 1n;
    const statusRaw = 1;
    const resultHash = ethers.keccak256(ethers.toUtf8Bytes("x"));

    const data = ethers.AbiCoder.defaultAbiCoder().encode(
      ["uint256", "uint256", "uint8", "bytes32", "bytes32"],
      [groupId, pollId, statusRaw, resultHash, inboundMessageId]
    );

    const msg = {
      messageId: ethers.hexlify(ethers.randomBytes(32)),
      sourceChainSelector: 1111n,
      sender: ethers.AbiCoder.defaultAbiCoder().encode(["address"], [owner.address]),
      data,
      destTokenAmounts: [] as any[],
    };

    // Wrong msg.sender (not router)
    await expect(core.connect(owner).ccipReceive(msg as any)).to.revert(ethers);

    // Impersonate router to call core.ccipReceive properly
    await ethers.provider.send("hardhat_impersonateAccount", [await router.getAddress()]);

    const [funder] = await ethers.getSigners();
    await funder.sendTransaction({ to: await router.getAddress(), value: parseEther("1") });
    const routerSigner = await ethers.getSigner(await router.getAddress());

    // Wrong source selector
    const msgWrongSource = { ...msg, sourceChainSelector: 9999n };
    await expect(core.connect(routerSigner).ccipReceive(msgWrongSource as any)).to.revert(ethers);

    // Wrong sender
    const msgWrongSender = {
      ...msg,
      sender: ethers.AbiCoder.defaultAbiCoder().encode(["address"], [ethers.Wallet.createRandom().address]),
    };
    await expect(core.connect(routerSigner).ccipReceive(msgWrongSender as any)).to.revert(ethers);

    // First valid receive
    await core.connect(routerSigner).ccipReceive(msg as any);

    // Duplicate ack should revert
    await expect(core.connect(routerSigner).ccipReceive(msg as any)).to.revert(ethers);

    await ethers.provider.send("hardhat_stopImpersonatingAccount", [await router.getAddress()]);

    // silence unused
    link;
  });

  it("FailedQuorum path: claimPlatformFee should not be claimable (covers quorum branch)", async () => {
    const { core, link, owner, router, A } = await deployCore();
    await router.setFlatFee(0n);

    await core.connect(owner).createGroup("G", "D", 0);
    const groupId = await core.nextGroupId();
    await core.connect(owner).setManualMember(groupId, A.address, true);

    const now = (await ethers.provider.getBlock("latest"))!.timestamp;
    const start = now + 10;
    const end = now + 30;

    await mintAndApprove(link, owner, await core.getAddress(), parseEther("100"));
    // Quorum enabled مع bps = 6000 (60%)
    await core.connect(owner).createPollWithLinkEscrow(groupId, "T", "cid", ["Yes", "No"], start, end, true, 6000);

    const pollId = await core.nextPollId();

    // بدون أصوات => FailedQuorum بعد finalize
    await setTime(end + 1);
    await finalize(core, pollId);

    await core.sendResultToL1(pollId);

    await core.connect(owner).setAckConfig(1111n, owner.address);

    // Send ACK to simulate L1 acknowledgment
    const inboundMessageId = ethers.hexlify(ethers.randomBytes(32));
    const resultHash = ethers.keccak256(ethers.toUtf8Bytes("result"));
    const data = ethers.AbiCoder.defaultAbiCoder().encode(
      ["uint256", "uint256", "uint8", "bytes32", "bytes32"],
      [groupId, pollId, 1, resultHash, inboundMessageId]
    );

    const receiver = ethers.AbiCoder.defaultAbiCoder().encode(["address"], [await core.getAddress()]);

    const ackMsg = {
      receiver,
      data,
      tokenAmounts: [] as any[],
      extraArgs: "0x",
      feeToken: await link.getAddress(),
    };

    await router.connect(owner).ccipSend(2222n, ackMsg as any);

    // حتى مع ACK، claim platform fee يجب أن يرجع NotReadyStatus لأن status = FailedQuorum
    await expect(core.connect(owner).claimPlatformFee(pollId)).to.revert(ethers);
  });

  it("withdrawLeftover edge cases: handles locked > withdrawable scenario", async () => {
    const { core, link, owner, router, A } = await deployCore();

    await core.connect(owner).createGroup("G", "D", 0);
    const groupId = await core.nextGroupId();
    await core.connect(owner).setManualMember(groupId, A.address, true);

    const now = (await ethers.provider.getBlock("latest"))!.timestamp;
    const start = now + 10;
    const end = now + 100;

    // Set high platform fee to create scenario where reservedPlatform might be high
    await core.connect(owner).setPlatformFeeBps(10000); // 100% platform fee

    await mintAndApprove(link, owner, await core.getAddress(), parseEther("100"));
    await core.connect(owner).createPollWithLinkEscrow(groupId, "T", "cid", ["Yes", "No"], start, end, false, 0);
    const pollId = await core.nextPollId();

    await setTime(end + 1);
    await finalize(core, pollId);

    await core.sendResultToL1(pollId);

    // withdrawLeftover should handle the case where reservedPlatform exists
    // Creator can withdraw leftover (deposited - reservedPlatform)
    await core.connect(owner).withdrawLeftover(pollId);
  });

  it("setOpsFeeFlat: owner can update ops fee flat (covers setOpsFeeFlat branch)", async () => {
    const { core, owner, A } = await deployCore();

    const oldFee = await core.opsFeeFlat();
    expect(oldFee).to.be.gt(0n);

    // Owner can update
    await core.connect(owner).setOpsFeeFlat(parseEther("0.1"));
    expect(await core.opsFeeFlat()).to.equal(parseEther("0.1"));

    // Non-owner cannot update
    await expect(core.connect(A).setOpsFeeFlat(parseEther("0.2"))).to.revert(ethers);
  });
});
