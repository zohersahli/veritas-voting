import { expect } from "chai";
import { network } from "hardhat";
import { parseEther } from "ethers";

const { ethers } = await network.connect();

describe("VeritasCore (Hardhat)", function () {
  let snapshotId: string;

  beforeEach(async () => {
    snapshotId = await ethers.provider.send("evm_snapshot", []);
  });

  afterEach(async () => {
    await ethers.provider.send("evm_revert", [snapshotId]);
  });

  async function deployCore() {
    const [owner, A, B, C] = await ethers.getSigners();

    const MockLink = await ethers.getContractFactory("MockLink");
    const link = await MockLink.deploy();

    const MockCcipRouter = await ethers.getContractFactory("MockCcipRouter");
    const router = await MockCcipRouter.deploy(1111n, parseEther("0.001"));

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

  // From VeritasCore.pause.extra.ts
  it("owner can pause/unpause, non-owner cannot", async () => {
    const { core, owner, A } = await deployCore();

    expect(await core.paused()).to.equal(false);

    // Non-owner cannot pause (OZ Ownable v5 custom error)
    await expect(core.connect(A).pause())
      .to.be.revertedWithCustomError(core, "OwnableUnauthorizedAccount")
      .withArgs(A.address);

    // Owner pauses
    await core.connect(owner).pause();
    expect(await core.paused()).to.equal(true);

    // Non-owner cannot unpause
    await expect(core.connect(A).unpause())
      .to.be.revertedWithCustomError(core, "OwnableUnauthorizedAccount")
      .withArgs(A.address);

    // Owner unpauses
    await core.connect(owner).unpause();
    expect(await core.paused()).to.equal(false);
  });
});

