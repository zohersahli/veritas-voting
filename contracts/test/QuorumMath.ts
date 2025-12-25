import { expect } from "chai";
import { network } from "hardhat";

const { ethers } = await network.connect();

describe("QuorumMath (Hardhat)", function () {
  let snapshotId: string;

  beforeEach(async () => {
    snapshotId = await ethers.provider.send("evm_snapshot", []);
  });

  afterEach(async () => {
    await ethers.provider.send("evm_revert", [snapshotId]);
  });

  async function deployHarness() {
    const Harness = await ethers.getContractFactory("QuorumMathHarness");
    const harness = await Harness.deploy();
    return harness as any;
  }

  it("validateBps: allows 0..10000 and reverts above 10000", async () => {
    const h = await deployHarness();

    await h.validate(0);
    await h.validate(1);
    await h.validate(10_000);

    await expect(h.validate(10_001))
      .to.be.revertedWithCustomError(h, "BadBps")
      .withArgs(10_001);
  });

  it("requiredCount: returns 0 when total==0 or bps==0", async () => {
    const h = await deployHarness();

    expect(await h.required(0, 0)).to.equal(0n);
    expect(await h.required(0, 5_000)).to.equal(0n);
    expect(await h.required(123, 0)).to.equal(0n);
  });

  it("requiredCount: bps==10000 returns total", async () => {
    const h = await deployHarness();

    expect(await h.required(1, 10_000)).to.equal(1n);
    expect(await h.required(100, 10_000)).to.equal(100n);
    expect(await h.required(999, 10_000)).to.equal(999n);
  });

  it("requiredCount: ceil rounding behavior", async () => {
    const h = await deployHarness();

    // ceil(100 * 1 / 10000) = 1
    expect(await h.required(100, 1)).to.equal(1n);

    // ceil(1 * 1 / 10000) = 1
    expect(await h.required(1, 1)).to.equal(1n);

    // ceil(101 * 5000 / 10000) = ceil(50.5) = 51
    expect(await h.required(101, 5_000)).to.equal(51n);

    // ceil(200 * 2500 / 10000) = ceil(50) = 50
    expect(await h.required(200, 2_500)).to.equal(50n);

    // ceil(3 * 3333 / 10000) = ceil(0.9999) = 1
    expect(await h.required(3, 3_333)).to.equal(1n);
  });

  it("requiredCount: reverts on bad bps", async () => {
    const h = await deployHarness();

    await expect(h.required(100, 10_001))
      .to.be.revertedWithCustomError(h, "BadBps")
      .withArgs(10_001);
  });

  it("meetsQuorum: true/false matches requiredCount", async () => {
    const h = await deployHarness();

    // total=101, bps=5000 => required=51
    expect(await h.meets(50, 101, 5_000)).to.equal(false);
    expect(await h.meets(51, 101, 5_000)).to.equal(true);
    expect(await h.meets(99, 101, 5_000)).to.equal(true);

    // bps=0 => required=0 => always true
    expect(await h.meets(0, 999, 0)).to.equal(true);
    expect(await h.meets(10, 999, 0)).to.equal(true);
  });
});
