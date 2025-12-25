import { expect } from "chai";
import { network } from "hardhat";
import { parseEther } from "ethers";

const { ethers } = await network.connect();

type MemberKey = "A" | "B" | "C" | "D";

describe("Delegation members + revoke branches (Hardhat)", function () {
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

  async function mintAndApprove(link: any, owner: any, spender: string, amount: bigint) {
    await link.connect(owner).mint(owner.address, amount);
    await link.connect(owner).approve(spender, amount);
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

  it("delegate reverts when delegator is not a member (DelegationNotMember: msg.sender)", async () => {
    // Members: A, B فقط. D ليس عضو.
    const { core, A, B, D, groupId, pollId } = await setupPollWithMembers(["A", "B"]);

    await expect(core.connect(D).delegate(pollId, A.address))
      .to.be.revertedWithCustomError(core, "DelegationNotMember")
      .withArgs(groupId, D.address);
  });

  it("delegate reverts when delegate_ is not a member (DelegationNotMember: delegate_)", async () => {
    // Members: A, B فقط. C ليس عضو. A يحاول يفوض C.
    const { core, A, C, groupId, pollId } = await setupPollWithMembers(["A", "B"]);

    await expect(core.connect(A).delegate(pollId, C.address))
      .to.be.revertedWithCustomError(core, "DelegationNotMember")
      .withArgs(groupId, C.address);
  });

  it("delegate reverts when delegate already voted (DelegationDelegateAlreadyVoted)", async () => {
    const { core, A, B, pollId } = await setupPollWithMembers(["A", "B"]);

    // B يصوت ثم A يحاول يفوضه
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
});
