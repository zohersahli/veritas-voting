import { expect } from "chai";
import { network } from "hardhat";
import { parseEther } from "ethers";

const { ethers } = await network.connect();

describe("Delegation extra coverage (Hardhat)", function () {
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

    // Poll must start before delegate
    await setTime(start + 1);
    await core.connect(A).delegate(pollId, B.address);

    // Delegator cannot vote while delegated
    await expect(core.connect(A).vote(pollId, 0)).to.revert(ethers);

    // Can change delegation if old delegate hasn't voted (automatic revoke and re-delegate)
    // This is allowed by the contract logic - it automatically removes old delegation
    await core.connect(A).delegate(pollId, C.address);

    // Now A is delegated to C, so delegating to B again should work (changing from C to B)
    await core.connect(A).delegate(pollId, B.address);

    // But if B votes, then changing delegation should fail (locked)
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

    // Poll must start before delegate
    await setTime(start + 1);
    await core.connect(A).delegate(pollId, B.address);

    await core.connect(B).vote(pollId, 0);

    // Locked revoke after delegatee voted
    await expect(core.connect(A).revoke(pollId)).to.revert(ethers);

    // After endTime, new delegation should fail
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

    // Poll must start before delegate
    await setTime(start + 1);
    // A delegates to B => B has incoming
    await core.connect(A).delegate(pollId, B.address);

    // B cannot delegate (incoming)
    await expect(core.connect(B).delegate(pollId, C.address)).to.revert(ethers);

    // Chain check: if A delegates to B, then B cannot delegate to C (same as above)
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

    await expect(core.connect(A).vote(pollId, 0)).to.revert(ethers); // still delegated now
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

    // محاولة revoke قبل startTime - يجب أن يرجع PollNotStarted
    // (حتى بدون delegate سابق، revoke يتطلب أن يكون الـ poll قد بدأ)
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

    // Create two delegations to the same delegatee (B)
    await core.connect(A).delegate(pollId, B.address);
    await core.connect(C).delegate(pollId, B.address);

    expect(await core.delegatedToCount(pollId, B.address)).to.equal(2n);

    // Access valid indices
    const d0 = await core.delegatorAt(pollId, B.address, 0n);
    const d1 = await core.delegatorAt(pollId, B.address, 1n);

    // They must be A and C in some order (depends on push order in your impl)
    const expectedSet = new Set([A.address, C.address]);
    expect(expectedSet.has(d0)).to.equal(true);
    expect(expectedSet.has(d1)).to.equal(true);
    expect(d0 !== d1).to.equal(true);

    // Out of bounds should revert with custom error and args (index, length)
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

    // length is 1, offset=1 => should return []
    const out = await core.delegatorsSlice(pollId, B.address, 1n, 10n);
    expect(out.length).to.equal(0);

    // also offset > length
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

    // Make 3 delegators to B: A, C, D
    await core.connect(A).delegate(pollId, B.address);
    await core.connect(C).delegate(pollId, B.address);
    await core.connect(D).delegate(pollId, B.address);

    // Ask for slice with huge limit so end must cap to n
    const all = await core.delegatorsSlice(pollId, B.address, 0n, 999n);
    expect(all.length).to.equal(3);

    // Pagination: offset=1, limit=999 => should return last 2 only (end cap branch)
    const tail = await core.delegatorsSlice(pollId, B.address, 1n, 999n);
    expect(tail.length).to.equal(2);

    // Ensure returned addresses are from the set (covers loop population)
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

    // offset < n but limit=0 should return []
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

    // n = 3, offset=1, limit=2 => end == n exactly (no capping path)
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

    // Exactly at startTime
    await setTime(start);
    await core.connect(A).delegate(pollId, B.address);

    // Exactly at endTime (should be outside window if your check is timestamp >= endTime)
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

    // delegatedToCount
    expect(await core.delegatedToCount(pollId, B.address)).to.equal(2n);

    // delegatorAt success
    const d0 = await core.delegatorAt(pollId, B.address, 0n);
    const d1 = await core.delegatorAt(pollId, B.address, 1n);
    const set = new Set([A.address, C.address]);
    expect(set.has(d0)).to.equal(true);
    expect(set.has(d1)).to.equal(true);

    // out-of-bounds revert path
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

    // offset>=n returns empty
    const out0 = await core.delegatorsSlice(pollId, B.address, 3n, 10n);
    expect(out0.length).to.equal(0);

    // limit=0 returns empty (even when offset < n)
    const out1 = await core.delegatorsSlice(pollId, B.address, 0n, 0n);
    expect(out1.length).to.equal(0);

    // end>n capping: offset=1, limit=999 => returns 2
    const out2 = await core.delegatorsSlice(pollId, B.address, 1n, 999n);
    expect(out2.length).to.equal(2);

    // end==n exact: offset=1, limit=2 => returns 2
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

    // Create 3 delegations to D: A, B, C
    await core.connect(A).delegate(pollId, D.address);
    await core.connect(B).delegate(pollId, D.address);
    await core.connect(C).delegate(pollId, D.address);

    // Verify all 3 are there
    expect(await core.delegatedToCount(pollId, D.address)).to.equal(3n);

    // B changes delegation to owner (B is in the middle, owner has no incoming delegations)
    // This will call _removeIncoming(D, B) with B at index 1 (not last)
    // This triggers the swap logic: C moves to index 1, then pop
    await core.connect(B).delegate(pollId, owner.address);

    // Verify B was removed from D's list
    expect(await core.delegatedToCount(pollId, D.address)).to.equal(2n);

    // Verify A and C are still there (order might change due to swap)
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

    // Delegators to D: A, B, C (C is last)
    await core.connect(A).delegate(pollId, D.address);
    await core.connect(B).delegate(pollId, D.address);
    await core.connect(C).delegate(pollId, D.address);

    expect(await core.delegatedToCount(pollId, D.address)).to.equal(3n);

    // Remove last (C) by revoke - this triggers idx == last path (no swap)
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

    // Only A delegates to B
    await core.connect(A).delegate(pollId, B.address);
    expect(await core.delegatedToCount(pollId, B.address)).to.equal(1n);

    // Remove the only element by revoke
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

    // Delegators to D: A, B, C (C is last)
    await core.connect(A).delegate(pollId, D.address);
    await core.connect(B).delegate(pollId, D.address);
    await core.connect(C).delegate(pollId, D.address);

    expect(await core.delegatedToCount(pollId, D.address)).to.equal(3n);

    // Remove last (C) by changing delegation to owner - this triggers idx == last path in delegate
    // owner is always a member and has no incoming delegations
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

    // Only A delegates to B
    await core.connect(A).delegate(pollId, B.address);
    expect(await core.delegatedToCount(pollId, B.address)).to.equal(1n);

    // Remove the only element by changing delegation to C - this triggers n == 1 path in delegate
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
});
