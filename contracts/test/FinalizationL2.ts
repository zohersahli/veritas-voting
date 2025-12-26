import { expect } from "chai";
import { network } from "hardhat";
import { parseEther } from "ethers";

const { ethers } = await network.connect();

describe("FinalizationL2 (Hardhat)", function () {
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

  async function setNext(ts: number) {
    // IMPORTANT: do NOT mine here
    await ethers.provider.send("evm_setNextBlockTimestamp", [ts]);
  }

  async function mine() {
    await ethers.provider.send("evm_mine", []);
  }

  async function deployCore() {
    const [owner, A, B, C] = await ethers.getSigners();

    const MockLink = await ethers.getContractFactory("MockLink");
    const link = (await MockLink.deploy()) as any;

    const MockCcipRouter = await ethers.getContractFactory("MockCcipRouter");
    const router = (await MockCcipRouter.deploy(1n, parseEther("0.001"))) as any;

    const VeritasCore = await ethers.getContractFactory("VeritasCore");
    const core = (await VeritasCore.deploy(
      await router.getAddress(), // router
      await link.getAddress(),   // LINK
      1n,                        // destSelector dummy
      owner.address,             // l1Receiver dummy
      owner.address,             // treasury
      300000n                    // receiverGasLimit
    )) as any;

    return { core, link, owner, A, B, C };
  }

  async function deployHarness() {
    const Harness = await ethers.getContractFactory("FinalizationHarness");
    const h = (await Harness.deploy()) as any;
    return { h };
  }

  async function setupGroupAndPoll(params?: {
    quorumEnabled?: boolean;
    quorumPercentage?: number;
    startOffsetSec?: number;
    durationSec?: number;
  }) {
    const { core, link, owner, A, B, C } = await deployCore();

    // AR: إنشاء مجموعة Manual وإضافة A,B,C كأعضاء
    // EN: Create Manual group and add A,B,C as members
    await (await core.connect(owner).createGroup("G", "D", 0)).wait();
    const groupId = await core.nextGroupId();

    await (await core.connect(owner).setManualMember(groupId, A.address, true)).wait();
    await (await core.connect(owner).setManualMember(groupId, B.address, true)).wait();
    await (await core.connect(owner).setManualMember(groupId, C.address, true)).wait();

    // AR: تمويل LINK للـ owner حتى createPollWithLinkEscrow يقدر يعمل transferFrom
    // EN: Fund LINK to owner so createPollWithLinkEscrow can transferFrom
    const linkAmount = parseEther("10");
    await (await link.connect(owner).mint(owner.address, linkAmount)).wait();
    await (await link.connect(owner).approve(await core.getAddress(), linkAmount)).wait();

    const latest = await ethers.provider.getBlock("latest");
    const startOffsetSec = params?.startOffsetSec ?? 10;
    const durationSec = params?.durationSec ?? 1000;

    const startTime = Number(latest!.timestamp) + startOffsetSec;
    const endTime = startTime + durationSec;

    const quorumEnabled = params?.quorumEnabled ?? false;
    const quorumPercentage = params?.quorumPercentage ?? 0;

    await (await core.connect(owner).createPollWithLinkEscrow(
      groupId,
      "P1",
      "cid",
      ["YES", "NO"],
      startTime,
      endTime,
      quorumEnabled,
      quorumPercentage
    )).wait();

    const pollId = await core.nextPollId();

    return { core, owner, A, B, C, groupId, pollId, startTime, endTime };
  }

  it("Cannot finalize before endTime", async () => {
    const { core, owner, pollId, startTime } = await setupGroupAndPoll();

    // AR: ندخل داخل نافذة التصويت لكن قبل النهاية
    // EN: Move into voting window but before end
    await setTime(startTime + 1);

    await expect(core.connect(owner).finalizePollOnL2(pollId))
      .to.be.revertedWithCustomError(core, "FinalizationPollNotEnded");
  });

  it("Finalizes after endTime and computes winner correctly", async () => {
    const { core, owner, pollId, endTime, A, B, C } = await setupGroupAndPoll();

    // AR: ندخل نافذة التصويت ونصوت
    // EN: Enter voting window and vote
    await setTime(endTime - 500);
    await (await core.connect(A).vote(pollId, 0n)).wait(); // YES
    await (await core.connect(B).vote(pollId, 0n)).wait(); // YES
    await (await core.connect(C).vote(pollId, 1n)).wait(); // NO

    // AR: ننتظر حتى endTime وننهي
    // EN: Wait until endTime and finalize
    await setTime(endTime + 1);

    await expect(core.connect(owner).finalizePollOnL2(pollId))
      .to.emit(core, "PollFinalized")
      .withArgs(pollId, 1, 0n, 3n); // status=1 (Passed), winner=0 (YES), totalVotes=3

    const result = await core.results(pollId);
    expect(result.finalized).to.equal(true);
    expect(result.winningOption).to.equal(0);
    expect(result.totalVotes).to.equal(3n);
    expect(result.status).to.equal(1); // Passed
  });

  it("Quorum enabled: fails when total votes < required", async () => {
    const { core, owner, pollId, endTime, A } = await setupGroupAndPoll({
      quorumEnabled: true,
      quorumPercentage: 5000, // 50%
    });

    // AR: eligibleCount = 4 (owner + A + B + C), required = ceil(4 * 5000 / 10000) = 2
    // EN: eligibleCount = 4, required = ceil(4 * 5000 / 10000) = 2
    // AR: نصوت صوت واحد فقط (أقل من المطلوب)
    // EN: Vote only once (less than required)
    await setTime(endTime - 500);
    await (await core.connect(A).vote(pollId, 0n)).wait();

    await setTime(endTime + 1);

    await expect(core.connect(owner).finalizePollOnL2(pollId))
      .to.emit(core, "PollFinalized")
      .withArgs(pollId, 2, 0n, 1n); // status=2 (FailedQuorum), winner=0, totalVotes=1

    const result = await core.results(pollId);
    expect(result.status).to.equal(2); // FailedQuorum
  });

  it("Quorum enabled: passes when total votes >= required", async () => {
    const { core, owner, pollId, endTime, A, B } = await setupGroupAndPoll({
      quorumEnabled: true,
      quorumPercentage: 5000, // 50%
    });

    // AR: required = ceil(4 * 5000 / 10000) = 2
    // EN: required = ceil(4 * 5000 / 10000) = 2
    // AR: نصوت صوتين (يساوي المطلوب)
    // EN: Vote twice (equals required)
    await setTime(endTime - 500);
    await (await core.connect(A).vote(pollId, 0n)).wait();
    await (await core.connect(B).vote(pollId, 0n)).wait();

    await setTime(endTime + 1);

    await expect(core.connect(owner).finalizePollOnL2(pollId))
      .to.emit(core, "PollFinalized")
      .withArgs(pollId, 1, 0n, 2n); // status=1 (Passed), winner=0, totalVotes=2

    const result = await core.results(pollId);
    expect(result.status).to.equal(1); // Passed
  });

  // From FinalizationL2.extra.ts
  it("reverts: poll does not exist (FinalizationPollDoesNotExist)", async () => {
    const { h } = await deployHarness();
    await expect(h.finalizePollOnL2(1))
      .to.be.revertedWithCustomError(h, "FinalizationPollDoesNotExist")
      .withArgs(1);
  });

  it("reverts: poll not ended (FinalizationPollNotEnded) with args", async () => {
    const { h } = await deployHarness();

    const latest = await ethers.provider.getBlock("latest");
    const now0 = Number(latest!.timestamp);

    const pollId = 1;
    const endTime = now0 + 100;

    await h.setPoll(pollId, true, endTime, 2, false, 0);

    const ts = endTime - 1;

    // Only set timestamp for the tx block (do not mine)
    await setNext(ts);

    await expect(h.finalizePollOnL2(pollId))
      .to.be.revertedWithCustomError(h, "FinalizationPollNotEnded")
      .withArgs(pollId, endTime, ts);
  });

  it("reverts: zero options (FinalizationZeroOptions)", async () => {
    const { h } = await deployHarness();

    const latest = await ethers.provider.getBlock("latest");
    const now0 = Number(latest!.timestamp);
    const endTime = now0 + 100;

    const pollId = 2;
    await h.setPoll(pollId, true, endTime, 0, false, 0);

    // set timestamp for tx block only
    await setNext(endTime + 1);

    await expect(h.finalizePollOnL2(pollId))
      .to.be.revertedWithCustomError(h, "FinalizationZeroOptions")
      .withArgs(pollId);
  });

  it("computes winner + totalVotes and tie-break stays on first max", async () => {
    const { h } = await deployHarness();

    const latest = await ethers.provider.getBlock("latest");
    const now0 = Number(latest!.timestamp);
    const endTime = now0 + 100;

    const pollId = 3;
    await h.setPoll(pollId, true, endTime, 3, false, 0);

    // tie between option 0 and 1 -> winner should remain 0
    await h.setVote(pollId, 0, 2);
    await h.setVote(pollId, 1, 2);
    await h.setVote(pollId, 2, 1);

    await setNext(endTime + 1);
    await (await h.finalizePollOnL2(pollId)).wait();

    const r = await h.results(pollId);
    expect(r.finalized).to.equal(true);
    expect(r.winningOption).to.equal(0);
    expect(r.totalVotes).to.equal(5);
    expect(r.status).to.equal(1); // Passed
  });

  it("quorum enabled + supported eligible count: fails quorum when total < required", async () => {
    const { h } = await deployHarness();

    const latest = await ethers.provider.getBlock("latest");
    const now0 = Number(latest!.timestamp);
    const endTime = now0 + 100;

    const pollId = 4;
    await h.setPoll(pollId, true, endTime, 2, true, 6000); // 60%
    await h.setEligible(pollId, true, 10); // required = ceil(10*6000/10000)=6

    await h.setVote(pollId, 0, 5); // totalVotes=5 < 6

    await setNext(endTime + 1);
    await (await h.finalizePollOnL2(pollId)).wait();

    const r = await h.results(pollId);
    expect(r.status).to.equal(2); // FailedQuorum
  });

  it("forced invalid status: reverts with panic 0x21 (enum conversion)", async () => {
    const { h } = await deployHarness();

    const latest = await ethers.provider.getBlock("latest");
    const now0 = Number(latest!.timestamp);
    const endTime = now0 + 100;

    const pollId = 5;
    await h.setPoll(pollId, true, endTime, 2, false, 0);

    // Using harness raw return to produce an invalid ResultStatus value
    // Solidity throws panic 0x21 when converting invalid enum value
    await h.setForcedRaw(pollId, 7);

    await setNext(endTime + 1);

    // Solidity throws panic 0x21 before reaching FinalizationInvalidFinalStatus check
    await expect(h.finalizePollOnL2(pollId)).to.be.revertedWithPanic(0x21);
  });

  it("forced Passed with 0 votes becomes FailedQuorum (safety)", async () => {
    const { h } = await deployHarness();

    const latest = await ethers.provider.getBlock("latest");
    const now0 = Number(latest!.timestamp);
    const endTime = now0 + 100;

    const pollId = 6;
    await h.setPoll(pollId, true, endTime, 2, false, 0);
    await h.setForcedRaw(pollId, 1); // Passed

    await setNext(endTime + 1);
    await (await h.finalizePollOnL2(pollId)).wait();

    const r = await h.results(pollId);
    expect(r.totalVotes).to.equal(0);
    expect(r.status).to.equal(2); // FailedQuorum
  });

  it("quorum overflow: reverts FinalizationQuorumOverflow", async () => {
    const { h } = await deployHarness();

    const latest = await ethers.provider.getBlock("latest");
    const now0 = Number(latest!.timestamp);
    const endTime = now0 + 100;

    const pollId = 7;
    await h.setPoll(pollId, true, endTime, 1, true, 10000);
    await h.setEligible(pollId, true, (2n ** 256n - 1n) / 10000n + 1n); // too large
    await h.setVote(pollId, 0, 1); // ensure totalVotes > 0

    await setNext(endTime + 1);

    await expect(h.finalizePollOnL2(pollId))
      .to.be.revertedWithCustomError(h, "FinalizationQuorumOverflow")
      .withArgs(pollId);
  });

  it("reverts: already finalized (FinalizationAlreadyFinalized)", async () => {
    const { h } = await deployHarness();

    const latest = await ethers.provider.getBlock("latest");
    const now0 = Number(latest!.timestamp);
    const endTime = now0 + 100;

    const pollId = 8;
    await h.setPoll(pollId, true, endTime, 1, false, 0);
    await h.setVote(pollId, 0, 1);

    await setNext(endTime + 1);
    await (await h.finalizePollOnL2(pollId)).wait();

    await expect(h.finalizePollOnL2(pollId))
      .to.be.revertedWithCustomError(h, "FinalizationAlreadyFinalized")
      .withArgs(pollId);
  });
});

