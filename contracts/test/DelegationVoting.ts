import { expect } from "chai";
import { parseEther } from "ethers";
import { network } from "hardhat";

const { ethers } = await network.connect();

describe("DelegationVoting (Hardhat)", function () {
  let snapshotId: string;

  beforeEach(async () => {
    snapshotId = await ethers.provider.send("evm_snapshot", []);
  });

  afterEach(async () => {
    await ethers.provider.send("evm_revert", [snapshotId]);
  });

  async function deployFixture() {
    const [owner, A, B, C] = await ethers.getSigners();

    const MockLink = await ethers.getContractFactory("MockLink");
    const link = (await MockLink.deploy()) as any;

    const MockCcipRouter = await ethers.getContractFactory("MockCcipRouter");
    const router = (await MockCcipRouter.deploy(1n, parseEther("0.001"))) as any;

    const VeritasCore = await ethers.getContractFactory("VeritasCore");
    const core = (await VeritasCore.deploy(
      await router.getAddress(),
      await link.getAddress(),
      1n,
      owner.address,
      owner.address,
      300000n
    )) as any;

    return { core, link, owner, A, B, C };
  }

  async function setTime(ts: number) {
    await ethers.provider.send("evm_setNextBlockTimestamp", [ts]);
    await ethers.provider.send("evm_mine", []);
  }

  async function setupGroupAndPollFixture() {
    const { core, link, owner, A, B, C } = await deployFixture();

    await (await core.connect(owner).createGroup("G", "D", 0)).wait();
    const groupId = await core.nextGroupId();

    await (await core.connect(owner).setManualMember(groupId, A.address, true)).wait();
    await (await core.connect(owner).setManualMember(groupId, B.address, true)).wait();
    await (await core.connect(owner).setManualMember(groupId, C.address, true)).wait();

    const linkAmount = parseEther("10");
    await (await link.connect(owner).mint(owner.address, linkAmount)).wait();
    await (await link.connect(owner).approve(await core.getAddress(), linkAmount)).wait();

    const latest = await ethers.provider.getBlock("latest");
    const startTime = Number(latest!.timestamp) + 10;
    const endTime = startTime + 1000;

    await (await core.connect(owner).createPollWithLinkEscrow(
      groupId,
      "P1",
      "cid",
      ["YES", "NO"],
      startTime,
      endTime,
      false,
      0
    )).wait();

    const pollId = await core.nextPollId();

    return { core, link, owner, A, B, C, groupId, pollId, startTime, endTime };
  }

  it("A->B, C->B, B votes => count=3, revoke locked, B cannot delegate (incoming)", async () => {
    const { core, owner, A, B, C, groupId, pollId, startTime } =
      await setupGroupAndPollFixture()

    await setTime(startTime + 1);

    await (await core.connect(A).delegate(pollId, B.address)).wait();
    await (await core.connect(C).delegate(pollId, B.address)).wait();

    await expect(core.connect(B).delegate(pollId, owner.address))
      .to.be.revertedWithCustomError(core, "DelegationDelegatorHasIncoming")
      .withArgs(pollId, B.address);

    await (await core.connect(B).vote(pollId, 0)).wait();
    const count = await core.voteCounts(pollId, 0);
    expect(count).to.equal(3n);

    await expect(core.connect(A).revoke(pollId))
      .to.be.revertedWithCustomError(core, "DelegationLockedAfterDelegateVoted")
      .withArgs(pollId, A.address, B.address);

    await expect(core.connect(C).revoke(pollId))
      .to.be.revertedWithCustomError(core, "DelegationLockedAfterDelegateVoted")
      .withArgs(pollId, C.address, B.address);

    await expect(core.connect(A).vote(pollId, 0))
      .to.be.revertedWithCustomError(core, "VotingDelegated")
      .withArgs(pollId, A.address, B.address);

    expect(groupId).to.equal(groupId);
  });

  it("Delegator cannot vote while delegated", async () => {
    const { core, A, B, pollId, startTime } =
      await setupGroupAndPollFixture();

    await setTime(startTime + 1);

    await (await core.connect(A).delegate(pollId, B.address)).wait();

    await expect(core.connect(A).vote(pollId, 0))
      .to.be.revertedWithCustomError(core, "VotingDelegated")
      .withArgs(pollId, A.address, B.address);
  });

  it("Revoke works before delegate votes, then can re-delegate to someone else", async () => {
    const { core, A, B, C, pollId, startTime } =
      await setupGroupAndPollFixture();

    await setTime(startTime + 1);

    await (await core.connect(A).delegate(pollId, B.address)).wait();
    await (await core.connect(A).revoke(pollId)).wait();
    await (await core.connect(A).delegate(pollId, C.address)).wait();

    await (await core.connect(C).vote(pollId, 0)).wait();
    const count = await core.voteCounts(pollId, 0);
    expect(count).to.equal(2n);
  });

  it("Delegation is allowed before startTime (current behavior)", async () => {
  const { core, A, B, pollId, startTime } = await setupGroupAndPollFixture();

  await setTime(startTime - 1);

  await (await core.connect(A).delegate(pollId, B.address)).wait();
  });

  it("Cannot delegate outside voting window (after end)", async () => {
    const { core, A, B, pollId, endTime } =
      await setupGroupAndPollFixture();

    await setTime(endTime + 1);

    await expect(core.connect(A).delegate(pollId, B.address)).to.revert(ethers);
  });

  it("Cannot delegate to non-member", async () => {
    const { core, A, pollId, startTime } =
      await setupGroupAndPollFixture();

    await setTime(startTime + 1);

    const signers = await ethers.getSigners();
    const D = signers[4];

    await expect(core.connect(A).delegate(pollId, D.address)).to.revert(ethers);
  });

  it("Cannot create delegation chain: if A delegates to B, then B cannot delegate to C", async () => {
    const { core, A, B, C, pollId, startTime } =
      await setupGroupAndPollFixture();

    await setTime(startTime + 1);

    await (await core.connect(A).delegate(pollId, B.address)).wait();

    await expect(core.connect(B).delegate(pollId, C.address))
      .to.be.revertedWithCustomError(core, "DelegationDelegatorHasIncoming");
  });
});
