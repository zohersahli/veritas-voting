import { network } from "hardhat";
import { keccak256, AbiCoder } from "ethers";

async function main() {
  const { ethers } = await network.connect();
  const [deployer] = await ethers.getSigners();
  
  const netInfo = await ethers.provider.getNetwork();
  const networkName = process.env.HARDHAT_NETWORK || "hardhat";

  console.log("\n=== Checking CCIP Status ===\n");
  console.log("Deployer:", deployer.address);
  console.log("Network:", networkName);
  console.log("ChainId:", netInfo.chainId.toString());

  // GroupId and PollId from the last test
  const groupId = 3;
  const pollId = 2;

  const abiCoder = AbiCoder.defaultAbiCoder();
  const key = keccak256(abiCoder.encode(["uint256", "uint256"], [groupId, pollId]));

  console.log("\nGroupId:", groupId);
  console.log("PollId:", pollId);
  console.log("Key:", key);

  // L1 Contract
  const l1RegistryAddr = "0x2718a6057cE3d0a57a219Abe21612eD104457f7C";

  // Check L1 status (if on L1 network)
  const isL1 = networkName === "ethereumSepolia" || netInfo.chainId === 11155111n;
  const isL2 = networkName === "baseSepolia" || netInfo.chainId === 84532n;
  
  if (isL1) {
    console.log("\n--- L1 Status (Ethereum Sepolia) ---");
    const l1Registry = await ethers.getContractAt("VeritasCcipReceiverRegistry", l1RegistryAddr);
    
    try {
      const isRecorded = await (l1Registry as any).isRecorded(groupId, pollId);
      console.log("Result recorded on L1:", isRecorded);
      
      if (isRecorded) {
        const record = await (l1Registry as any).getRecord(groupId, pollId);
        console.log("Record details:", {
          recorded: record.recorded,
          groupId: record.groupId.toString(),
          pollId: record.pollId.toString(),
          status: record.status,
          ackMessageId: record.ackMessageId
        });
      }
    } catch (e: any) {
      console.log("Error checking L1:", e.message);
    }
  } else if (isL2) {
    console.log("\n--- L2 Status (Base Sepolia) ---");
    const veritasAddr = "0x411947c4C08E0583A84E58d48f108c136978c11D";
    const veritas = await ethers.getContractAt("VeritasCore", veritasAddr);
    
    try {
      const ackReceived = await veritas.ackReceived(key);
      console.log("ACK received on L2:", ackReceived);
    } catch (e: any) {
      console.log("Error checking L2:", e.message);
    }
  } else {
    console.log("\n--- Unknown network. Use --network ethereumSepolia or --network baseSepolia ---");
  }

  console.log("\n=== Done ===\n");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

