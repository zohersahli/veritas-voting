import { network } from "hardhat";
import { parseEther } from "ethers";

async function getEthers() {
  const { ethers } = await network.connect();
  return ethers;
}

/**
 * Deploy VeritasCore with mocks (Link, Router)
 * Returns: { core, link, router, owner, A, B, C, D }
 */
export async function deployCore() {
  const ethers = await getEthers();
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

  return { core, link, router, owner, A, B, C, D };
}

/**
 * Deploy L1 Receiver Registry
 * Returns: { l1Receiver, router, link }
 */
export async function deployL1Receiver(coreAddress?: string, routerAddress?: string, linkAddress?: string) {
  const ethers = await getEthers();
  const [owner] = await ethers.getSigners();

  let router: any;
  let link: any;

  if (routerAddress && linkAddress) {
    router = await ethers.getContractAt("MockCcipRouter", routerAddress);
    link = await ethers.getContractAt("MockLink", linkAddress);
  } else {
    const MockLink = await ethers.getContractFactory("MockLink");
    link = await MockLink.deploy();

    const MockCcipRouter = await ethers.getContractFactory("MockCcipRouter");
    router = await MockCcipRouter.deploy(1n, parseEther("0.001"));
  }

  const VeritasCcipReceiverRegistry = await ethers.getContractFactory("VeritasCcipReceiverRegistry");
  const l1Receiver = (await VeritasCcipReceiverRegistry.deploy(
    await router.getAddress(),
    1n, // allowedSourceChainSelector
    coreAddress || owner.address // allowedSender
  )) as any;

  return { l1Receiver, router, link };
}

/**
 * Deploy full setup (L1 + L2) with cross-chain configuration
 * Returns: { core, link, router, l1, owner, A, B, C, D }
 */
export async function deployFullSetup() {
  const ethers = await getEthers();
  const [owner, A, B, C, D] = await ethers.getSigners();

  // Deploy mocks
  const MockLink = await ethers.getContractFactory("MockLink");
  const link = await MockLink.deploy();

  const MockCcipRouter = await ethers.getContractFactory("MockCcipRouter");
  const router = await MockCcipRouter.deploy(1n, parseEther("0.001"));

  // Deploy L2 Core
  const VeritasCore = await ethers.getContractFactory("VeritasCore");
  const core = (await VeritasCore.deploy(
    await router.getAddress(),
    await link.getAddress(),
    1n, // destSelector
    owner.address, // placeholder l1Receiver
    B.address, // treasury
    300000n // receiverGasLimit
  )) as any;

  // Deploy L1 Receiver Registry
  const VeritasCcipReceiverRegistry = await ethers.getContractFactory("VeritasCcipReceiverRegistry");
  const l1 = (await VeritasCcipReceiverRegistry.deploy(
    await router.getAddress(),
    1n, // allowedSourceChainSelector
    await core.getAddress() // allowedSender
  )) as any;

  // Wire L2 -> L1 receiver
  await core.connect(owner).setL1Receiver(await l1.getAddress());

  // Configure ACK (L1 -> L2)
  await core.connect(owner).setAckConfig(1n, await l1.getAddress());

  // Configure ACK (L2 -> L1)
  await l1.connect(owner).setAckConfig(
    1n, // ackDestinationChainSelector
    await core.getAddress(), // ackL2Receiver
    await link.getAddress(), // feeToken
    300000n // gasLimit
  );

  // Fund L1 registry with LINK for ACK fees
  await link.mint(await l1.getAddress(), parseEther("10"));

  return { core, link, router, l1, owner, A, B, C, D };
}

/**
 * Deploy GroupsHarness for testing Groups module
 * Returns: { owner, other, harness }
 */
export async function deployHarness() {
  const ethers = await getEthers();
  const [owner, other] = await ethers.getSigners();
  const Harness = await ethers.getContractFactory("GroupsHarness");
  const harness = await Harness.deploy();
  return { owner, other, harness };
}

