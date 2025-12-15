import { network } from "hardhat";

async function main() {
  const { ethers } = await network.connect();

  const VeritasCore = await ethers.getContractFactory("VeritasCore");
  const veritasCore = await VeritasCore.deploy();
  await veritasCore.waitForDeployment();

  const address = await veritasCore.getAddress();
  console.log("VeritasCore (L2):", address);

  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
