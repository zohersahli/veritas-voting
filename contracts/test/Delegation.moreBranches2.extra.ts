import { expect } from "chai";
import { network } from "hardhat";
import { parseEther } from "ethers";

const { ethers } = await network.connect();

describe("Delegation more branches 2 (Hardhat)", function () {
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

    return { core, link, router, owner, A, B, C };
  }

  async function mintAndApprove(link: any, owner: any, spender: string, amount: bigint) {
    await link.connect(owner).mint(owner.address, amount);
    await link.connect(owner).approve(spender, amount);
  }

  async function setupGroupAndPoll() {
    const { core, link, owner, A, B, C } = await deployCore();

    // EN: Create manual group and add members. Owner is implicitly eligible in your logic.
    // AR: إنشاء مجموعة Manual وإضافة الأعضاء. المالك عادةً محسوب ضمن المؤهلين في منطقك.
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

    // move into voting window
    await setTime(start + 1);

    return { core, owner, A, B, C, groupId, pollId, start, end };
  }

  it("reverts when delegating to a delegate who has already delegated (DelegateHasDelegated branch)", async () => {
    const { core, A, B, C, pollId } = await setupGroupAndPoll();

    // EN: B delegates to C first. Then A tries to delegate to B, but B has delegated already.
    // AR: B يفوض C أولاً. ثم A يحاول التفويض إلى B لكن B مفوض بالفعل.
    await core.connect(B).delegate(pollId, C.address);

    await expect(core.connect(A).delegate(pollId, B.address))
      .to.be.revertedWithCustomError(core, "DelegationDelegateHasDelegated")
      .withArgs(pollId, B.address);
  });

  it("changing delegation is locked after old delegate voted (LockedAfterDelegateVoted branch)", async () => {
    const { core, A, B, C, pollId } = await setupGroupAndPoll();

    // EN: A delegates to B.
    // AR: A يفوض إلى B.
    await core.connect(A).delegate(pollId, B.address);

    // EN: B votes, which should lock A from changing/revoking.
    // AR: B يصوت، وهذا يجب أن يقفل A عن التغيير أو الإلغاء.
    await core.connect(B).vote(pollId, 0);

    await expect(core.connect(A).delegate(pollId, C.address))
      .to.be.revertedWithCustomError(core, "DelegationLockedAfterDelegateVoted")
      .withArgs(pollId, A.address, B.address);

    // Optional: also ensure revoke is locked by the same condition (if your revoke uses the same error)
    await expect(core.connect(A).revoke(pollId))
      .to.be.revertedWithCustomError(core, "DelegationLockedAfterDelegateVoted")
      .withArgs(pollId, A.address, B.address);
  });

  it("delegator cannot delegate if they have incoming delegations (DelegatorHasIncoming branch)", async () => {
    const { core, A, B, C, pollId } = await setupGroupAndPoll();

    // EN: A delegates to B, so B now has incoming delegations.
    // AR: A يفوض إلى B، بالتالي B صار عنده incoming.
    await core.connect(A).delegate(pollId, B.address);

    // EN: B tries to delegate to C, should revert because B has incoming delegators.
    // AR: B يحاول التفويض إلى C، يجب أن يفشل لأنه لديه incoming delegators.
    await expect(core.connect(B).delegate(pollId, C.address))
      .to.be.revertedWithCustomError(core, "DelegationDelegatorHasIncoming")
      .withArgs(pollId, B.address);
  });
});
