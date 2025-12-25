import { expect } from "chai";
import { network } from "hardhat";
import { parseEther } from "ethers";

const { ethers } = await network.connect();

describe("FinalizationL2 (Hardhat)", function () {
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
    const link = (await MockLink.deploy()) as any;

    const MockCcipRouter = await ethers.getContractFactory("MockCcipRouter");
    const router = (await MockCcipRouter.deploy(1n, parseEther("0.001"))) as any;

    const VeritasCore = await ethers.getContractFactory("VeritasCore");
    const core = (await VeritasCore.deploy(
      await router.getAddress(), // router
      await link.getAddress(),   // LINK
      1n,                        // destSelector dummy
      owner.address,             // l1Receiver dummy
      owner.address,             // treasury
      300000n                    // receiverGasLimit
    )) as any;

    return { core, link, owner, A, B, C };
  }

  async function setupGroupAndPoll(params?: {
    quorumEnabled?: boolean;
    quorumPercentage?: number;
    startOffsetSec?: number;
    durationSec?: number;
  }) {
    const { core, link, owner, A, B, C } = await deployCore();

    // AR: إنشاء مجموعة Manual وإضافة A,B,C كأعضاء
    // EN: Create Manual group and add A,B,C as members
    await (await core.connect(owner).createGroup("G", "D", 0)).wait();
    const groupId = await core.nextGroupId();

    await (await core.connect(owner).setManualMember(groupId, A.address, true)).wait();
    await (await core.connect(owner).setManualMember(groupId, B.address, true)).wait();
    await (await core.connect(owner).setManualMember(groupId, C.address, true)).wait();

    // AR: تمويل LINK للـ owner حتى createPollWithLinkEscrow يقدر يعمل transferFrom
    // EN: Fund LINK to owner so createPollWithLinkEscrow can transferFrom
    const linkAmount = parseEther("10");
    await (await link.connect(owner).mint(owner.address, linkAmount)).wait();
    await (await link.connect(owner).approve(await core.getAddress(), linkAmount)).wait();

    const latest = await ethers.provider.getBlock("latest");
    const startOffsetSec = params?.startOffsetSec ?? 10;
    const durationSec = params?.durationSec ?? 1000;

    const startTime = Number(latest!.timestamp) + startOffsetSec;
    const endTime = startTime + durationSec;

    const quorumEnabled = params?.quorumEnabled ?? false;
    const quorumPercentage = params?.quorumPercentage ?? 0;

    await (await core.connect(owner).createPollWithLinkEscrow(
      groupId,
      "P1",
      "cid",
      ["YES", "NO"],
      startTime,
      endTime,
      quorumEnabled,
      quorumPercentage
    )).wait();

    const pollId = await core.nextPollId();

    return { core, owner, A, B, C, groupId, pollId, startTime, endTime };
  }

  it("Cannot finalize before endTime", async () => {
    const { core, pollId, startTime } = await setupGroupAndPoll();

    // AR: ندخل داخل نافذة التصويت لكن قبل النهاية
    // EN: Move into voting window but before end
    await setTime(startTime + 1);

    await expect(core.finalizePollOnL2(pollId)).to.revert(ethers);
  });

  it("Finalize works after endTime even if no votes (executes FailedQuorum path)", async () => {
    const { core, pollId, endTime } = await setupGroupAndPoll();

    // AR: بعد نهاية التصويت
    // EN: After voting ends
    await setTime(endTime + 1);

    await (await core.finalizePollOnL2(pollId)).wait();
  });

  it("Finalize works after endTime with votes (quorum disabled path)", async () => {
    const { core, A, B, pollId, startTime, endTime } = await setupGroupAndPoll({
      quorumEnabled: false,
      quorumPercentage: 0
    });

    await setTime(startTime + 1);

    // AR: تصويتين على YES
    // EN: Two votes on YES
    await (await core.connect(A).vote(pollId, 0)).wait();
    await (await core.connect(B).vote(pollId, 0)).wait();

    await setTime(endTime + 1);

    await (await core.finalizePollOnL2(pollId)).wait();
  });

  it("Finalize works after endTime with quorum enabled (executes quorum math path)", async () => {
    const { core, A, pollId, startTime, endTime } = await setupGroupAndPoll({
      quorumEnabled: true,
      quorumPercentage: 60
    });

    await setTime(startTime + 1);

    // AR: صوت واحد فقط, غالبا لن يحقق النصاب
    // EN: Only one vote, likely fails quorum
    await (await core.connect(A).vote(pollId, 0)).wait();

    await setTime(endTime + 1);

    await (await core.finalizePollOnL2(pollId)).wait();
  });

  it("Cannot finalize twice (idempotency)", async () => {
    const { core, A, pollId, startTime, endTime } = await setupGroupAndPoll();

    await setTime(startTime + 1);
    await (await core.connect(A).vote(pollId, 0)).wait();

    await setTime(endTime + 1);
    await (await core.finalizePollOnL2(pollId)).wait();

    // AR: finalize مرة ثانية لازم يفشل
    // EN: Second finalize must revert
    await expect(core.finalizePollOnL2(pollId)).to.revert(ethers);
  });
});
