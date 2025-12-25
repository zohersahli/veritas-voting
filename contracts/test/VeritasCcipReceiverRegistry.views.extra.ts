import { expect } from "chai";
import { network } from "hardhat";
import { parseEther } from "ethers";

const { ethers } = await network.connect();

describe("VeritasCcipReceiverRegistry views extra coverage (Hardhat)", function () {
  let snapshotId: string;

  beforeEach(async () => {
    snapshotId = await ethers.provider.send("evm_snapshot", []);
  });

  afterEach(async () => {
    await ethers.provider.send("evm_revert", [snapshotId]);
  });

  async function deployRegistry() {
    const [owner] = await ethers.getSigners();

    // EN: Deploy a mock router so CCIPReceiver constructor gets a non-zero router.
    // AR: ننشر Mock Router حتى يكون عنوان الـ router غير صفر.
    const MockCcipRouter = await ethers.getContractFactory("MockCcipRouter");
    const router = await MockCcipRouter.deploy(1111n, parseEther("0"));

    const VeritasCcipReceiverRegistry = await ethers.getContractFactory("VeritasCcipReceiverRegistry");

    // ملاحظة مهمة:
    // إذا كان constructor عندك مختلف, عدل ترتيب/عدد البراميتر هنا فقط.
    // الهدف من الاختبار هو استدعاء getRecord/isRecorded لتغطية سطور الـ views.
    const registry = await VeritasCcipReceiverRegistry.deploy(
      await router.getAddress(),
      1111n,          // allowedSourceChainSelector (any non-zero for deploy)
      owner.address   // allowedSender (any non-zero for deploy)
    );

    return { registry, router, owner };
  }

  it("covers getRecord + isRecorded views for missing record", async () => {
    const { registry } = await deployRegistry();

    const groupId = 1n;
    const pollId = 1n;

    // View: isRecorded should be false when no record exists
    expect(await registry.isRecorded(groupId, pollId)).to.equal(false);

    // View: getRecord returns a struct, and recorded should be false by default
    const rec = await registry.getRecord(groupId, pollId);
    expect(rec.recorded).to.equal(false);
  });
});
