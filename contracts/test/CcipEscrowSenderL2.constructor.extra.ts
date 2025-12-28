import { expect } from "chai";
import { network } from "hardhat";
import { parseEther } from "ethers";

const { ethers } = await network.connect();

describe("CcipEscrowSenderL2 constructor extra coverage (Hardhat)", function () {
  let snapshotId: string;

  beforeEach(async () => {
    snapshotId = await ethers.provider.send("evm_snapshot", []);
  });

  afterEach(async () => {
    await ethers.provider.send("evm_revert", [snapshotId]);
  });

  it("reverts with BadConfig on invalid constructor params (covers BadConfig branches)", async () => {
    const [owner] = await ethers.getSigners();

    const MockLink = await ethers.getContractFactory("MockLink");
    const link = await MockLink.deploy();

    const MockCcipRouter = await ethers.getContractFactory("MockCcipRouter");
    const router = await MockCcipRouter.deploy(1111n, parseEther("0"));

    const VeritasCore = await ethers.getContractFactory("VeritasCore");

    const goodRouter = await router.getAddress();
    const goodLink = await link.getAddress();
    const goodDestSelector = 2222n;
    const goodL1Receiver = owner.address;
    const goodTreasury = owner.address;
    const goodGasLimit = 300000n;

    // router == 0
    await expect(
      VeritasCore.deploy(
        ethers.ZeroAddress,
        goodLink,
        goodDestSelector,
        goodL1Receiver,
        goodTreasury,
        goodGasLimit
      )
    ).to.be.revertedWithCustomError(VeritasCore, "BadConfig");

    // link == 0
    await expect(
      VeritasCore.deploy(
        goodRouter,
        ethers.ZeroAddress,
        goodDestSelector,
        goodL1Receiver,
        goodTreasury,
        goodGasLimit
      )
    ).to.be.revertedWithCustomError(VeritasCore, "BadConfig");

    // l1Receiver == 0
    await expect(
      VeritasCore.deploy(
        goodRouter,
        goodLink,
        goodDestSelector,
        ethers.ZeroAddress,
        goodTreasury,
        goodGasLimit
      )
    ).to.be.revertedWithCustomError(VeritasCore, "BadConfig");

    // treasury == 0
    await expect(
      VeritasCore.deploy(
        goodRouter,
        goodLink,
        goodDestSelector,
        goodL1Receiver,
        ethers.ZeroAddress,
        goodGasLimit
      )
    ).to.be.revertedWithCustomError(VeritasCore, "BadConfig");

    // destSelector == 0
    await expect(
      VeritasCore.deploy(
        goodRouter,
        goodLink,
        0n,
        goodL1Receiver,
        goodTreasury,
        goodGasLimit
      )
    ).to.be.revertedWithCustomError(VeritasCore, "BadConfig");

    // receiverGasLimit == 0
    await expect(
      VeritasCore.deploy(
        goodRouter,
        goodLink,
        goodDestSelector,
        goodL1Receiver,
        goodTreasury,
        0n
      )
    ).to.be.revertedWithCustomError(VeritasCore, "BadConfig");
  });
});
