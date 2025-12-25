import { expect } from "chai";
import { network } from "hardhat";
import { parseEther, id } from "ethers";

const { ethers } = await network.connect();

describe("Membership extra2 (Hardhat) - cover isMember branches", function () {
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

    return { core, owner, A, B };
  }

  it("ClaimCode: isMember is false before claim, true after claim (covers ClaimCode isMember path)", async () => {
    const { core, owner, A, B } = await deployCore();

    //  Create group with MembershipType.ClaimCode (assumed enum order: 0 Manual, 1 NFT, 2 ClaimCode)
    //  إنشاء مجموعة بنوع عضوية ClaimCode (نفترض 2)
    await (await core.connect(owner).createGroup("G-CC", "D", 2)).wait();
    const groupId = await core.nextGroupId();

    const codeHash = id("SIMPLE_CODE_1"); // bytes32

    //  Create claim code as owner
    //  إنشاء كود انضمام بواسطة مالك المجموعة
    await (await core.connect(owner).createClaimCode(groupId, codeHash)).wait();

    //  Before claim: nobody is a member (except possibly owner depending on your design)
    //  قبل الـ claim: المفروض المستخدمين ليسوا أعضاء
    expect(await core.isMember(groupId, A.address)).to.equal(false);
    expect(await core.isMember(groupId, B.address)).to.equal(false);

    //  A claims with code
    //  A يعمل claim بالكود
    await (await core.connect(A).claimWithCode(groupId, codeHash)).wait();

    //  After claim: A is member, B is not
    //  بعد claim: A عضو و B ليس عضو
    expect(await core.isMember(groupId, A.address)).to.equal(true);
    expect(await core.isMember(groupId, B.address)).to.equal(false);
  });
});
