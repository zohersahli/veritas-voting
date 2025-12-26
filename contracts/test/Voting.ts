import { expect } from "chai";
import { network } from "hardhat";
import { parseEther } from "ethers";

const { ethers } = await network.connect();

describe("Voting (Hardhat)", function () {
  let snapshotId: string;

  beforeEach(async () => {
    snapshotId = await ethers.provider.send("evm_snapshot", []);
  });

  afterEach(async () => {
    await ethers.provider.send("evm_revert", [snapshotId]);
  });

  async function setTime(ts: number) {
    await ethers.provider.send("evm_setNextBlockTimestamp", [ts]);
  }

  async function deployCore() {
    const [owner, A, B, C, D] = await ethers.getSigners();

    const MockLink = await ethers.getContractFactory("MockLink");
    const link = await MockLink.deploy();

    const MockCcipRouter = await ethers.getContractFactory("MockCcipRouter");
    const router = await MockCcipRouter.deploy(1111n, parseEther("0"));

    const VeritasCore = await ethers.getContractFactory("VeritasCore");
    const core = await VeritasCore.deploy(
      await router.getAddress(),
      await link.getAddress(),
      2222n,
      owner.address,
      owner.address,
      300000n
    );

    return { core, link, router, owner, A, B, C, D };
  }

  async function mintAndApprove(link: any, holder: any, spender: string, amount: bigint) {
    await link.mint(holder.address, amount);
    await link.connect(holder).approve(spender, amount);
  }

  async function createPoll(core: any, link: any, owner: any, groupId: bigint, start: number, end: number) {
    await mintAndApprove(link, owner, await core.getAddress(), parseEther("100"));
    await core
      .connect(owner)
      .createPollWithLinkEscrow(groupId, "T", "cid", ["Yes", "No"], start, end, false, 0);
    return await core.nextPollId();
  }

  it("reverts: poll does not exist (VotingPollDoesNotExist)", async () => {
    const { core, A } = await deployCore();

    await expect(core.connect(A).vote(999999n, 0n))
      .to.be.revertedWithCustomError(core, "VotingPollDoesNotExist")
      .withArgs(999999n);
  });

  it("reverts: before startTime (VotingPollNotStarted)", async () => {
    const { core, link, owner, A } = await deployCore();

    await core.connect(owner).createGroup("G", "D", 0);
    const groupId = await core.nextGroupId();
    await core.connect(owner).setManualMember(groupId, A.address, true);

    const now = (await ethers.provider.getBlock("latest"))!.timestamp;
    const start = now + 20;
    const end = now + 200;
    const pollId = await createPoll(core, link, owner, groupId, start, end);

    // EN: set timestamp to start-1 to hit "not started" branch
    // AR: نضبط الوقت قبل البداية لتغطية فرع "لم يبدأ"
    await setTime(start - 1);

    await expect(core.connect(A).vote(pollId, 0n))
      .to.be.revertedWithCustomError(core, "VotingPollNotStarted")
      .withArgs(pollId, start, start - 1);
  });

  it("reverts: at endTime (VotingPollEnded)", async () => {
    const { core, link, owner, A } = await deployCore();

    await core.connect(owner).createGroup("G", "D", 0);
    const groupId = await core.nextGroupId();
    await core.connect(owner).setManualMember(groupId, A.address, true);

    const now = (await ethers.provider.getBlock("latest"))!.timestamp;
    const start = now + 10;
    const end = now + 50;
    const pollId = await createPoll(core, link, owner, groupId, start, end);

    // EN: exactly at endTime should revert (nowTs >= endTime)
    // AR: عند endTime بالضبط لازم يرفض
    await setTime(end);

    await expect(core.connect(A).vote(pollId, 0n))
      .to.be.revertedWithCustomError(core, "VotingPollEnded")
      .withArgs(pollId, end, end);
  });

  it("reverts: optionIndex out of bounds (VotingBadOption)", async () => {
    const { core, link, owner, A } = await deployCore();

    await core.connect(owner).createGroup("G", "D", 0);
    const groupId = await core.nextGroupId();
    await core.connect(owner).setManualMember(groupId, A.address, true);

    const now = (await ethers.provider.getBlock("latest"))!.timestamp;
    const start = now + 10;
    const end = now + 100;
    const pollId = await createPoll(core, link, owner, groupId, start, end);

    await setTime(start);

    await expect(core.connect(A).vote(pollId, 2n))
      .to.be.revertedWithCustomError(core, "VotingBadOption")
      .withArgs(2n);
  });

  it("reverts: not a member (VotingNotMember)", async () => {
    const { core, link, owner, A, D } = await deployCore();

    await core.connect(owner).createGroup("G", "D", 0);
    const groupId = await core.nextGroupId();

    // Only A is a manual member, D is not
    await core.connect(owner).setManualMember(groupId, A.address, true);

    const now = (await ethers.provider.getBlock("latest"))!.timestamp;
    const start = now + 10;
    const end = now + 100;
    const pollId = await createPoll(core, link, owner, groupId, start, end);

    await setTime(start);

    await expect(core.connect(D).vote(pollId, 0n))
      .to.be.revertedWithCustomError(core, "VotingNotMember")
      .withArgs(groupId, D.address);
  });

  it("reverts: delegator cannot vote while delegated (VotingDelegated)", async () => {
    const { core, link, owner, A, B } = await deployCore();

    await core.connect(owner).createGroup("G", "D", 0);
    const groupId = await core.nextGroupId();

    await core.connect(owner).setManualMember(groupId, A.address, true);
    await core.connect(owner).setManualMember(groupId, B.address, true);

    const now = (await ethers.provider.getBlock("latest"))!.timestamp;
    const start = now + 10;
    const end = now + 100;
    const pollId = await createPoll(core, link, owner, groupId, start, end);

    await setTime(start + 1);
    await core.connect(A).delegate(pollId, B.address);

    await expect(core.connect(A).vote(pollId, 0n))
      .to.be.revertedWithCustomError(core, "VotingDelegated")
      .withArgs(pollId, A.address, B.address);
  });

  it("reverts: already voted (SharedErrors.AlreadyVoted)", async () => {
    const { core, link, owner, A } = await deployCore();

    await core.connect(owner).createGroup("G", "D", 0);
    const groupId = await core.nextGroupId();
    await core.connect(owner).setManualMember(groupId, A.address, true);

    const now = (await ethers.provider.getBlock("latest"))!.timestamp;
    const start = now + 10;
    const end = now + 100;
    const pollId = await createPoll(core, link, owner, groupId, start, end);

    await setTime(start + 1);

    await core.connect(A).vote(pollId, 0n);

    await expect(core.connect(A).vote(pollId, 0n))
      .to.be.revertedWithCustomError(core, "AlreadyVoted")
      .withArgs(pollId, A.address);
  });

  it("success: vote weight increases with incoming delegations (voteCounts increments by 3)", async () => {
    const { core, link, owner, A, B, C } = await deployCore();

    await core.connect(owner).createGroup("G", "D", 0);
    const groupId = await core.nextGroupId();

    await core.connect(owner).setManualMember(groupId, A.address, true);
    await core.connect(owner).setManualMember(groupId, B.address, true);
    await core.connect(owner).setManualMember(groupId, C.address, true);

    const now = (await ethers.provider.getBlock("latest"))!.timestamp;
    const start = now + 10;
    const end = now + 100;
    const pollId = await createPoll(core, link, owner, groupId, start, end);

    await setTime(start + 1);

    // EN: A and C delegate to B, then B votes with weight 3
    // AR: A و C يفوضون B ثم B يصوت بوزن 3
    await core.connect(A).delegate(pollId, B.address);
    await core.connect(C).delegate(pollId, B.address);

    await expect(core.connect(B).vote(pollId, 0n))
      .to.emit(core, "VoteCastWeighted")
      .withArgs(pollId, B.address, 0n, 3n);

    const count = await core.voteCounts(pollId, 0n);
    expect(count).to.equal(3n);
  });
});

