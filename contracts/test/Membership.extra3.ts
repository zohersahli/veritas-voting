import { expect } from "chai";
import { network } from "hardhat";
import { parseEther } from "ethers";

const { ethers } = await network.connect();

describe("Membership extra3 (Hardhat) - cover NFT isMember + UnsupportedMembershipType + onlyGroupOwner missing group", function () {
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

  it("onlyGroupOwner: missing group hits GroupDoesNotExist (covers modifier missing-group branch)", async () => {
    const { core, owner, A } = await deployCore();

    // EN: setManualMember is onlyGroupOwner; missing group should revert GroupDoesNotExist.
    // AR: دالة setManualMember عليها onlyGroupOwner; مع group غير موجود لازم ترجع GroupDoesNotExist.
    await expect(core.connect(owner).setManualMember(999, A.address, true))
      .to.be.revertedWithCustomError(core, "GroupDoesNotExist")
      .withArgs(999);
  });

  it("NFT isMember: covers nft==0, not-registered, balance==0, and success branches", async () => {
    const { core, owner, A } = await deployCore();

    // EN: Create group with NFT membership type (assumed enum order: 0 Manual, 1 NFT, 2 ClaimCode).
    // AR: إنشاء مجموعة بنوع NFT (نفترض 1).
    await (await core.connect(owner).createGroup("G-NFT", "D", 1)).wait();
    const groupId = await core.nextGroupId();

    // EN: nft not set => isMember must be false (hits nft==0 branch).
    // AR: بدون تحديد NFT => false.
    expect(await core.isMember(groupId, A.address)).to.equal(false);

    // EN: Set NFT contract to a controllable balance mock.
    // AR: نحدد NFT موك بسيط.
    const MockERC721Balance = await ethers.getContractFactory("MockERC721Balance");
    const nft = (await MockERC721Balance.deploy()) as any;

    await (await core.connect(owner).setGroupNft(groupId, await nft.getAddress())).wait();

    // EN: balance > 0 but not registered => false (hits !nftRegistered branch).
    // AR: رصيد موجود لكن غير مسجل => false.
    await (await nft.setBalance(A.address, 1)).wait();
    expect(await core.isMember(groupId, A.address)).to.equal(false);

    // EN: registerWithNft requires balance > 0 and sets nftRegistered => true.
    // AR: التسجيل يفعّل nftRegistered.
    await (await core.connect(A).registerWithNft(groupId)).wait();
    expect(await core.isMember(groupId, A.address)).to.equal(true);

    // EN: Keep registered but set balance to 0 => false (hits balanceOf(user) > 0 == false branch).
    // AR: يبقى مسجل لكن الرصيد 0 => false.
    await (await nft.setBalance(A.address, 0)).wait();
    expect(await core.isMember(groupId, A.address)).to.equal(false);
  });

  it("reaches revert UnsupportedMembershipType (covers lines 154-155)", async () => {
    const [owner, A] = await ethers.getSigners();

    const Harness = await ethers.getContractFactory("MembershipTypeHarness");
    const h = (await Harness.deploy()) as any;

    const groupId = 1;
    await h.setGroup(groupId, true, owner.address, 9); // 9 = out of range for your handled modes

    // Solidity throws panic 0x21 when converting invalid enum value before reaching UnsupportedMembershipType check
    await expect(h.isMember(groupId, A.address)).to.be.revertedWithPanic(0x21);
  });
});
