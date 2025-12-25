import { expect } from "chai";
import { network } from "hardhat";
import { parseEther } from "ethers";

const { ethers } = await network.connect();

describe("Delegation final branches (Hardhat)", function () {
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

  async function setupPoll() {
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

  it("delegate reverts when delegator already voted (DelegatorAlreadyVoted branch)", async () => {
    const { core, A, B, pollId } = await setupPoll();

    await core.connect(A).vote(pollId, 0);

    await expect(core.connect(A).delegate(pollId, B.address))
      .to.be.revertedWithCustomError(core, "DelegationDelegatorAlreadyVoted");
  });

  it("revoke reverts when delegate has voted (locked after delegate voted)", async () => {
    const { core, A, B, pollId } = await setupPoll();

    await core.connect(A).delegate(pollId, B.address);
    await core.connect(B).vote(pollId, 0);

    await expect(core.connect(A).revoke(pollId))
      .to.be.revertedWithCustomError(core, "DelegationLockedAfterDelegateVoted");
  });
});
