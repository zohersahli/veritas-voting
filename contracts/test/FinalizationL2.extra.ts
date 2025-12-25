import { expect } from "chai";
import { network } from "hardhat";

const { ethers } = await network.connect();

describe("FinalizationL2 extra coverage (Hardhat)", function () {
  let snapshotId: string;

  beforeEach(async () => {
    snapshotId = await ethers.provider.send("evm_snapshot", []);
  });

  afterEach(async () => {
    await ethers.provider.send("evm_revert", [snapshotId]);
  });

  async function setNext(ts: number) {
    // IMPORTANT: do NOT mine here
    await ethers.provider.send("evm_setNextBlockTimestamp", [ts]);
  }

  async function mine() {
    await ethers.provider.send("evm_mine", []);
  }

  async function setTime(ts: number) {
    // Use this only when you explicitly need a mined block before the next tx
    const latest = await ethers.provider.getBlock("latest");
    const cur = Number(latest!.timestamp);
    const target = ts <= cur ? cur + 1 : ts;
    await setNext(target);
    await mine();
  }

  async function deployHarness() {
    const Harness = await ethers.getContractFactory("FinalizationHarness");
    const h = (await Harness.deploy()) as any;
    return { h };
  }

  it("reverts: poll does not exist (FinalizationPollDoesNotExist)", async () => {
    const { h } = await deployHarness();
    await expect(h.finalizePollOnL2(1))
      .to.be.revertedWithCustomError(h, "FinalizationPollDoesNotExist")
      .withArgs(1);
  });

  it("reverts: poll not ended (FinalizationPollNotEnded) with args", async () => {
    const { h } = await deployHarness();

    const latest = await ethers.provider.getBlock("latest");
    const now0 = Number(latest!.timestamp);

    const pollId = 1;
    const endTime = now0 + 100;

    await h.setPoll(pollId, true, endTime, 2, false, 0);

    const ts = endTime - 1;

    // Only set timestamp for the tx block (do not mine)
    await setNext(ts);

    await expect(h.finalizePollOnL2(pollId))
      .to.be.revertedWithCustomError(h, "FinalizationPollNotEnded")
      .withArgs(pollId, endTime, ts);
  });

  it("reverts: zero options (FinalizationZeroOptions)", async () => {
    const { h } = await deployHarness();

    const latest = await ethers.provider.getBlock("latest");
    const now0 = Number(latest!.timestamp);
    const endTime = now0 + 100;

    const pollId = 2;
    await h.setPoll(pollId, true, endTime, 0, false, 0);

    // set timestamp for tx block only
    await setNext(endTime + 1);

    await expect(h.finalizePollOnL2(pollId))
      .to.be.revertedWithCustomError(h, "FinalizationZeroOptions")
      .withArgs(pollId);
  });

  it("computes winner + totalVotes and tie-break stays on first max", async () => {
    const { h } = await deployHarness();

    const latest = await ethers.provider.getBlock("latest");
    const now0 = Number(latest!.timestamp);
    const endTime = now0 + 100;

    const pollId = 3;
    await h.setPoll(pollId, true, endTime, 3, false, 0);

    // tie between option 0 and 1 -> winner should remain 0
    await h.setVote(pollId, 0, 2);
    await h.setVote(pollId, 1, 2);
    await h.setVote(pollId, 2, 1);

    await setNext(endTime + 1);
    await (await h.finalizePollOnL2(pollId)).wait();

    const r = await h.results(pollId);
    expect(r.finalized).to.equal(true);
    expect(r.winningOption).to.equal(0);
    expect(r.totalVotes).to.equal(5);
    expect(r.status).to.equal(1); // Passed
  });

  it("quorum enabled + supported eligible count: fails quorum when total < required", async () => {
    const { h } = await deployHarness();

    const latest = await ethers.provider.getBlock("latest");
    const now0 = Number(latest!.timestamp);
    const endTime = now0 + 100;

    const pollId = 4;
    await h.setPoll(pollId, true, endTime, 2, true, 6000); // 60%
    await h.setEligible(pollId, true, 10); // required = ceil(10*6000/10000)=6

    await h.setVote(pollId, 0, 5); // totalVotes=5 < 6

    await setNext(endTime + 1);
    await (await h.finalizePollOnL2(pollId)).wait();

    const r = await h.results(pollId);
    expect(r.status).to.equal(2); // FailedQuorum
  });

  it("forced invalid status: reverts with panic 0x21 (enum conversion)", async () => {
    const { h } = await deployHarness();

    const latest = await ethers.provider.getBlock("latest");
    const now0 = Number(latest!.timestamp);
    const endTime = now0 + 100;

    const pollId = 5;
    await h.setPoll(pollId, true, endTime, 2, false, 0);

    // Using harness raw return to produce an invalid ResultStatus value
    // Solidity throws panic 0x21 when converting invalid enum value
    await h.setForcedRaw(pollId, 7);

    await setNext(endTime + 1);

    // Solidity throws panic 0x21 before reaching FinalizationInvalidFinalStatus check
    await expect(h.finalizePollOnL2(pollId)).to.be.revertedWithPanic(0x21);
  });

  it("forced Passed with 0 votes becomes FailedQuorum (safety)", async () => {
    const { h } = await deployHarness();

    const latest = await ethers.provider.getBlock("latest");
    const now0 = Number(latest!.timestamp);
    const endTime = now0 + 100;

    const pollId = 6;
    await h.setPoll(pollId, true, endTime, 2, false, 0);
    await h.setForcedRaw(pollId, 1); // Passed

    await setNext(endTime + 1);
    await (await h.finalizePollOnL2(pollId)).wait();

    const r = await h.results(pollId);
    expect(r.totalVotes).to.equal(0);
    expect(r.status).to.equal(2); // FailedQuorum
  });

  it("quorum overflow: reverts FinalizationQuorumOverflow", async () => {
    const { h } = await deployHarness();

    const latest = await ethers.provider.getBlock("latest");
    const now0 = Number(latest!.timestamp);
    const endTime = now0 + 100;

    const pollId = 7;
    await h.setPoll(pollId, true, endTime, 1, true, 10000);

    await h.setEligible(pollId, true, (2n ** 256n - 1n) / 10000n + 1n); // too large
    await h.setVote(pollId, 0, 1); // ensure totalVotes > 0

    await setNext(endTime + 1);

    await expect(h.finalizePollOnL2(pollId))
      .to.be.revertedWithCustomError(h, "FinalizationQuorumOverflow")
      .withArgs(pollId);
  });

  it("reverts: already finalized (FinalizationAlreadyFinalized)", async () => {
    const { h } = await deployHarness();

    const latest = await ethers.provider.getBlock("latest");
    const now0 = Number(latest!.timestamp);
    const endTime = now0 + 100;

    const pollId = 8;
    await h.setPoll(pollId, true, endTime, 1, false, 0);
    await h.setVote(pollId, 0, 1);

    await setNext(endTime + 1);
    await (await h.finalizePollOnL2(pollId)).wait();

    await expect(h.finalizePollOnL2(pollId))
      .to.be.revertedWithCustomError(h, "FinalizationAlreadyFinalized")
      .withArgs(pollId);
  });
});
