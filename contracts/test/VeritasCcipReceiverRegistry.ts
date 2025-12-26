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

  // Helpers
  function bytes32FromText(t: string) {
    return ethers.keccak256(ethers.toUtf8Bytes(t));
  }

  function normSlotHex(x: string) {
    const h = x.startsWith("0x") ? x.slice(2) : x;
    return h.toLowerCase().padStart(64, "0");
  }

  function zeroWordHex() {
    return "0x" + "0".repeat(64);
  }

  // Zero a window inside a 32-byte hex word (hex64 without 0x), using MSB byte index
  function zeroWindow(hex64: string, startByteFromMSB: number, lenBytes: number) {
    const start = startByteFromMSB * 2;
    const len = lenBytes * 2;
    return hex64.slice(0, start) + "0".repeat(len) + hex64.slice(start + len);
  }

  async function getSlot(addr: string, slot: number) {
    return await ethers.provider.getStorage(addr, slot);
  }

  async function setSlot(addr: string, slot: number, value32: string) {
    await ethers.provider.send("hardhat_setStorageAt", [addr, ethers.toBeHex(slot), value32]);
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

  async function deploy() {
    const [owner, other, A] = await ethers.getSigners();

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

    return { owner, other, A, link, router, registry, allowedSourceSelector, allowedSender };
  }

  async function readAckGetters(registry: any) {
    const dest = BigInt(await registry.ackDestinationChainSelector());
    const recv = (await registry.ackL2Receiver()) as string;
    const feeToken = (await registry.ackFeeToken()) as string;
    const gas = BigInt(await registry.ackGasLimit());
    return { dest, recv, feeToken, gas };
  }

  // Discover which storage slots are used by setAckConfig, then classify them by their EFFECT
  // on ack getters. This works for packed and unpacked layouts.
  async function findAckSlotsByDiffAndEffect(params: {
    registryAddr: string;
    registry: any;
    owner: any;
    destSelector: bigint;
    l2Receiver: string;
    feeToken: string;
    gasLimit: bigint;
    scanSlots?: number;
  }) {
    const N = params.scanSlots ?? 1200;

    const before: string[] = [];
    for (let i = 0; i < N; i++) before.push(normSlotHex(await getSlot(params.registryAddr, i)));

    await params.registry
      .connect(params.owner)
      .setAckConfig(params.destSelector, params.l2Receiver, params.feeToken, params.gasLimit);

    const after: string[] = [];
    for (let i = 0; i < N; i++) after.push(normSlotHex(await getSlot(params.registryAddr, i)));

    const changed: number[] = [];
    for (let i = 0; i < N; i++) if (before[i] !== after[i]) changed.push(i);

    if (changed.length < 3) {
      throw new Error(`Unexpected changed slots count after setAckConfig: ${changed.join(",")}`);
    }

    const baseline = await readAckGetters(params.registry);

    const effect = async (idx: number) => {
      const original = "0x" + after[idx];

      await setSlot(params.registryAddr, idx, zeroWordHex());
      const cur = await readAckGetters(params.registry);
      await setSlot(params.registryAddr, idx, original);

      return {
        dest: cur.dest !== baseline.dest,
        recv: cur.recv.toLowerCase() !== baseline.recv.toLowerCase(),
        feeToken: cur.feeToken.toLowerCase() !== baseline.feeToken.toLowerCase(),
        gas: cur.gas !== baseline.gas,
      };
    };

    const destCandidates: number[] = [];
    const recvCandidates: number[] = [];
    const feeCandidates: number[] = [];
    const gasCandidates: number[] = [];

    for (const idx of changed) {
      const e = await effect(idx);
      if (e.dest) destCandidates.push(idx);
      if (e.recv) recvCandidates.push(idx);
      if (e.feeToken) feeCandidates.push(idx);
      if (e.gas) gasCandidates.push(idx);
    }

    // feeToken and gasLimit should be unique in almost all layouts
    if (feeCandidates.length !== 1) {
      throw new Error(`feeToken slot not unique. candidates=${feeCandidates.join(",")} changed=${changed.join(",")}`);
    }
    if (gasCandidates.length !== 1) {
      throw new Error(`gasLimit slot not unique. candidates=${gasCandidates.join(",")} changed=${changed.join(",")}`);
    }

    // dest and recv may be:
    // - unpacked: unique slots each
    // - packed together: same single slot affects both
    if (destCandidates.length !== 1) {
      throw new Error(`destSelector slot not unique. candidates=${destCandidates.join(",")} changed=${changed.join(",")}`);
    }
    if (recvCandidates.length !== 1) {
      throw new Error(`l2Receiver slot not unique. candidates=${recvCandidates.join(",")} changed=${changed.join(",")}`);
    }

    const destSlot = destCandidates[0];
    const recvSlot = recvCandidates[0];

    return {
      destSlot,
      recvSlot,
      feeTokenSlot: feeCandidates[0],
      gasLimitSlot: gasCandidates[0],
    };
  }

  // If dest and recv are packed in the SAME slot, zeroing the whole slot breaks both.
  // We find a 8-byte window that makes dest=0 while preserving recv.
  async function findPackedDestZeroVariant(params: {
    registryAddr: string;
    registry: any;
    slot: number;
    originalHex64: string;
    baselineRecv: string;
  }) {
    for (let startByte = 0; startByte <= 24; startByte++) {
      const mod = zeroWindow(params.originalHex64, startByte, 8);

      await setSlot(params.registryAddr, params.slot, "0x" + mod);
      const cur = await readAckGetters(params.registry);
      await setSlot(params.registryAddr, params.slot, "0x" + params.originalHex64);

      if (cur.dest === 0n && cur.recv.toLowerCase() === params.baselineRecv.toLowerCase()) {
        return mod;
      }
    }
    throw new Error("Could not find packed destSelector window (8 bytes) in slot");
  }

  // Find a 20-byte window that makes recv=0 while preserving dest (packed case).
  async function findPackedRecvZeroVariant(params: {
    registryAddr: string;
    registry: any;
    slot: number;
    originalHex64: string;
    baselineDest: bigint;
  }) {
    for (let startByte = 0; startByte <= 12; startByte++) {
      const mod = zeroWindow(params.originalHex64, startByte, 20);

      await setSlot(params.registryAddr, params.slot, "0x" + mod);
      const cur = await readAckGetters(params.registry);
      await setSlot(params.registryAddr, params.slot, "0x" + params.originalHex64);

      if (cur.dest === params.baselineDest && cur.recv.toLowerCase() === ethers.ZeroAddress.toLowerCase()) {
        return mod;
      }
    }
    throw new Error("Could not find packed l2Receiver window (20 bytes) in slot");
  }

  // From VeritasCcipReceiverRegistry.ts
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

  // From VeritasCcipReceiverRegistry.extra.ts
  it("constructor: covers BadConfig branches", async () => {
    const [owner] = await ethers.getSigners();
    const Registry = await ethers.getContractFactory("VeritasCcipReceiverRegistry");

    const MockCcipRouter = await ethers.getContractFactory("MockCcipRouter");
    const router = await MockCcipRouter.deploy(1111n, parseEther("0"));

    await expect(Registry.deploy(await router.getAddress(), 0n, owner.address))
      .to.be.revertedWithCustomError(Registry, "BadConfig");

    await expect(Registry.deploy(await router.getAddress(), 1111n, ethers.ZeroAddress))
      .to.be.revertedWithCustomError(Registry, "BadConfig");

    // router=0 may revert in CCIPReceiver or in our BadConfig, we only require revert
    await expect(Registry.deploy(ethers.ZeroAddress, 1111n, owner.address)).to.revert(ethers);
  });

  it("admin setters: onlyOwner + BadConfig branches + events", async () => {
    const { owner, other, link, registry } = await deploy();

    await expect(registry.connect(other).setAllowedSourceChainSelector(2222n)).to.revert(ethers);
    await expect(registry.connect(other).setAllowedSender(other.address)).to.revert(ethers);
    await expect(registry.connect(other).setAckConfig(2222n, other.address, other.address, 1n)).to.revert(ethers);

    await expect(registry.connect(owner).setAllowedSourceChainSelector(0n))
      .to.be.revertedWithCustomError(registry, "BadConfig");

    await expect(registry.connect(owner).setAllowedSourceChainSelector(2222n))
      .to.emit(registry, "AllowedSourceChainSelectorUpdated");

    await expect(registry.connect(owner).setAllowedSender(ethers.ZeroAddress))
      .to.be.revertedWithCustomError(registry, "BadConfig");

    await expect(registry.connect(owner).setAllowedSender(other.address))
      .to.emit(registry, "AllowedSenderUpdated");

    await expect(registry.connect(owner).setAckConfig(0n, owner.address, await link.getAddress(), 1n))
      .to.be.revertedWithCustomError(registry, "BadConfig");
    await expect(registry.connect(owner).setAckConfig(2222n, ethers.ZeroAddress, await link.getAddress(), 1n))
      .to.be.revertedWithCustomError(registry, "BadConfig");
    await expect(registry.connect(owner).setAckConfig(2222n, owner.address, ethers.ZeroAddress, 1n))
      .to.be.revertedWithCustomError(registry, "BadConfig");
    await expect(registry.connect(owner).setAckConfig(2222n, owner.address, await link.getAddress(), 0n))
      .to.be.revertedWithCustomError(registry, "BadConfig");

    await expect(registry.connect(owner).setAckConfig(2222n, owner.address, await link.getAddress(), 333333n))
      .to.emit(registry, "AckConfigUpdated");
  });

  it("ccipReceive: covers InvalidPollId + InvalidStatus", async () => {
    const { router, registry, allowedSourceSelector, allowedSender } = await deploy();

    const routerAddr = await router.getAddress();
    const routerSigner = await impersonateAs(routerAddr);

    const msgBadPoll = buildInboundMessage({
      sourceSelector: allowedSourceSelector,
      senderAddress: allowedSender,
      groupId: 1n,
      pollId: 0n,
      statusRaw: 1,
      resultHash: bytes32FromText("r1"),
      inboundMessageId: bytes32FromText("m1"),
    });

    await expect(registry.connect(routerSigner).ccipReceive(msgBadPoll as any))
      .to.be.revertedWithCustomError(registry, "InvalidPollId");

    const msgBadStatus = buildInboundMessage({
      sourceSelector: allowedSourceSelector,
      senderAddress: allowedSender,
      groupId: 1n,
      pollId: 10n,
      statusRaw: 3,
      resultHash: bytes32FromText("r2"),
      inboundMessageId: bytes32FromText("m2"),
    });

    await expect(registry.connect(routerSigner).ccipReceive(msgBadStatus as any))
      .to.be.revertedWithCustomError(registry, "InvalidStatus")
      .withArgs(3);

    await stopImpersonate(routerAddr);
  });

  it("AckConfigNotSet: covers each OR branch using real slots (packed or not) without allowlist flakiness", async () => {
    const { owner, A, link, router, registry, allowedSourceSelector, allowedSender } = await deploy();

    const destSelector = 2222n;
    const l2Receiver = A.address;
    const feeToken = await link.getAddress();
    const gasLimit = 500000n;

    const registryAddr = await registry.getAddress();

    // Discover slots by diff + effect (works for packed and unpacked)
    const { destSlot, recvSlot, feeTokenSlot, gasLimitSlot } = await findAckSlotsByDiffAndEffect({
      registryAddr,
      registry,
      owner,
      destSelector,
      l2Receiver,
      feeToken,
      gasLimit,
      scanSlots: 1200,
    });

    // Fund LINK so fee payment is not the reason of revert (even though we expect AckConfigNotSet earlier)
    await link.mint(registryAddr, parseEther("1"));

    const routerAddr = await router.getAddress();
    const routerSigner = await impersonateAs(routerAddr);

    // Build messages using CURRENT allowlist (it might be clobbered if any slot overlap ever happens)
    const buildMsgUsingCurrentAllowlist = async (label: string, pollId: bigint) => {
      const curSource = BigInt(await registry.allowedSourceChainSelector());
      const curSender = (await registry.allowedSender()) as string;

      return buildInboundMessage({
        sourceSelector: curSource,
        senderAddress: curSender,
        groupId: 1n,
        pollId,
        statusRaw: 1,
        resultHash: ethers.keccak256(ethers.toUtf8Bytes(label)),
        inboundMessageId: ethers.hexlify(ethers.randomBytes(32)),
      });
    };

    const restoreAll = async () => {
      // Restore ACK config
      await registry.connect(owner).setAckConfig(destSelector, l2Receiver, feeToken, gasLimit);
      // Restore allowlist (stability)
      await registry.connect(owner).setAllowedSourceChainSelector(allowedSourceSelector);
      await registry.connect(owner).setAllowedSender(allowedSender);
    };

    const baseline = await readAckGetters(registry);
    expect(baseline.dest).to.equal(destSelector);
    expect(baseline.recv.toLowerCase()).to.equal(l2Receiver.toLowerCase());
    expect(BigInt(await registry.ackGasLimit())).to.equal(gasLimit);

    // Case 1: ackDestinationChainSelector == 0
    if (destSlot !== recvSlot) {
      await setSlot(registryAddr, destSlot, zeroWordHex());
    } else {
      const original = normSlotHex(await getSlot(registryAddr, destSlot));
      const mod = await findPackedDestZeroVariant({
        registryAddr,
        registry,
        slot: destSlot,
        originalHex64: original,
        baselineRecv: baseline.recv,
      });
      await setSlot(registryAddr, destSlot, "0x" + mod);
    }

    await expect(registry.connect(routerSigner).ccipReceive((await buildMsgUsingCurrentAllowlist("ack-1", 101n)) as any))
      .to.be.revertedWithCustomError(registry, "AckConfigNotSet");
    await restoreAll();

    // Case 2: ackL2Receiver == 0
    if (recvSlot !== destSlot) {
      await setSlot(registryAddr, recvSlot, zeroWordHex());
    } else {
      const original = normSlotHex(await getSlot(registryAddr, recvSlot));
      const mod = await findPackedRecvZeroVariant({
        registryAddr,
        registry,
        slot: recvSlot,
        originalHex64: original,
        baselineDest: baseline.dest,
      });
      await setSlot(registryAddr, recvSlot, "0x" + mod);
    }

    await expect(registry.connect(routerSigner).ccipReceive((await buildMsgUsingCurrentAllowlist("ack-2", 102n)) as any))
      .to.be.revertedWithCustomError(registry, "AckConfigNotSet");
    await restoreAll();

    // Case 3: ackFeeToken == 0
    await setSlot(registryAddr, feeTokenSlot, zeroWordHex());
    await expect(registry.connect(routerSigner).ccipReceive((await buildMsgUsingCurrentAllowlist("ack-3", 103n)) as any))
      .to.be.revertedWithCustomError(registry, "AckConfigNotSet");
    await restoreAll();

    // Case 4: ackGasLimit == 0
    await setSlot(registryAddr, gasLimitSlot, zeroWordHex());
    await expect(registry.connect(routerSigner).ccipReceive((await buildMsgUsingCurrentAllowlist("ack-4", 104n)) as any))
      .to.be.revertedWithCustomError(registry, "AckConfigNotSet");
    await restoreAll();

    await stopImpersonate(routerAddr);
  });

  // From VeritasCcipReceiverRegistry.views.extra.ts
  it("covers getRecord + isRecorded views for missing record", async () => {
    const [owner] = await ethers.getSigners();

    const MockCcipRouter = await ethers.getContractFactory("MockCcipRouter");
    const router = await MockCcipRouter.deploy(1111n, parseEther("0"));

    const VeritasCcipReceiverRegistry = await ethers.getContractFactory("VeritasCcipReceiverRegistry");
    const registry = await VeritasCcipReceiverRegistry.deploy(
      await router.getAddress(),
      1111n,
      owner.address
    );

    const groupId = 1n;
    const pollId = 1n;

    // View: isRecorded should be false when no record exists
    expect(await registry.isRecorded(groupId, pollId)).to.equal(false);

    // View: getRecord returns a struct, and recorded should be false by default
    const rec = await registry.getRecord(groupId, pollId);
    expect(rec.recorded).to.equal(false);
  });
});

