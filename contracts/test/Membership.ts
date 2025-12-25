import { expect } from "chai";
import { network } from "hardhat";
import { parseEther } from "ethers";

const { ethers } = await network.connect();

describe("Membership (Hardhat)", function () {
  let snapshotId: string;

  beforeEach(async () => {
    snapshotId = await ethers.provider.send("evm_snapshot", []);
  });

  afterEach(async () => {
    await ethers.provider.send("evm_revert", [snapshotId]);
  });

  async function deployCore() {
    const [owner, A, B, C, D] = await ethers.getSigners();

    const MockLink = await ethers.getContractFactory("MockLink");
    const link = await MockLink.deploy();

    const MockCcipRouter = await ethers.getContractFactory("MockCcipRouter");
    const router = await MockCcipRouter.deploy(1n, parseEther("0.001"));

    const VeritasCore = await ethers.getContractFactory("VeritasCore");
    const core = (await VeritasCore.deploy(
      await router.getAddress(),
      await link.getAddress(),
      1n,
      owner.address,
      owner.address,
      300000n
    )) as any;

    return { core, link, owner, A, B, C, D };
  }

  function codeHash(text: string) {
    return ethers.keccak256(ethers.toUtf8Bytes(text));
  }

  describe("Views and type safety", function () {
      async function getSlot(addr: string, slot: bigint) {
        return await ethers.provider.getStorage(addr, slot);
      }

      async function setSlot(addr: string, slot: bigint, value32: string) {
        await ethers.provider.send("hardhat_setStorageAt", [addr, ethers.toBeHex(slot), value32]);
      }

      function normHex32(x: string) {
        const h = x.startsWith("0x") ? x.slice(2) : x;
        return h.toLowerCase().padStart(64, "0");
      }

      // EN: Find the mapping slot index for `groups` by detecting the slot that contains owner address.
      // AR: إيجاد رقم slot الخاص بـ mapping groups عبر مطابقة owner داخل التخزين.
      async function findGroupsMappingSlotIndex(params: {
        coreAddr: string;
        groupId: bigint;
        ownerAddr: string;
        maxScan?: number;
      }) {
        const abi = ethers.AbiCoder.defaultAbiCoder();
        const ownerTail = params.ownerAddr.toLowerCase().slice(2).padStart(40, "0");

        const max = params.maxScan ?? 200;
        for (let i = 0; i <= max; i++) {
          const encoded = abi.encode(["uint256", "uint256"], [params.groupId, BigInt(i)]);
          const base = BigInt(ethers.keccak256(encoded));
          const slot1 = base + 1n; // Group struct slot1 (owner packed here)
          const v = normHex32(await getSlot(params.coreAddr, slot1));
          if (v.endsWith(ownerTail)) {
            return { groupsSlotIndex: i, ownerPackedSlot: slot1, ownerPackedValueHex64: v };
          }
        }
        throw new Error("Could not locate groups mapping slot index (scan failed)");
      }

      // EN: Change the 1-byte enum right before the last 20 bytes (address) in the packed slot.
      // AR: تعديل بايت واحد (membershipType) الموجود قبل العنوان مباشرة داخل slot المعبأ.
      function overwriteMembershipTypeByte(packedHex64: string, newType: number) {
        const hex = packedHex64; // 64 chars, no 0x
        const typeHex = newType.toString(16).padStart(2, "0");

        // Layout assumption:
        // [ .... | 1 byte membershipType | 20 bytes owner address ]
        // owner = last 40 hex chars, type = 2 hex chars right before it
        const typePos = 64 - 40 - 2; // 22
        return hex.slice(0, typePos) + typeHex + hex.slice(typePos + 2);
      }

      it("reverts on missing group (covers onlyExistingGroup -> GroupDoesNotExist)", async () => {
        const { core, A } = await deployCore();
        await expect(core.isMember(999n, A.address)).to.be.revertedWithCustomError(core, "GroupDoesNotExist").withArgs(999n);
      });

      it("strict isMember: reverts on MembershipTypeMismatch, succeeds when correct (fix overload ambiguity)", async () => {
        const { core, owner, A } = await deployCore();

        await core.connect(owner).createGroup("G", "D", 0); // Manual
        const groupId = await core.nextGroupId();

        // Wrong expected type: asking for NFT while actual is Manual
        await expect(core["isMember(uint256,address,uint8)"](groupId, A.address, 1))
          .to.be.revertedWithCustomError(core, "MembershipTypeMismatch")
          .withArgs(0, 1);

        // Correct expected type
        expect(await core["isMember(uint256,address,uint8)"](groupId, A.address, 0)).to.equal(false);
      });

      it("isMember: covers UnsupportedMembershipType by storage poke (enum out of range)", async () => {
        const { core, owner, A } = await deployCore();

        await core.connect(owner).createGroup("G", "D", 0); // create valid group first
        const groupId = await core.nextGroupId();

        const coreAddr = await core.getAddress();

        // Find packed slot that contains owner + membershipType
        const found = await findGroupsMappingSlotIndex({
          coreAddr,
          groupId: BigInt(groupId),
          ownerAddr: owner.address,
          maxScan: 250,
        });

        // Overwrite membershipType to 99
        const oldHex64 = found.ownerPackedValueHex64;
        const newHex64 = overwriteMembershipTypeByte(oldHex64, 99);

        await setSlot(coreAddr, found.ownerPackedSlot, "0x" + newHex64);

        await expect(core.isMember(groupId, A.address))
          .to.be.revertedWithPanic(0x21);
      });
  });

  describe("Manual", function () {
    it("setManualMember adds/removes and updates counts", async () => {
      const { core, owner, A } = await deployCore();

      await core.connect(owner).createGroup("G", "D", 0);
      const groupId = await core.nextGroupId();

      expect(await core.getGroupMemberCount(groupId)).to.equal(0n);
      expect(await core.getEligibleCountForQuorum(groupId)).to.equal(1n);

      await core.connect(owner).setManualMember(groupId, A.address, true);

      expect(await core.getGroupMemberCount(groupId)).to.equal(1n);
      expect(await core.getEligibleCountForQuorum(groupId)).to.equal(2n);
      expect(await core.isMember(groupId, A.address)).to.equal(true);

      await core.connect(owner).setManualMember(groupId, A.address, false);

      expect(await core.getGroupMemberCount(groupId)).to.equal(0n);
      expect(await core.getEligibleCountForQuorum(groupId)).to.equal(1n);
      expect(await core.isMember(groupId, A.address)).to.equal(false);
    });

    it("setManualMember: covers early return path when no state change (still emits ManualMemberSet)", async () => {
      const { core, owner, A } = await deployCore();

      await core.connect(owner).createGroup("G", "D", 0);
      const groupId = await core.nextGroupId();

      // First set to true
      await core.connect(owner).setManualMember(groupId, A.address, true);
      expect(await core.getGroupMemberCount(groupId)).to.equal(1n);

      // Set to true again -> early return
      await expect(core.connect(owner).setManualMember(groupId, A.address, true))
        .to.emit(core, "ManualMemberSet")
        .withArgs(groupId, A.address, true);

      // Count unchanged
      expect(await core.getGroupMemberCount(groupId)).to.equal(1n);
    });

    it("cannot set zero address, cannot set owner, only owner can manage", async () => {
      const { core, owner, A } = await deployCore();

      await core.connect(owner).createGroup("G", "D", 0);
      const groupId = await core.nextGroupId();

      await expect(core.connect(owner).setManualMember(groupId, ethers.ZeroAddress, true))
        .to.be.revertedWithCustomError(core, "ZeroAddress");

      await expect(core.connect(owner).setManualMember(groupId, owner.address, true))
        .to.be.revertedWithCustomError(core, "OwnerMembershipImmutable")
        .withArgs(groupId, owner.address);

      await expect(core.connect(A).setManualMember(groupId, A.address, true))
        .to.be.revertedWithCustomError(core, "NotGroupOwner")
        .withArgs(groupId);
    });

    it("setManualMember: reverts in NFT mode (covers UnsupportedMembershipType in setManualMember)", async () => {
      const { core, owner, A } = await deployCore();

      // 1 = NFT
      await core.connect(owner).createGroup("G", "D", 1);
      const groupId = await core.nextGroupId();

      await expect(core.connect(owner).setManualMember(groupId, A.address, true))
        .to.be.revertedWithCustomError(core, "UnsupportedMembershipType")
        .withArgs(1);
    });
  });

  describe("NFT", function () {
    it("setGroupNft: reverts on zero address, only works in NFT mode, and only owner", async () => {
      const { core, owner, A } = await deployCore();

      // Manual group
      await core.connect(owner).createGroup("G1", "D", 0);
      const manualGroupId = await core.nextGroupId();

      const MockERC721 = await ethers.getContractFactory("MockERC721");
      const nft = (await MockERC721.deploy("MockNFT", "MNFT")) as any;

      // mismatch: Manual vs NFT
      await expect(core.connect(owner).setGroupNft(manualGroupId, await nft.getAddress()))
        .to.be.revertedWithCustomError(core, "MembershipTypeMismatch")
        .withArgs(0, 1);

      // NFT group
      await core.connect(owner).createGroup("G2", "D", 1);
      const groupId = await core.nextGroupId();

      await expect(core.connect(owner).setGroupNft(groupId, ethers.ZeroAddress))
        .to.be.revertedWithCustomError(core, "ZeroAddress");

      await expect(core.connect(A).setGroupNft(groupId, await nft.getAddress()))
        .to.be.revertedWithCustomError(core, "NotGroupOwner")
        .withArgs(groupId);

      await expect(core.connect(owner).setGroupNft(groupId, await nft.getAddress()))
        .to.emit(core, "GroupNftSet")
        .withArgs(groupId, await nft.getAddress());
    });

    it("registerWithNft/unregisterFromNft: covers mismatch, owner restriction, already registered, mismatch on unregister", async () => {
      const { core, owner, A } = await deployCore();

      const MockERC721 = await ethers.getContractFactory("MockERC721");
      const nft = (await MockERC721.deploy("MockNFT", "MNFT")) as any;

      // mismatch: register in Manual group
      await core.connect(owner).createGroup("G1", "D", 0);
      const manualGroupId = await core.nextGroupId();

      await expect(core.connect(A).registerWithNft(manualGroupId))
        .to.be.revertedWithCustomError(core, "MembershipTypeMismatch")
        .withArgs(0, 1);

      await expect(core.connect(A).unregisterFromNft(manualGroupId))
        .to.be.revertedWithCustomError(core, "MembershipTypeMismatch")
        .withArgs(0, 1);

      // proper NFT group
      await core.connect(owner).createGroup("G2", "D", 1);
      const groupId = await core.nextGroupId();

      // owner cannot register (covers OwnerMembershipImmutable in NFT register)
      await expect(core.connect(owner).registerWithNft(groupId))
        .to.be.revertedWithCustomError(core, "OwnerMembershipImmutable")
        .withArgs(groupId, owner.address);

      // set nft
      await core.connect(owner).setGroupNft(groupId, await nft.getAddress());

      // mint to A, register
      await (await nft.mint(A.address)).wait();
      await core.connect(A).registerWithNft(groupId);

      // already registered
      await expect(core.connect(A).registerWithNft(groupId))
        .to.be.revertedWithCustomError(core, "NftAlreadyRegistered")
        .withArgs(groupId, A.address);

      // unregister ok, then unregister again already covered in your old test, but keep it consistent
      await core.connect(A).unregisterFromNft(groupId);
      await expect(core.connect(A).unregisterFromNft(groupId))
        .to.be.revertedWithCustomError(core, "NftNotRegistered")
        .withArgs(groupId, A.address);
    });

    it("registerWithNft: cannot register before nft is set and cannot register without balance (keep existing coverage)", async () => {
      const { core, owner, A } = await deployCore();

      await core.connect(owner).createGroup("G", "D", 1);
      const groupId = await core.nextGroupId();

      await expect(core.connect(A).registerWithNft(groupId))
        .to.be.revertedWithCustomError(core, "NftNotSet")
        .withArgs(groupId);

      const MockERC721 = await ethers.getContractFactory("MockERC721");
      const nft = (await MockERC721.deploy("MockNFT", "MNFT")) as any;
      await core.connect(owner).setGroupNft(groupId, await nft.getAddress());

      await expect(core.connect(A).registerWithNft(groupId))
        .to.be.revertedWithCustomError(core, "NftBalanceRequired")
        .withArgs(groupId, A.address);
    });
  });

  describe("ClaimCode", function () {
    it("createClaimCode: covers ZeroCodeHash, MembershipTypeMismatch, duplicate ClaimCodeAlreadyExists", async () => {
      const { core, owner } = await deployCore();

      // Manual group -> mismatch
      await core.connect(owner).createGroup("G1", "D", 0);
      const manualGroupId = await core.nextGroupId();

      await expect(core.connect(owner).createClaimCode(manualGroupId, codeHash("x")))
        .to.be.revertedWithCustomError(core, "MembershipTypeMismatch")
        .withArgs(0, 2);

      // ClaimCode group
      await core.connect(owner).createGroup("G2", "D", 2);
      const groupId = await core.nextGroupId();

      await expect(core.connect(owner).createClaimCode(groupId, ethers.ZeroHash))
        .to.be.revertedWithCustomError(core, "ZeroCodeHash");

      const h = codeHash("code-dup");
      await core.connect(owner).createClaimCode(groupId, h);

      await expect(core.connect(owner).createClaimCode(groupId, h))
        .to.be.revertedWithCustomError(core, "ClaimCodeAlreadyExists")
        .withArgs(h);
    });

    it("claimWithCode: covers ZeroCodeHash, mismatch, owner cannot claim, not found, wrong group", async () => {
      const { core, owner, A } = await deployCore();

      // Manual group -> mismatch
      await core.connect(owner).createGroup("G1", "D", 0);
      const manualGroupId = await core.nextGroupId();

      await expect(core.connect(A).claimWithCode(manualGroupId, codeHash("x")))
        .to.be.revertedWithCustomError(core, "MembershipTypeMismatch")
        .withArgs(0, 2);

      // ClaimCode group
      await core.connect(owner).createGroup("G2", "D", 2);
      const groupId = await core.nextGroupId();

      await expect(core.connect(A).claimWithCode(groupId, ethers.ZeroHash))
        .to.be.revertedWithCustomError(core, "ZeroCodeHash");

      const hMissing = codeHash("missing");
      await expect(core.connect(A).claimWithCode(groupId, hMissing))
        .to.be.revertedWithCustomError(core, "ClaimCodeNotFound")
        .withArgs(hMissing);

      // create code in another ClaimCode group, then try to claim in this group -> wrong group
      await core.connect(owner).createGroup("G3", "D", 2);
      const otherGroupId = await core.nextGroupId();

      const hWrong = codeHash("wrong-group");
      await core.connect(owner).createClaimCode(otherGroupId, hWrong);

      await expect(core.connect(A).claimWithCode(groupId, hWrong))
        .to.be.revertedWithCustomError(core, "ClaimCodeWrongGroup")
        .withArgs(hWrong, otherGroupId, groupId);

      // owner cannot claim
      const hOwner = codeHash("owner-claim");
      await core.connect(owner).createClaimCode(groupId, hOwner);

      await expect(core.connect(owner).claimWithCode(groupId, hOwner))
        .to.be.revertedWithCustomError(core, "OwnerMembershipImmutable")
        .withArgs(groupId, owner.address);
    });

    it("claimWithCode: happy path, prevents reuse, and covers 'already member' branch (no count increment)", async () => {
      const { core, owner, A } = await deployCore();

      await core.connect(owner).createGroup("G", "D", 2);
      const groupId = await core.nextGroupId();

      // Happy path + reuse
      const h1 = codeHash("code-1");
      await core.connect(owner).createClaimCode(groupId, h1);

      expect(await core.getGroupMemberCount(groupId)).to.equal(0n);
      await core.connect(A).claimWithCode(groupId, h1);
      expect(await core.getGroupMemberCount(groupId)).to.equal(1n);

      await expect(core.connect(A).claimWithCode(groupId, h1))
        .to.be.revertedWithCustomError(core, "ClaimCodeAlreadyUsed")
        .withArgs(h1);

      // Already-member branch: make A member manually first, then claim a new code
      const h2 = codeHash("code-2");
      await core.connect(owner).createClaimCode(groupId, h2);

      // ensure A already member (ClaimCode mode allows manual set)
      await core.connect(owner).setManualMember(groupId, A.address, true);
      const before = await core.getGroupMemberCount(groupId);

      await core.connect(A).claimWithCode(groupId, h2);
      const after = await core.getGroupMemberCount(groupId);

      // no increment because was already member
      expect(after).to.equal(before);
    });
  });
});
