import { expect } from "chai";
import { network } from "hardhat";
import { parseEther, AbiCoder, keccak256, randomBytes, toBeHex } from "ethers";

const { ethers } = await network.connect();

describe("CcipEscrowSenderL2 more branches (Hardhat)", function () {
  let snapshotId: string;

  beforeEach(async () => {
    snapshotId = await ethers.provider.send("evm_snapshot", []);
  });

  afterEach(async () => {
    await ethers.provider.send("evm_revert", [snapshotId]);
  });

  async function deployCore() {
    const [owner, A, B, C] = await ethers.getSigners();

    const MockLink = await ethers.getContractFactory("MockLink");
    const link = await MockLink.deploy();

    const MockCcipRouter = await ethers.getContractFactory("MockCcipRouter");
    // EN: Small fee to keep tests deterministic
    // AR: Fee صغير حتى يبقى الاختبار ثابت
    const router = await MockCcipRouter.deploy(1111n, parseEther("0.001"));

    const VeritasCore = await ethers.getContractFactory("VeritasCore");
    const core = await VeritasCore.deploy(
      await router.getAddress(),
      await link.getAddress(),
      2222n, // destination chain selector (L2 -> L1)
      owner.address, // l1Receiver (dummy for tests)
      owner.address, // treasury
      300000n // receiver gas limit
    );

    return { core, link, router, owner, A, B, C };
  }

  async function setTime(ts: number) {
    await ethers.provider.send("evm_setNextBlockTimestamp", [ts]);
    await ethers.provider.send("evm_mine", []);
  }

  async function getFutureWindow() {
    const latest = await ethers.provider.getBlock("latest");
    const startTime = Number(latest!.timestamp) + 10;
    const endTime = startTime + 100;
    return { startTime, endTime };
  }

  async function mintAndApprove(link: any, holder: any, spender: string, amount = parseEther("100")) {
    await (await link.connect(holder).mint(holder.address, amount)).wait();
    await (await link.connect(holder).approve(spender, amount)).wait();
  }

  async function createManualGroup(core: any, owner: any, members: string[]) {
    await (await core.connect(owner).createGroup("G", "D", 0)).wait();
    const groupId = await core.nextGroupId();
    for (const m of members) {
      await (await core.connect(owner).setManualMember(groupId, m, true)).wait();
    }
    return groupId;
  }

  it("sendResultToL1 clears reservedPlatform when status is not Passed, and withdrawLeftover (locked==0) returns all", async () => {
    const { core, link, owner, A } = await deployCore();

    const groupId = await createManualGroup(core, owner, [A.address]);
    await mintAndApprove(link, owner, await core.getAddress(), parseEther("200"));

    const { startTime, endTime } = await getFutureWindow();

    // EN: Enable quorum so 0 votes becomes FailedQuorum
    // AR: تفعيل النصاب حتى 0 أصوات يصير FailedQuorum
    await (await core.connect(owner).createPollWithLinkEscrow(
      groupId,
      "P",
      "cid",
      ["YES", "NO"],
      startTime,
      endTime,
      true,
      8000
    )).wait();

    const pollId = await core.nextPollId();

    // Move after end and finalize (no votes)
    await setTime(endTime + 1);
    await (await core.connect(owner).finalizePollOnL2(pollId)).wait();

    // Before send: reservedPlatform should be > 0 (default platformFeeBps=700)
    const eBefore = await core.escrows(pollId);
    expect(eBefore.reservedPlatform).to.be.gt(0n);

    // Send to L1: since status != Passed, reservedPlatform must be cleared
    await (await core.connect(owner).sendResultToL1(pollId)).wait();

    const eAfterSend = await core.escrows(pollId);
    expect(eAfterSend.sent).to.equal(true);
    expect(eAfterSend.reservedPlatform).to.equal(0n); // covers: if (r.status != Passed) { e.reservedPlatform = 0; }

    // Withdraw leftovers: locked==0 branch, should transfer everything to creator
    const ownerBalBefore = await link.balanceOf(owner.address);
    await (await core.connect(owner).withdrawLeftover(pollId)).wait();
    const ownerBalAfter = await link.balanceOf(owner.address);

    expect(ownerBalAfter).to.be.gt(ownerBalBefore);
    const eAfterWithdraw = await core.escrows(pollId);
    expect(eAfterWithdraw.deposited).to.equal(0n);
  });

  it("ccipReceive: wrong ack sender reverts, correct ack sender succeeds and sets ackReceived", async () => {
    const { core, router, owner } = await deployCore();

    // EN: Configure ACK allowlist
    // AR: إعداد السماح للـ ACK
    const ackSourceSelector = 9999n;
    const ackSender = owner.address;
    await (await core.connect(owner).setAckConfig(ackSourceSelector, ackSender)).wait();

    const groupId = 1n;
    const pollId = 2n;

    const coder = AbiCoder.defaultAbiCoder();
    const k = keccak256(coder.encode(["uint256", "uint256"], [groupId, pollId]));

    const buildMsg = (senderAddr: string) => {
      const senderBytes = coder.encode(["address"], [senderAddr]);
      const data = coder.encode(
        ["uint256", "uint256", "uint8", "bytes32", "bytes32"],
        [groupId, pollId, 1, keccak256(toBeHex(123)), keccak256(toBeHex(456))]
      );

      return {
        messageId: keccak256(randomBytes(32)),
        sourceChainSelector: ackSourceSelector,
        sender: senderBytes,
        data,
        destTokenAmounts: [] as any[],
      };
    };

    // EN: Impersonate router so msg.sender == ccipRouter
    // AR: انتحال عنوان الراوتر حتى msg.sender يكون الراوتر
    const routerAddr = await router.getAddress();
    await ethers.provider.send("hardhat_setBalance", [routerAddr, "0x1000000000000000000"]);
    await ethers.provider.send("hardhat_impersonateAccount", [routerAddr]);
    const routerSigner = await ethers.getSigner(routerAddr);

    // Wrong sender should revert UnauthorizedAckSender (covers that branch)
    const wrongSender = "0x000000000000000000000000000000000000dEaD";
    await expect(core.connect(routerSigner).ccipReceive(buildMsg(wrongSender))).to.be.revertedWithCustomError(
      core,
      "UnauthorizedAckSender"
    );

    // Correct sender succeeds and sets ackReceived[k] = true (covers happy path + ackReceived write)
    await (await core.connect(routerSigner).ccipReceive(buildMsg(ackSender))).wait();
    expect(await core.ackReceived(k)).to.equal(true);

    // Duplicate should revert AckAlreadyProcessed
    await expect(core.connect(routerSigner).ccipReceive(buildMsg(ackSender))).to.be.revertedWithCustomError(
      core,
      "AckAlreadyProcessed"
    );

    await ethers.provider.send("hardhat_stopImpersonatingAccount", [routerAddr]);
  });

  it("claimPlatformFee: reservedPlatform == 0 should revert BadConfig (pf==0 branch)", async () => {
    const { core, link, router, owner, A } = await deployCore();

    // EN: Make platform fee zero so reservedPlatform becomes 0
    // AR: نجعل رسوم المنصة 0 حتى reservedPlatform تصير 0
    await (await core.connect(owner).setPlatformFeeBps(0)).wait();

    const groupId = await createManualGroup(core, owner, [A.address]);
    await mintAndApprove(link, owner, await core.getAddress(), parseEther("200"));

    const { startTime, endTime } = await getFutureWindow();

    await (await core.connect(owner).createPollWithLinkEscrow(
      groupId,
      "P",
      "cid",
      ["YES", "NO"],
      startTime,
      endTime,
      false,
      0
    )).wait();

    const pollId = await core.nextPollId();

    // Vote during window so status becomes Passed
    await setTime(startTime + 1);
    await (await core.connect(A).vote(pollId, 0)).wait();

    // Finalize after end
    await setTime(endTime + 1);
    await (await core.connect(owner).finalizePollOnL2(pollId)).wait();

    // Send result to L1
    await (await core.connect(owner).sendResultToL1(pollId)).wait();

    // Configure ACK and deliver it (must be from router)
    const ackSourceSelector = 9999n;
    const ackSender = owner.address;
    await (await core.connect(owner).setAckConfig(ackSourceSelector, ackSender)).wait();

    const coder = AbiCoder.defaultAbiCoder();
    const senderBytes = coder.encode(["address"], [ackSender]);
    const data = coder.encode(
      ["uint256", "uint256", "uint8", "bytes32", "bytes32"],
      [groupId, pollId, 1, keccak256(toBeHex(123)), keccak256(toBeHex(456))]
    );

    const msgObj = {
      messageId: keccak256(randomBytes(32)),
      sourceChainSelector: ackSourceSelector,
      sender: senderBytes,
      data,
      destTokenAmounts: [] as any[],
    };

    const routerAddr = await router.getAddress();
    await ethers.provider.send("hardhat_setBalance", [routerAddr, "0x1000000000000000000"]);
    await ethers.provider.send("hardhat_impersonateAccount", [routerAddr]);
    const routerSigner = await ethers.getSigner(routerAddr);

    await (await core.connect(routerSigner).ccipReceive(msgObj)).wait();
    await ethers.provider.send("hardhat_stopImpersonatingAccount", [routerAddr]);

    // reservedPlatform should be 0 -> claimPlatformFee reverts BadConfig (pf==0 branch)
    await expect(core.connect(owner).claimPlatformFee(pollId)).to.be.revertedWithCustomError(core, "BadConfig");
  });
});
