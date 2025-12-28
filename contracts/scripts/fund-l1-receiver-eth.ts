import { network } from "hardhat";

async function main() {
  const { ethers } = await network.connect();
  const [deployer] = await ethers.getSigners();

  console.log("\n=== Funding L1 Receiver with ETH ===\n");
  console.log("Network:", network.name);
  console.log("Deployer:", deployer.address);

  const l1ReceiverAddr = "0x2718a6057cE3d0a57a219Abe21612eD104457f7C";

  // Check current balance
  const balanceBefore = await ethers.provider.getBalance(l1ReceiverAddr);
  console.log("L1 Receiver ETH balance before:", ethers.formatEther(balanceBefore), "ETH");

  // Amount to send (0.01 ETH)
  const amount = ethers.parseEther("0.01");
  
  // Check deployer balance
  const deployerBalance = await ethers.provider.getBalance(deployer.address);
  console.log("Deployer ETH balance:", ethers.formatEther(deployerBalance), "ETH");

  if (deployerBalance < amount) {
    throw new Error(`Insufficient balance. Need ${ethers.formatEther(amount)} ETH, have ${ethers.formatEther(deployerBalance)} ETH`);
  }

  // Send ETH
  console.log(`\nSending ${ethers.formatEther(amount)} ETH to L1 Receiver...`);
  const tx = await deployer.sendTransaction({
    to: l1ReceiverAddr,
    value: amount,
    gasLimit: 21000, // Standard ETH transfer gas limit
  });

  console.log("Transaction hash:", tx.hash);
  await tx.wait();
  console.log("Transaction confirmed!");

  // Check balance after
  const balanceAfter = await ethers.provider.getBalance(l1ReceiverAddr);
  console.log("L1 Receiver ETH balance after:", ethers.formatEther(balanceAfter), "ETH");
  console.log("\n=== Done ===\n");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

