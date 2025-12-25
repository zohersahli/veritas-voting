import { expect } from "chai";
import { network } from "hardhat";
import { parseEther } from "ethers";

const { ethers } = await network.connect();

describe("Polls extra coverage (Hardhat)", function () {
  let snapshotId: string;

  beforeEach(async () => {
    snapshotId = await ethers.provider.send("evm_snapshot", []);
  });

  afterEach(async () => {
    await ethers.provider.send("evm_revert", [snapshotId]);
  });

  async function deployCore() {
    const [owner, A, B] = await ethers.getSigners();

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

    return { core, link, router, owner, A, B };
  }

  async function mintAndApprove(link: any, holder: any, spender: string, amount: bigint) {
    await link.mint(holder.address, amount);
    await link.connect(holder).approve(spender, amount);
  }

  async function setTime(ts: number) {
    await ethers.provider.send("evm_setNextBlockTimestamp", [ts]);
    await ethers.provider.send("evm_mine", []);
  }

  it("getters return consistent poll info and options", async () => {
    const { core, link, owner, A } = await deployCore();

    await core.connect(owner).createGroup("G", "D", 0);
    const groupId = await core.nextGroupId();
    await core.connect(owner).setManualMember(groupId, A.address, true);

    const now = (await ethers.provider.getBlock("latest"))!.timestamp;
    const start = now + 10;
    const end = now + 100;

    await mintAndApprove(link, owner, await core.getAddress(), parseEther("100"));
    await core.connect(owner).createPollWithLinkEscrow(groupId, "Title", "cid", ["Yes", "No", "Abstain"], start, end, true, 5000);

    const pollId = await core.nextPollId();

    const meta = await core.getPollMeta(pollId);
    expect(meta.title).to.equal("Title");
    expect(meta.cid).to.equal("cid");

    const coreInfo = await core.getPollCore(pollId);
    expect(coreInfo.groupId).to.equal(groupId);

    const len = await core.getOptionsLength(pollId);
    expect(len).to.equal(3n);

    expect(await core.getOption(pollId, 0n)).to.equal("Yes");
    expect(await core.getOption(pollId, 1n)).to.equal("No");
    expect(await core.getOption(pollId, 2n)).to.equal("Abstain");

    // Out of bounds should revert (generic)
    await expect(core.getOption(pollId, 3n)).to.revert(ethers);
  });

  it("uses membership snapshot at creation even if members change later, and group member count queries work", async () => {
    const { core, link, owner, A, B } = await deployCore();

    await core.connect(owner).createGroup("G", "D", 0);
    const groupId = await core.nextGroupId();

    await core.connect(owner).setManualMember(groupId, A.address, true);
    expect(await core.getGroupMemberCount(groupId)).to.equal(1n);

    const now = (await ethers.provider.getBlock("latest"))!.timestamp;
    const start = now + 10;
    const end = now + 100;

    await mintAndApprove(link, owner, await core.getAddress(), parseEther("100"));
    await core.connect(owner).createPollWithLinkEscrow(groupId, "T", "cid", ["Yes", "No"], start, end, false, 0);
    const pollId = await core.nextPollId();

    const poll = await core.getPoll(pollId);
    // eligibleCountSnapshot includes owner (+1), so A + owner = 2
    expect(poll.eligibleCountSnapshot).to.equal(2n);

    // Change members after creation
    await core.connect(owner).setManualMember(groupId, B.address, true);
    expect(await core.getGroupMemberCount(groupId)).to.equal(2n);

    const pollAfter = await core.getPoll(pollId);
    // Snapshot should remain unchanged (A + owner = 2)
    expect(pollAfter.eligibleCountSnapshot).to.equal(2n);
  });

  it("rejects invalid time range and invalid quorum bps (generic revert checks)", async () => {
    const { core, link, owner } = await deployCore();

    await core.connect(owner).createGroup("G", "D", 0);
    const groupId = await core.nextGroupId();

    const now = (await ethers.provider.getBlock("latest"))!.timestamp;
    const start = now + 100;
    const end = now + 10;

    await mintAndApprove(link, owner, await core.getAddress(), parseEther("100"));

    await expect(
      core.connect(owner).createPollWithLinkEscrow(groupId, "T", "cid", ["Yes", "No"], start, end, false, 0)
    ).to.revert(ethers);

    await expect(
      core.connect(owner).createPollWithLinkEscrow(groupId, "T2", "cid", ["Yes", "No"], now + 10, now + 100, true, 10001)
    ).to.revert(ethers);
  });

  it("rejects empty options and empty strings (covers validation branches)", async () => {
    const { core, link, owner } = await deployCore();

    await core.connect(owner).createGroup("G", "D", 0);
    const groupId = await core.nextGroupId();

    const now = (await ethers.provider.getBlock("latest"))!.timestamp;
    const start = now + 10;
    const end = now + 100;

    await mintAndApprove(link, owner, await core.getAddress(), parseEther("100"));

    // Empty options array
    await expect(
      core.connect(owner).createPollWithLinkEscrow(groupId, "T", "cid", [], start, end, false, 0)
    ).to.revert(ethers);

    // Single option (less than 2)
    await expect(
      core.connect(owner).createPollWithLinkEscrow(groupId, "T", "cid", ["Yes"], start, end, false, 0)
    ).to.revert(ethers);

    // Empty title
    await expect(
      core.connect(owner).createPollWithLinkEscrow(groupId, "", "cid", ["Yes", "No"], start, end, false, 0)
    ).to.revert(ethers);

    // Empty cid
    await expect(
      core.connect(owner).createPollWithLinkEscrow(groupId, "T", "", ["Yes", "No"], start, end, false, 0)
    ).to.revert(ethers);

    // Empty option string
    await expect(
      core.connect(owner).createPollWithLinkEscrow(groupId, "T", "cid", ["Yes", ""], start, end, false, 0)
    ).to.revert(ethers);

    // Multiple empty options
    await expect(
      core.connect(owner).createPollWithLinkEscrow(groupId, "T", "cid", ["", "No"], start, end, false, 0)
    ).to.revert(ethers);
  });

  it("rejects invalid quorum configuration (covers quorum branches)", async () => {
    const { core, link, owner } = await deployCore();

    await core.connect(owner).createGroup("G", "D", 0);
    const groupId = await core.nextGroupId();

    const now = (await ethers.provider.getBlock("latest"))!.timestamp;
    const start = now + 10;
    const end = now + 100;

    await mintAndApprove(link, owner, await core.getAddress(), parseEther("100"));

    // Quorum enabled but bps is zero
    await expect(
      core.connect(owner).createPollWithLinkEscrow(groupId, "T", "cid", ["Yes", "No"], start, end, true, 0)
    ).to.revert(ethers);

    // Quorum disabled but bps is non-zero
    await expect(
      core.connect(owner).createPollWithLinkEscrow(groupId, "T", "cid", ["Yes", "No"], start, end, false, 5000)
    ).to.revert(ethers);
  });

  it("poll state transitions and getters with invalid pollId (covers view/state branches)", async () => {
    const { core, link, owner, A } = await deployCore();

    await core.connect(owner).createGroup("G", "D", 0);
    const groupId = await core.nextGroupId();
    await core.connect(owner).setManualMember(groupId, A.address, true);

    const now = (await ethers.provider.getBlock("latest"))!.timestamp;
    const start = now + 20;
    const end = now + 60;

    await mintAndApprove(link, owner, await core.getAddress(), parseEther("100"));
    await core.connect(owner).createPollWithLinkEscrow(groupId, "T", "cid", ["Yes", "No"], start, end, false, 0);
    const pollId = await core.nextPollId();

    // Test getPollCore with non-existent poll (should return false)
    const [exists1] = await core.getPollCore(999999n);
    expect(exists1).to.equal(false);

    // Test getPollMeta with non-existent poll (should revert)
    await expect(core.getPollMeta(999999n)).to.revert(ethers);

    // Test getOptionsLength with non-existent poll (should revert)
    await expect(core.getOptionsLength(999999n)).to.revert(ethers);

    // Test getOption with non-existent poll (should revert)
    await expect(core.getOption(999999n, 0n)).to.revert(ethers);

    // Test getPoll with non-existent poll (should revert)
    await expect(core.getPoll(999999n)).to.revert(ethers);

    // Test exists with non-existent poll
    expect(await core.exists(999999n)).to.equal(false);
    expect(await core.exists(pollId)).to.equal(true);

    // Before start - poll exists but not started
    const [exists2, , startTime, endTime] = await core.getPollCore(pollId);
    expect(exists2).to.equal(true);
    expect(startTime).to.equal(BigInt(start));
    expect(endTime).to.equal(BigInt(end));

    // During voting period
    await setTime(start + 1);
    const pollDuring = await core.getPoll(pollId);
    expect(pollDuring.startTime).to.equal(BigInt(start));
    expect(pollDuring.endTime).to.equal(BigInt(end));

    // After end
    await setTime(end + 1);
    const pollAfter = await core.getPoll(pollId);
    expect(pollAfter.startTime).to.equal(BigInt(start));
    expect(pollAfter.endTime).to.equal(BigInt(end));
  });
});
