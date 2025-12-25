import { expect } from "chai";
import { network } from "hardhat";

const { ethers } = await network.connect();

describe("Groups (Hardhat)", function () {
  let snapshotId: string;

  beforeEach(async () => {
    snapshotId = await ethers.provider.send("evm_snapshot", []);
  });

  afterEach(async () => {
    await ethers.provider.send("evm_revert", [snapshotId]);
  });

  const MembershipType = {
    Manual: 0,
    NFT: 1,
    ClaimCode: 2,
  } as const;

  async function setNextTimestamp(ts: number) {
    // EN: Set timestamp for the next mined block (the tx block).
    // AR: نحدد وقت البلوك القادم (بلوك المعاملة نفسها).
    await ethers.provider.send("evm_setNextBlockTimestamp", [ts]);
  }

  async function deployHarness() {
    const [owner, other] = await ethers.getSigners();
    const Harness = await ethers.getContractFactory("GroupsHarness");
    const harness = await Harness.deploy();
    return { owner, other, harness };
  }

  it("createGroup: reverts on empty name (covers EmptyName)", async () => {
    const { harness } = await deployHarness();

    await expect(
      harness.createGroup("", "desc", MembershipType.Manual)
    ).to.be.revertedWithCustomError(harness, "EmptyName");
  });

  it("groupExists: false for missing group, true after create", async () => {
    const { harness } = await deployHarness();

    expect(await harness.groupExists(1n)).to.equal(false);

    await harness.createGroup("G1", "D1", MembershipType.Manual);

    expect(await harness.groupExists(1n)).to.equal(true);
    expect(await harness.groupExists(999n)).to.equal(false);
  });

  it("createGroup: stores group fields, increments nextGroupId, emits GroupCreated", async () => {
    const { owner, harness } = await deployHarness();

    const latest = await ethers.provider.getBlock("latest");
    const ts = (latest?.timestamp ?? Math.floor(Date.now() / 1000)) + 10;
    await setNextTimestamp(ts);

    await expect(
      harness.createGroup("Group One", "Desc One", MembershipType.Manual)
    )
      .to.emit(harness, "GroupCreated")
      .withArgs(1n, owner.address, MembershipType.Manual, "Group One");

    expect(await harness.nextGroupId()).to.equal(1n);

    const g1 = await harness.groups(1n);
    expect(g1.id).to.equal(1n);
    expect(g1.owner).to.equal(owner.address);
    expect(g1.membershipType).to.equal(MembershipType.Manual);
    expect(g1.name).to.equal("Group One");
    expect(g1.description).to.equal("Desc One");
    expect(g1.createdAt).to.equal(BigInt(ts));

    const ts2 = ts + 123;
    await setNextTimestamp(ts2);

    await expect(
      harness.createGroup("Group Two", "Desc Two", MembershipType.NFT)
    )
      .to.emit(harness, "GroupCreated")
      .withArgs(2n, owner.address, MembershipType.NFT, "Group Two");

    expect(await harness.nextGroupId()).to.equal(2n);

    const g2 = await harness.groups(2n);
    expect(g2.id).to.equal(2n);
    expect(g2.owner).to.equal(owner.address);
    expect(g2.membershipType).to.equal(MembershipType.NFT);
    expect(g2.name).to.equal("Group Two");
    expect(g2.description).to.equal("Desc Two");
    expect(g2.createdAt).to.equal(BigInt(ts2));
  });
});
