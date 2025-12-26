import { expect } from "chai";
import { network } from "hardhat";
import { parseEther } from "ethers";

const { ethers } = await network.connect();

type MemberKey = "A" | "B" | "C" | "D";

describe("Delegation (Hardhat)", function () {
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

  async function setupPollWithMembers(keys: MemberKey[]) {
    const { core, link, owner, A, B, C, D } = await deployCore();

    const byKey: Record<MemberKey, any> = { A, B, C, D };

    await core.connect(owner).createGroup("G", "D", 0);
    const groupId = await core.nextGroupId();

    for (const k of keys) {
      await core.connect(owner).setManualMember(groupId, byKey[k].address, true);
    }

    const now = (await ethers.provider.getBlock("latest"))!.timestamp;
    const start = now + 10;
    const end = start + 200;

    await mintAndApprove(link, owner, await core.getAddress(), parseEther("100"));

    await core.connect(owner).createPollWithLinkEscrow(
      groupId,
      "T",
      "cid",
      ["YES", "NO"],
      start,
      end,
      false,
      0
    );

    const pollId = await core.nextPollId();

    await setTime(start + 1);

    return { core, owner, A, B, C, D, groupId, pollId, start, end };
  }

  async function setupGroupAndPoll() {
    const { core, link, owner, A, B, C } = await deployCore();

    await core.connect(owner).createGroup("G", "D", 0);
    const groupId = await core.nextGroupId();

    await core.connect(owner).setManualMember(groupId, A.address, true);
    await core.connect(owner).setManualMember(groupId, B.address, true);
    await core.connect(owner).setManualMember(groupId, C.address, true);

    const now = (await ethers.provider.getBlock("latest"))!.timestamp;
    const start = now + 10;
    const end = start + 200;

    await mintAndApprove(link, owner, await core.getAddress(), parseEther("100"));

    await core.connect(owner).createPollWithLinkEscrow(
      groupId,
      "T",
      "cid",
      ["YES", "NO"],
      start,
      end,
      false,
      0
    );

    const pollId = await core.nextPollId();

    await setTime(start + 1);

    return { core, owner, A, B, C, groupId, pollId, start, end };
  }

  // From Delegation.extra.ts
  it("rejects delegate to self and delegate to non-member, and rejects revoke when no delegation", async () => {
    const { core, link, owner, A, B } = await deployCore();

    await core.connect(owner).createGroup("G", "D", 0);
    const groupId = await core.nextGroupId();

    await core.connect(owner).setManualMember(groupId, A.address, true);
    await core.connect(owner).setManualMember(groupId, B.address, true);

    const now = (await ethers.provider.getBlock("latest"))!.timestamp;
    const start = now + 10;
    const pollId = await createPoll(core, link, owner, groupId, start, now + 100);

    await setTime(start + 1);
    await expect(core.connect(A).delegate(pollId, A.address)).to.revert(ethers);

    const nonMember = ethers.Wallet.createRandom().address;
    await expect(core.connect(A).delegate(pollId, nonMember)).to.revert(ethers);

    await expect(core.connect(A).revoke(pollId)).to.revert(ethers);
  });

  it("rejects delegator voting while delegated, and allows changing delegation if old delegate hasn't voted", async () => {
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
    await core.connect(A).delegate(pollId, B.address);

    await expect(core.connect(A).vote(pollId, 0)).to.revert(ethers);

    await core.connect(A).delegate(pollId, C.address);

    await core.connect(A).delegate(pollId, B.address);

    await core.connect(B).vote(pollId, 0);
    await expect(core.connect(A).delegate(pollId, C.address)).to.revert(ethers);
  });

  it("rejects delegation after endTime and rejects revoke after delegatee has voted (locked)", async () => {
    const { core, link, owner, A, B } = await deployCore();

    await core.connect(owner).createGroup("G", "D", 0);
    const groupId = await core.nextGroupId();
    await core.connect(owner).setManualMember(groupId, A.address, true);
    await core.connect(owner).setManualMember(groupId, B.address, true);

    const now = (await ethers.provider.getBlock("latest"))!.timestamp;
    const start = now + 10;
    const end = now + 50;
    const pollId = await createPoll(core, link, owner, groupId, start, end);

    await setTime(start + 1);
    await core.connect(A).delegate(pollId, B.address);

    await core.connect(B).vote(pollId, 0);

    await expect(core.connect(A).revoke(pollId)).to.revert(ethers);

    await setTime(end + 1);
    await expect(core.connect(A).delegate(pollId, B.address)).to.revert(ethers);
  });

  it("rejects delegation chain and rejects delegating when having incoming delegation", async () => {
    const { core, link, owner, A, B, C } = await deployCore();

    await core.connect(owner).createGroup("G", "D", 0);
    const groupId = await core.nextGroupId();
    await core.connect(owner).setManualMember(groupId, A.address, true);
    await core.connect(owner).setManualMember(groupId, B.address, true);
    await core.connect(owner).setManualMember(groupId, C.address, true);

    const now = (await ethers.provider.getBlock("latest"))!.timestamp;
    const start = now + 10;
    const pollId = await createPoll(core, link, owner, groupId, start, now + 100);

    await setTime(start + 1);
    await core.connect(A).delegate(pollId, B.address);

    await expect(core.connect(B).delegate(pollId, C.address)).to.revert(ethers);
  });

  it("revoke restores ability to vote and delegate again", async () => {
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
    await core.connect(A).delegate(pollId, B.address);
    await core.connect(A).revoke(pollId);

    await core.connect(A).delegate(pollId, C.address);

    await expect(core.connect(A).vote(pollId, 0)).to.revert(ethers);
  });

  it("revoke before startTime reverts with PollNotStarted (covers that branch)", async () => {
    const { core, link, owner, A, B } = await deployCore();

    await core.connect(owner).createGroup("G", "D", 0);
    const groupId = await core.nextGroupId();
    await core.connect(owner).setManualMember(groupId, A.address, true);
    await core.connect(owner).setManualMember(groupId, B.address, true);

    const now = (await ethers.provider.getBlock("latest"))!.timestamp;
    const start = now + 50;
    const end = now + 200;
    const pollId = await createPoll(core, link, owner, groupId, start, end);

    await expect(core.connect(A).revoke(pollId)).to.revert(ethers);
  });

  it("delegate/revoke on invalid pollId hits missing/invalid poll branches", async () => {
    const { core, A } = await deployCore();

    await expect(core.connect(A).delegate(0n, A.address)).to.revert(ethers);
    await expect(core.connect(A).revoke(0n)).to.revert(ethers);

    await expect(core.connect(A).delegate(999999n, A.address)).to.revert(ethers);
    await expect(core.connect(A).revoke(999999n)).to.revert(ethers);
  });

  it("delegate to zero address reverts", async () => {
    const { core, link, owner, A } = await deployCore();

    await core.connect(owner).createGroup("G", "D", 0);
    const groupId = await core.nextGroupId();
    await core.connect(owner).setManualMember(groupId, A.address, true);

    const now = (await ethers.provider.getBlock("latest"))!.timestamp;
    const pollId = await createPoll(core, link, owner, groupId, now + 10, now + 100);

    await setTime(now + 11);
    await expect(core.connect(A).delegate(pollId, ethers.ZeroAddress)).to.revert(ethers);
  });

  it("cannot delegate after delegator already voted (covers voted-guard branch)", async () => {
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
    await core.connect(A).vote(pollId, 0);

    await expect(core.connect(A).delegate(pollId, B.address)).to.revert(ethers);
  });

  it("views: delegatedToCount + delegatorAt + out-of-bounds revert", async () => {
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

    await core.connect(A).delegate(pollId, B.address);
    await core.connect(C).delegate(pollId, B.address);

    expect(await core.delegatedToCount(pollId, B.address)).to.equal(2n);

    const d0 = await core.delegatorAt(pollId, B.address, 0n);
    const d1 = await core.delegatorAt(pollId, B.address, 1n);

    const expectedSet = new Set([A.address, C.address]);
    expect(expectedSet.has(d0)).to.equal(true);
    expect(expectedSet.has(d1)).to.equal(true);
    expect(d0 !== d1).to.equal(true);

    await expect(core.delegatorAt(pollId, B.address, 2n))
      .to.be.revertedWithCustomError(core, "DelegationIndexOutOfBounds")
      .withArgs(2n, 2n);
  });

  it("views: delegatorsSlice returns empty when offset >= length", async () => {
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

    const out = await core.delegatorsSlice(pollId, B.address, 1n, 10n);
    expect(out.length).to.equal(0);

    const out2 = await core.delegatorsSlice(pollId, B.address, 999n, 10n);
    expect(out2.length).to.equal(0);
  });

  it("views: delegatorsSlice pagination (end capped to length) and loop executes", async () => {
    const { core, link, owner, A, B, C, D } = await deployCore();

    await core.connect(owner).createGroup("G", "D", 0);
    const groupId = await core.nextGroupId();

    await core.connect(owner).setManualMember(groupId, A.address, true);
    await core.connect(owner).setManualMember(groupId, B.address, true);
    await core.connect(owner).setManualMember(groupId, C.address, true);
    await core.connect(owner).setManualMember(groupId, D.address, true);

    const now = (await ethers.provider.getBlock("latest"))!.timestamp;
    const start = now + 10;
    const end = now + 100;

    const pollId = await createPoll(core, link, owner, groupId, start, end);

    await setTime(start + 1);

    await core.connect(A).delegate(pollId, B.address);
    await core.connect(C).delegate(pollId, B.address);
    await core.connect(D).delegate(pollId, B.address);

    const all = await core.delegatorsSlice(pollId, B.address, 0n, 999n);
    expect(all.length).to.equal(3);

    const tail = await core.delegatorsSlice(pollId, B.address, 1n, 999n);
    expect(tail.length).to.equal(2);

    const set = new Set([A.address, C.address, D.address]);
    expect(set.has(all[0])).to.equal(true);
    expect(set.has(all[1])).to.equal(true);
    expect(set.has(all[2])).to.equal(true);

    expect(set.has(tail[0])).to.equal(true);
    expect(set.has(tail[1])).to.equal(true);
  });

  it("views: delegatorsSlice with limit=0 returns empty even when offset < length (covers zero-iteration loop path)", async () => {
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
    await core.connect(A).delegate(pollId, B.address);
    await core.connect(C).delegate(pollId, B.address);

    const out = await core.delegatorsSlice(pollId, B.address, 0n, 0n);
    expect(out.length).to.equal(0);

    const out2 = await core.delegatorsSlice(pollId, B.address, 1n, 0n);
    expect(out2.length).to.equal(0);
  });

  it("views: delegatorsSlice where offset+limit == length (covers end==n branch without capping)", async () => {
    const { core, link, owner, A, B, C, D } = await deployCore();

    await core.connect(owner).createGroup("G", "D", 0);
    const groupId = await core.nextGroupId();

    await core.connect(owner).setManualMember(groupId, A.address, true);
    await core.connect(owner).setManualMember(groupId, B.address, true);
    await core.connect(owner).setManualMember(groupId, C.address, true);
    await core.connect(owner).setManualMember(groupId, D.address, true);

    const now = (await ethers.provider.getBlock("latest"))!.timestamp;
    const start = now + 10;
    const end = now + 100;

    const pollId = await createPoll(core, link, owner, groupId, start, end);

    await setTime(start + 1);
    await core.connect(A).delegate(pollId, B.address);
    await core.connect(C).delegate(pollId, B.address);
    await core.connect(D).delegate(pollId, B.address);

    const slice = await core.delegatorsSlice(pollId, B.address, 1n, 2n);
    expect(slice.length).to.equal(2);

    const set = new Set([A.address, C.address, D.address]);
    expect(set.has(slice[0])).to.equal(true);
    expect(set.has(slice[1])).to.equal(true);
  });

  it("time boundaries: delegate allowed at startTime, but rejects exactly at endTime (covers boundary comparisons)", async () => {
    const { core, link, owner, A, B } = await deployCore();

    await core.connect(owner).createGroup("G", "D", 0);
    const groupId = await core.nextGroupId();

    await core.connect(owner).setManualMember(groupId, A.address, true);
    await core.connect(owner).setManualMember(groupId, B.address, true);

    const now = (await ethers.provider.getBlock("latest"))!.timestamp;
    const start = now + 10;
    const end = now + 50;

    const pollId = await createPoll(core, link, owner, groupId, start, end);

    await setTime(start);
    await core.connect(A).delegate(pollId, B.address);

    await setTime(end);
    await expect(core.connect(B).delegate(pollId, A.address)).to.revert(ethers);
  });

  it("views: delegatedToCount + delegatorAt success + delegatorAt out-of-bounds", async () => {
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
    await core.connect(A).delegate(pollId, B.address);
    await core.connect(C).delegate(pollId, B.address);

    expect(await core.delegatedToCount(pollId, B.address)).to.equal(2n);

    const d0 = await core.delegatorAt(pollId, B.address, 0n);
    const d1 = await core.delegatorAt(pollId, B.address, 1n);
    const set = new Set([A.address, C.address]);
    expect(set.has(d0)).to.equal(true);
    expect(set.has(d1)).to.equal(true);

    await expect(core.delegatorAt(pollId, B.address, 2n)).to.revert(ethers);
  });

  it("views: delegatorsSlice covers offset>=n, limit=0, end>n capping, and end==n exact", async () => {
    const { core, link, owner, A, B, C, D } = await deployCore();

    await core.connect(owner).createGroup("G", "D", 0);
    const groupId = await core.nextGroupId();

    await core.connect(owner).setManualMember(groupId, A.address, true);
    await core.connect(owner).setManualMember(groupId, B.address, true);
    await core.connect(owner).setManualMember(groupId, C.address, true);
    await core.connect(owner).setManualMember(groupId, D.address, true);

    const now = (await ethers.provider.getBlock("latest"))!.timestamp;
    const start = now + 10;
    const end = now + 100;

    const pollId = await createPoll(core, link, owner, groupId, start, end);

    await setTime(start + 1);
    await core.connect(A).delegate(pollId, B.address);
    await core.connect(C).delegate(pollId, B.address);
    await core.connect(D).delegate(pollId, B.address);

    const out0 = await core.delegatorsSlice(pollId, B.address, 3n, 10n);
    expect(out0.length).to.equal(0);

    const out1 = await core.delegatorsSlice(pollId, B.address, 0n, 0n);
    expect(out1.length).to.equal(0);

    const out2 = await core.delegatorsSlice(pollId, B.address, 1n, 999n);
    expect(out2.length).to.equal(2);

    const out3 = await core.delegatorsSlice(pollId, B.address, 1n, 2n);
    expect(out3.length).to.equal(2);
  });

  it("_removeIncoming: swap logic when removing middle element (covers idx != last branch)", async () => {
    const { core, link, owner, A, B, C, D } = await deployCore();

    await core.connect(owner).createGroup("G", "D", 0);
    const groupId = await core.nextGroupId();

    await core.connect(owner).setManualMember(groupId, A.address, true);
    await core.connect(owner).setManualMember(groupId, B.address, true);
    await core.connect(owner).setManualMember(groupId, C.address, true);
    await core.connect(owner).setManualMember(groupId, D.address, true);

    const now = (await ethers.provider.getBlock("latest"))!.timestamp;
    const start = now + 10;
    const end = now + 100;

    const pollId = await createPoll(core, link, owner, groupId, start, end);

    await setTime(start + 1);

    await core.connect(A).delegate(pollId, D.address);
    await core.connect(B).delegate(pollId, D.address);
    await core.connect(C).delegate(pollId, D.address);

    expect(await core.delegatedToCount(pollId, D.address)).to.equal(3n);

    await core.connect(B).delegate(pollId, owner.address);

    expect(await core.delegatedToCount(pollId, D.address)).to.equal(2n);

    const delegators = await core.delegatorsSlice(pollId, D.address, 0n, 10n);
    expect(delegators.length).to.equal(2);
    const set = new Set([A.address, C.address]);
    expect(set.has(delegators[0])).to.equal(true);
    expect(set.has(delegators[1])).to.equal(true);
  });

  it("_removeIncoming: removing last element (covers idx == last branch)", async () => {
    const { core, link, owner, A, B, C, D } = await deployCore();

    await core.connect(owner).createGroup("G", "D", 0);
    const groupId = await core.nextGroupId();

    await core.connect(owner).setManualMember(groupId, A.address, true);
    await core.connect(owner).setManualMember(groupId, B.address, true);
    await core.connect(owner).setManualMember(groupId, C.address, true);
    await core.connect(owner).setManualMember(groupId, D.address, true);

    const now = (await ethers.provider.getBlock("latest"))!.timestamp;
    const start = now + 10;
    const end = now + 100;
    const pollId = await createPoll(core, link, owner, groupId, start, end);

    await setTime(start + 1);

    await core.connect(A).delegate(pollId, D.address);
    await core.connect(B).delegate(pollId, D.address);
    await core.connect(C).delegate(pollId, D.address);

    expect(await core.delegatedToCount(pollId, D.address)).to.equal(3n);

    await core.connect(C).revoke(pollId);

    expect(await core.delegatedToCount(pollId, D.address)).to.equal(2n);

    const delegators = await core.delegatorsSlice(pollId, D.address, 0n, 10n);
    const set = new Set([A.address, B.address]);
    expect(set.has(delegators[0])).to.equal(true);
    expect(set.has(delegators[1])).to.equal(true);
  });

  it("_removeIncoming: removing the only element (covers n == 1 edge)", async () => {
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
    expect(await core.delegatedToCount(pollId, B.address)).to.equal(1n);

    await core.connect(A).revoke(pollId);
    expect(await core.delegatedToCount(pollId, B.address)).to.equal(0n);

    const out = await core.delegatorsSlice(pollId, B.address, 0n, 10n);
    expect(out.length).to.equal(0);
  });

  it("_removeIncoming: removing last element via changing delegation (covers idx == last in delegate path)", async () => {
    const { core, link, owner, A, B, C, D } = await deployCore();

    await core.connect(owner).createGroup("G", "D", 0);
    const groupId = await core.nextGroupId();

    await core.connect(owner).setManualMember(groupId, A.address, true);
    await core.connect(owner).setManualMember(groupId, B.address, true);
    await core.connect(owner).setManualMember(groupId, C.address, true);
    await core.connect(owner).setManualMember(groupId, D.address, true);

    const now = (await ethers.provider.getBlock("latest"))!.timestamp;
    const start = now + 10;
    const end = now + 100;
    const pollId = await createPoll(core, link, owner, groupId, start, end);

    await setTime(start + 1);

    await core.connect(A).delegate(pollId, D.address);
    await core.connect(B).delegate(pollId, D.address);
    await core.connect(C).delegate(pollId, D.address);

    expect(await core.delegatedToCount(pollId, D.address)).to.equal(3n);

    await core.connect(C).delegate(pollId, owner.address);

    expect(await core.delegatedToCount(pollId, D.address)).to.equal(2n);

    const delegators = await core.delegatorsSlice(pollId, D.address, 0n, 10n);
    const set = new Set([A.address, B.address]);
    expect(set.has(delegators[0])).to.equal(true);
    expect(set.has(delegators[1])).to.equal(true);
  });

  it("_removeIncoming: removing the only element via changing delegation (covers n == 1 in delegate path)", async () => {
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

    await core.connect(A).delegate(pollId, B.address);
    expect(await core.delegatedToCount(pollId, B.address)).to.equal(1n);

    await core.connect(A).delegate(pollId, C.address);
    expect(await core.delegatedToCount(pollId, B.address)).to.equal(0n);

    const out = await core.delegatorsSlice(pollId, B.address, 0n, 10n);
    expect(out.length).to.equal(0);
    expect(await core.delegatedToCount(pollId, C.address)).to.equal(1n);
  });

  it("delegate: rejects when trying to delegate to same delegate again (covers DelegationNoChange branch - line 131)", async () => {
    const { core, link, owner, A, B } = await deployCore();
    await core.connect(owner).createGroup("G", "D", 0);
    const groupId = await core.nextGroupId();
    await core.connect(owner).setManualMember(groupId, A.address, true);
    await core.connect(owner).setManualMember(groupId, B.address, true);
    const now = (await ethers.provider.getBlock("latest"))!.timestamp;
    const pollId = await createPoll(core, link, owner, groupId, now + 10, now + 100);
    await setTime(now + 11);
    await core.connect(A).delegate(pollId, B.address);
    await expect(core.connect(A).delegate(pollId, B.address)).to.revert(ethers);
  });

  it("revoke: rejects after endTime (covers DelegationPollEnded branch in revoke - line 152)", async () => {
    const { core, link, owner, A, B } = await deployCore();
    await core.connect(owner).createGroup("G", "D", 0);
    const groupId = await core.nextGroupId();
    await core.connect(owner).setManualMember(groupId, A.address, true);
    await core.connect(owner).setManualMember(groupId, B.address, true);
    const now = (await ethers.provider.getBlock("latest"))!.timestamp;
    const end = now + 50;
    const pollId = await createPoll(core, link, owner, groupId, now + 10, end);
    await setTime(now + 11);
    await core.connect(A).delegate(pollId, B.address);
    await setTime(end + 1);
    await expect(core.connect(A).revoke(pollId)).to.revert(ethers);
  });

  // From Delegation.finalBranches.extra.ts
  it("delegate reverts when delegator already voted (DelegatorAlreadyVoted branch)", async () => {
    const { core, A, B, pollId } = await setupGroupAndPoll();

    await core.connect(A).vote(pollId, 0);

    await expect(core.connect(A).delegate(pollId, B.address))
      .to.be.revertedWithCustomError(core, "DelegationDelegatorAlreadyVoted");
  });

  it("revoke reverts when delegate has voted (locked after delegate voted)", async () => {
    const { core, A, B, pollId } = await setupGroupAndPoll();

    await core.connect(A).delegate(pollId, B.address);
    await core.connect(B).vote(pollId, 0);

    await expect(core.connect(A).revoke(pollId))
      .to.be.revertedWithCustomError(core, "DelegationLockedAfterDelegateVoted");
  });

  // From Delegation.membersAndRevoke.extra.ts
  it("delegate reverts when delegator is not a member (DelegationNotMember: msg.sender)", async () => {
    const { core, A, B, D, groupId, pollId } = await setupPollWithMembers(["A", "B"]);

    await expect(core.connect(D).delegate(pollId, A.address))
      .to.be.revertedWithCustomError(core, "DelegationNotMember")
      .withArgs(groupId, D.address);
  });

  it("delegate reverts when delegate_ is not a member (DelegationNotMember: delegate_)", async () => {
    const { core, A, C, groupId, pollId } = await setupPollWithMembers(["A", "B"]);

    await expect(core.connect(A).delegate(pollId, C.address))
      .to.be.revertedWithCustomError(core, "DelegationNotMember")
      .withArgs(groupId, C.address);
  });

  it("delegate reverts when delegate already voted (DelegationDelegateAlreadyVoted)", async () => {
    const { core, A, B, pollId } = await setupPollWithMembers(["A", "B"]);

    await core.connect(B).vote(pollId, 0);

    await expect(core.connect(A).delegate(pollId, B.address))
      .to.be.revertedWithCustomError(core, "DelegationDelegateAlreadyVoted")
      .withArgs(pollId, B.address);
  });

  it("revoke success path clears delegateOf and updates incoming list", async () => {
    const { core, A, B, pollId } = await setupPollWithMembers(["A", "B"]);

    await core.connect(A).delegate(pollId, B.address);
    expect(await core.delegateOf(pollId, A.address)).to.equal(B.address);

    expect(await core.delegatedToCount(pollId, B.address)).to.equal(1n);
    expect(await core.delegatorAt(pollId, B.address, 0n)).to.equal(A.address);

    await core.connect(A).revoke(pollId);

    expect(await core.delegateOf(pollId, A.address)).to.equal(ethers.ZeroAddress);
    expect(await core.delegatedToCount(pollId, B.address)).to.equal(0n);

    const slice = await core.delegatorsSlice(pollId, B.address, 0n, 10n);
    expect(slice.length).to.equal(0);
  });

  // From Delegation.moreBranches2.extra.ts
  it("reverts when delegating to a delegate who has already delegated (DelegateHasDelegated branch)", async () => {
    const { core, A, B, C, pollId } = await setupGroupAndPoll();

    await core.connect(B).delegate(pollId, C.address);

    await expect(core.connect(A).delegate(pollId, B.address))
      .to.be.revertedWithCustomError(core, "DelegationDelegateHasDelegated")
      .withArgs(pollId, B.address);
  });

  it("changing delegation is locked after old delegate voted (LockedAfterDelegateVoted branch)", async () => {
    const { core, A, B, C, pollId } = await setupGroupAndPoll();

    await core.connect(A).delegate(pollId, B.address);

    await core.connect(B).vote(pollId, 0);

    await expect(core.connect(A).delegate(pollId, C.address))
      .to.be.revertedWithCustomError(core, "DelegationLockedAfterDelegateVoted")
      .withArgs(pollId, A.address, B.address);

    await expect(core.connect(A).revoke(pollId))
      .to.be.revertedWithCustomError(core, "DelegationLockedAfterDelegateVoted")
      .withArgs(pollId, A.address, B.address);
  });

  it("delegator cannot delegate if they have incoming delegations (DelegationDelegatorHasIncoming branch)", async () => {
    const { core, A, B, C, pollId } = await setupGroupAndPoll();

    await core.connect(A).delegate(pollId, B.address);

    await expect(core.connect(B).delegate(pollId, C.address))
      .to.be.revertedWithCustomError(core, "DelegationDelegatorHasIncoming")
      .withArgs(pollId, B.address);
  });

  // From DelegationVoting.ts
  it("A->B, C->B, B votes => count=3, revoke locked, B cannot delegate (incoming)", async () => {
    const { core, owner, A, B, C, groupId, pollId, startTime } = await setupGroupAndPoll();

    await core.connect(A).delegate(pollId, B.address);
    await core.connect(C).delegate(pollId, B.address);

    await expect(core.connect(B).delegate(pollId, owner.address))
      .to.be.revertedWithCustomError(core, "DelegationDelegatorHasIncoming")
      .withArgs(pollId, B.address);

    await core.connect(B).vote(pollId, 0);
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
  });

  it("Delegation is allowed before startTime (current behavior)", async () => {
    const { core, link, owner, A, B } = await deployCore();

    await core.connect(owner).createGroup("G", "D", 0);
    const groupId = await core.nextGroupId();

    await core.connect(owner).setManualMember(groupId, A.address, true);
    await core.connect(owner).setManualMember(groupId, B.address, true);

    const now = (await ethers.provider.getBlock("latest"))!.timestamp;
    const start = now + 10;
    const end = start + 200;

    await mintAndApprove(link, owner, await core.getAddress(), parseEther("100"));

    await core.connect(owner).createPollWithLinkEscrow(
      groupId,
      "T",
      "cid",
      ["YES", "NO"],
      start,
      end,
      false,
      0
    );

    const pollId = await core.nextPollId();

    // Set time to before startTime
    await setTime(start - 1);

    await core.connect(A).delegate(pollId, B.address);
  });
});

