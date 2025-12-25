import { expect } from "chai";
import { network } from "hardhat";
import { parseEther } from "ethers";

const { ethers } = await network.connect();

describe("Polls StartTimeInPast (Hardhat)", function () {
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

  it("reverts with StartTimeInPast when startTime < block.timestamp (covers Polls.sol 203-204)", async () => {
    const { core, link, owner, A } = await deployCore();

    // Create a manual group + add one member to avoid unrelated membership reverts
    await core.connect(owner).createGroup("G", "D", 0);
    const groupId = await core.nextGroupId();
    await core.connect(owner).setManualMember(groupId, A.address, true);

    // Approve LINK for escrow transferFrom (even though this revert happens earlier)
    await mintAndApprove(link, owner, await core.getAddress(), parseEther("10"));

    // Make the next tx block timestamp deterministic
    const latest = await ethers.provider.getBlock("latest");
    const nowTs = Number(latest!.timestamp) + 100;

    await ethers.provider.send("evm_setNextBlockTimestamp", [nowTs]);

    const startTimePast = nowTs - 1;
    const endTime = nowTs + 1000;

    await expect(
      core.connect(owner).createPollWithLinkEscrow(
        groupId,
        "P1",
        "cid-1",
        ["YES", "NO"],
        startTimePast,
        endTime,
        false,
        0
      )
    )
      .to.be.revertedWithCustomError(core, "StartTimeInPast")
      .withArgs(startTimePast, nowTs);
  });
});
