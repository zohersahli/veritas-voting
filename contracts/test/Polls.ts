import { expect } from "chai";
import { network } from "hardhat";
import { parseEther } from "ethers";

const { ethers } = await network.connect();

describe("Polls (Hardhat)", function () {
  let snapshotId: string;

  beforeEach(async () => {
    snapshotId = await ethers.provider.send("evm_snapshot", []);
  });

  afterEach(async () => {
    await ethers.provider.send("evm_revert", [snapshotId]);
  });

  async function deployCore() {
    const [owner, A, B, C, D] = await ethers.getSigners();

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

    return { core, link, owner, A, B, C, D };
  }

  async function setTime(ts: number) {
    await ethers.provider.send("evm_setNextBlockTimestamp", [ts]);
    await ethers.provider.send("evm_mine", []);
  }

  async function getFutureWindow() {
    const latest = await ethers.provider.getBlock("latest");
    const startTime = Number(latest!.timestamp) + 10;
    const endTime = startTime + 1000;
    return { startTime, endTime };
  }

  async function fundLinkAndApprove(link: any, core: any, owner: any, amount = parseEther("10")) {
    await (await link.connect(owner).mint(owner.address, amount)).wait();
    await (await link.connect(owner).approve(await core.getAddress(), amount)).wait();
  }

  async function createManualGroupWithMembers(core: any, owner: any, members: string[]) {
    await (await core.connect(owner).createGroup("G", "D", 0)).wait();
    const groupId = await core.nextGroupId();

    for (const m of members) {
      await (await core.connect(owner).setManualMember(groupId, m, true)).wait();
    }

    return groupId;
  }

  it("Creates poll and stores eligibleCountSnapshot based on group eligible count", async () => {
    const { core, link, owner, A, B } = await deployCore();

    const groupId = await createManualGroupWithMembers(core, owner, [A.address, B.address]);

    // eligible = owner + manual members (2) = 3
    expect(await core.getEligibleCountForQuorum(groupId)).to.equal(3n);

    await fundLinkAndApprove(link, core, owner);

    const { startTime, endTime } = await getFutureWindow();

    await (await core.connect(owner).createPollWithLinkEscrow(
      groupId,
      "P1",
      "cid-1",
      ["YES", "NO"],
      startTime,
      endTime,
      false,
      0
    )).wait();

    const pollId = await core.nextPollId();

    // Use the lightweight getter you added in Polls.sol
    const [exists_, groupId_, start_, end_, eligibleSnap, qEnabled, qBps, optsLen] =
      await core.getPollCore(pollId);

    expect(exists_).to.equal(true);
    expect(groupId_).to.equal(groupId);
    expect(start_).to.equal(BigInt(startTime));
    expect(end_).to.equal(BigInt(endTime));
    expect(eligibleSnap).to.equal(3n);
    expect(qEnabled).to.equal(false);
    expect(qBps).to.equal(0);
    expect(optsLen).to.equal(2n);

    expect(await core.getOption(pollId, 0)).to.equal("YES");
    expect(await core.getOption(pollId, 1)).to.equal("NO");
  });

  it("Reverts if LINK not approved for escrow transferFrom", async () => {
    const { core, link, owner, A } = await deployCore();

    const groupId = await createManualGroupWithMembers(core, owner, [A.address]);

    // Mint LINK but DO NOT approve core
    const linkAmount = parseEther("10");
    await (await link.connect(owner).mint(owner.address, linkAmount)).wait();

    const { startTime, endTime } = await getFutureWindow();

    await expect(
      core.connect(owner).createPollWithLinkEscrow(
        groupId,
        "P1",
        "cid-1",
        ["YES", "NO"],
        startTime,
        endTime,
        false,
        0
      )
    ).to.revert(ethers);
  });

  it("Reverts when startTime >= endTime", async () => {
    const { core, link, owner, A } = await deployCore();

    const groupId = await createManualGroupWithMembers(core, owner, [A.address]);
    await fundLinkAndApprove(link, core, owner);

    const { startTime } = await getFutureWindow();
    const endTime = startTime; // invalid

    await expect(
      core.connect(owner).createPollWithLinkEscrow(
        groupId,
        "P1",
        "cid-1",
        ["YES", "NO"],
        startTime,
        endTime,
        false,
        0
      )
    ).to.be.revertedWithCustomError(core, "BadTimeRange");
  });

  it("Quorum enabled: rejects bad bps (>10000) and allows valid bps", async () => {
    const { core, link, owner, A } = await deployCore();

    const groupId = await createManualGroupWithMembers(core, owner, [A.address]);
    await fundLinkAndApprove(link, core, owner);

    const { startTime, endTime } = await getFutureWindow();

    // bad bps
    await expect(
      core.connect(owner).createPollWithLinkEscrow(
        groupId,
        "P1",
        "cid-1",
        ["YES", "NO"],
        startTime,
        endTime,
        true,
        10001
      )
    ).to.be.revertedWithCustomError(core, "BadQuorumBps");

    // valid bps
    await (await core.connect(owner).createPollWithLinkEscrow(
      groupId,
      "P2",
      "cid-2",
      ["YES", "NO"],
      startTime + 10,
      endTime + 10,
      true,
      6000
    )).wait();

    const pollId = await core.nextPollId();
    const [, , , , , qEnabled, qBps] = await core.getPollCore(pollId);

    expect(qEnabled).to.equal(true);
    expect(qBps).to.equal(6000);
  });

  it("Uses membership snapshot at creation time (changing members later does not change stored snapshot)", async () => {
    const { core, link, owner, A, B, C } = await deployCore();

    const groupId = await createManualGroupWithMembers(core, owner, [A.address, B.address]);
    expect(await core.getEligibleCountForQuorum(groupId)).to.equal(3n);

    await fundLinkAndApprove(link, core, owner);

    const { startTime, endTime } = await getFutureWindow();

    await (await core.connect(owner).createPollWithLinkEscrow(
      groupId,
      "P1",
      "cid-1",
      ["YES", "NO"],
      startTime,
      endTime,
      false,
      0
    )).wait();

    const pollId = await core.nextPollId();
    const [, , , , eligibleSnapBefore] = await core.getPollCore(pollId);
    expect(eligibleSnapBefore).to.equal(3n);

    // Change membership AFTER poll creation
    await (await core.connect(owner).setManualMember(groupId, C.address, true)).wait();
    expect(await core.getEligibleCountForQuorum(groupId)).to.equal(4n);

    // Snapshot must remain unchanged
    const [, , , , eligibleSnapAfter] = await core.getPollCore(pollId);
    expect(eligibleSnapAfter).to.equal(3n);

    // Optional sanity (valid delegation, not self)
    await setTime(startTime + 1);
    await (await core.connect(owner).delegate(pollId, A.address)).wait();
  });
});
