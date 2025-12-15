import { network } from "hardhat";

async function main() {
  // This uses the --network value, or the default network if not provided
  const { ethers } = await network.connect();

  // Deploy PlatformConfig first (Escrow depends on it)
  const PlatformConfig = await ethers.getContractFactory("PlatformConfig");
  const [deployer] = await ethers.getSigners();
  const treasury = deployer.address; // placeholder for local testing
  const executorCompensation = 0n;   // placeholder for local testing
  
  const platformConfig = await PlatformConfig.deploy(treasury, executorCompensation);
  await platformConfig.waitForDeployment();

  const platformConfigAddress = await platformConfig.getAddress();
  console.log("PlatformConfig:", platformConfigAddress);

  // Deploy L1ResultRegistry
  const L1ResultRegistry = await ethers.getContractFactory("L1ResultRegistry");
  const l1ResultRegistry = await L1ResultRegistry.deploy();
  await l1ResultRegistry.waitForDeployment();

  const registryAddress = await l1ResultRegistry.getAddress();
  console.log("L1ResultRegistry:", registryAddress);

  // Deploy L1FinalizationEscrow (needs PlatformConfig)
  const L1FinalizationEscrow = await ethers.getContractFactory("L1FinalizationEscrow");
  const escrow = await L1FinalizationEscrow.deploy(platformConfigAddress);
  await escrow.waitForDeployment();

  const escrowAddress = await escrow.getAddress();
  console.log("L1FinalizationEscrow:", escrowAddress);

  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
