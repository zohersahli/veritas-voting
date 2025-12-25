import { expect } from "chai";
import { network } from "hardhat";
import { parseEther } from "ethers";

const { ethers } = await network.connect();

describe("VeritasCcipReceiverRegistry (Hardhat)", function () {
  let snapshotId: string;

  beforeEach(async () => {
    snapshotId = await ethers.provider.send("evm_snapshot", []);
  });

  afterEach(async () => {
    await ethers.provider.send("evm_revert", [snapshotId]);
  });

  async function deploy() {
    const [owner, other] = await ethers.getSigners();

    const MockLink = await ethers.getContractFactory("MockLink");
    const link = await MockLink.deploy();

    const MockCcipRouter = await ethers.getContractFactory("MockCcipRouter");
    const router = await MockCcipRouter.deploy(1n, parseEther("0.001"));

    // allowed inbound (L2 -> L1)
    const allowedSourceSelector = 1111n;
    const allowedSender = owner.address;

    const Registry = await ethers.getContractFactory("VeritasCcipReceiverRegistry");
    const registry = await Registry.deploy(
      await router.getAddress(),
      allowedSourceSelector,
      allowedSender
    );

    return { owner, other, link, router, registry, allowedSourceSelector, allowedSender };
  }

  function buildInboundMessage(params: {
    sourceSelector: bigint;
    senderAddress: string;
    groupId: bigint;
    pollId: bigint;
    statusRaw: number;
    resultHash: string;
    inboundMessageId: string;
  }) {
    const senderBytes = ethers.AbiCoder.defaultAbiCoder().encode(["address"], [params.senderAddress]);

    const data = ethers.AbiCoder.defaultAbiCoder().encode(
      ["uint256", "uint256", "uint8", "bytes32"],
      [params.groupId, params.pollId, params.statusRaw, params.resultHash]
    );

    return {
      messageId: params.inboundMessageId,
      sourceChainSelector: params.sourceSelector,
      sender: senderBytes,
      data,
      destTokenAmounts: [] as any[],
    };
  }

  async function impersonateAs(address: string) {
    await ethers.provider.send("hardhat_impersonateAccount", [address]);

    const [funder] = await ethers.getSigners();
    await funder.sendTransaction({ to: address, value: parseEther("1") });

    return await ethers.getSigner(address);
  }

  async function stopImpersonate(address: string) {
    await ethers.provider.send("hardhat_stopImpersonatingAccount", [address]);
  }

  it("records result and sends ack when config is set", async () => {
    const { owner, link, router, registry, allowedSourceSelector, allowedSender } = await deploy();

    await registry.connect(owner).setAckConfig(
      2222n,
      owner.address,
      await link.getAddress(),
      300000n
    );

    // Mint LINK directly to the registry so it can pay ack fee
    await link.mint(await registry.getAddress(), parseEther("1"));

    const inboundMessageId = ethers.hexlify(ethers.randomBytes(32));
    const groupId = 1n;
    const pollId = 1n;
    const statusRaw = 1;
    const resultHash = ethers.keccak256(ethers.toUtf8Bytes("result"));

    const msg = buildInboundMessage({
      sourceSelector: allowedSourceSelector,
      senderAddress: allowedSender,
      groupId,
      pollId,
      statusRaw,
      resultHash,
      inboundMessageId,
    });

    const routerAddr = await router.getAddress();
    const routerSigner = await impersonateAs(routerAddr);

    await registry.connect(routerSigner).ccipReceive(msg as any);

    await stopImpersonate(routerAddr);

    const rec = await registry.getRecord(groupId, pollId);
    expect(rec.recorded).to.equal(true);
    expect(rec.groupId).to.equal(groupId);
    expect(rec.pollId).to.equal(pollId);
    expect(rec.resultHash).to.equal(resultHash);
    expect(rec.ackMessageId).to.not.equal(ethers.ZeroHash);
  });

  it("reverts on unauthorized source chain", async () => {
    const { owner, link, router, registry, allowedSender } = await deploy();

    await registry.connect(owner).setAckConfig(2222n, owner.address, await link.getAddress(), 300000n);
    await link.mint(await registry.getAddress(), parseEther("1"));

    const inboundMessageId = ethers.hexlify(ethers.randomBytes(32));
    const msg = buildInboundMessage({
      sourceSelector: 9999n,
      senderAddress: allowedSender,
      groupId: 1n,
      pollId: 1n,
      statusRaw: 1,
      resultHash: ethers.keccak256(ethers.toUtf8Bytes("x")),
      inboundMessageId,
    });

    const routerAddr = await router.getAddress();
    const routerSigner = await impersonateAs(routerAddr);

    await expect(registry.connect(routerSigner).ccipReceive(msg as any)).to.revert(ethers);

    await stopImpersonate(routerAddr);
  });

  it("reverts on unauthorized sender", async () => {
    const { owner, link, router, registry, allowedSourceSelector } = await deploy();

    await registry.connect(owner).setAckConfig(2222n, owner.address, await link.getAddress(), 300000n);
    await link.mint(await registry.getAddress(), parseEther("1"));

    const inboundMessageId = ethers.hexlify(ethers.randomBytes(32));
    const msg = buildInboundMessage({
      sourceSelector: allowedSourceSelector,
      senderAddress: ethers.Wallet.createRandom().address,
      groupId: 1n,
      pollId: 1n,
      statusRaw: 1,
      resultHash: ethers.keccak256(ethers.toUtf8Bytes("x")),
      inboundMessageId,
    });

    const routerAddr = await router.getAddress();
    const routerSigner = await impersonateAs(routerAddr);

    await expect(registry.connect(routerSigner).ccipReceive(msg as any)).to.revert(ethers);

    await stopImpersonate(routerAddr);
  });

  it("reverts if ack config not set (AckConfigNotSet)", async () => {
    const { router, registry, allowedSourceSelector, allowedSender } = await deploy();

    const inboundMessageId = ethers.hexlify(ethers.randomBytes(32));
    const msg = buildInboundMessage({
      sourceSelector: allowedSourceSelector,
      senderAddress: allowedSender,
      groupId: 1n,
      pollId: 1n,
      statusRaw: 1,
      resultHash: ethers.keccak256(ethers.toUtf8Bytes("x")),
      inboundMessageId,
    });

    const routerAddr = await router.getAddress();
    const routerSigner = await impersonateAs(routerAddr);

    await expect(registry.connect(routerSigner).ccipReceive(msg as any)).to.revert(ethers);

    await stopImpersonate(routerAddr);
  });

  it("reverts if already recorded", async () => {
    const { owner, link, router, registry, allowedSourceSelector, allowedSender } = await deploy();

    await registry.connect(owner).setAckConfig(2222n, owner.address, await link.getAddress(), 300000n);
    await link.mint(await registry.getAddress(), parseEther("1"));

    const inboundMessageId = ethers.hexlify(ethers.randomBytes(32));
    const msg = buildInboundMessage({
      sourceSelector: allowedSourceSelector,
      senderAddress: allowedSender,
      groupId: 1n,
      pollId: 1n,
      statusRaw: 1,
      resultHash: ethers.keccak256(ethers.toUtf8Bytes("x")),
      inboundMessageId,
    });

    const routerAddr = await router.getAddress();
    const routerSigner = await impersonateAs(routerAddr);

    await registry.connect(routerSigner).ccipReceive(msg as any);
    await expect(registry.connect(routerSigner).ccipReceive(msg as any)).to.revert(ethers);

    await stopImpersonate(routerAddr);
  });
});
