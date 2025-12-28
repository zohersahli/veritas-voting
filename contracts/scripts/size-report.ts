import { network, artifacts } from "hardhat";

const { ethers } = await network.connect();

// EVM size limits
const RUNTIME_LIMIT = 24576; // bytes
const INITCODE_LIMIT = 49152; // bytes

// List of all important contracts in the project
const CONTRACTS = [
  // L2 Core Contracts
  "VeritasCore",
  "VeritasCcipReceiverRegistry",
  
  // L2 Modules (abstract, measured via VeritasCore inheritance)
  "Groups",
  "Membership",
  "Polls",
  "Voting",
  "Delegation",
  "FinalizationL2",
  "CcipEscrowSenderL2",
  
  // Mocks
  "MockCcipRouter",
  "MockLink",
  
  // Libraries
  "QuorumMath",
];

// Constructor arguments for contracts that need them
function getConstructorArgs(contractName: string): any[] {
  const zeroAddress = "0x0000000000000000000000000000000000000000";
  
  switch (contractName) {
    case "VeritasCore":
      // router, link, destSelector, l1Receiver, treasury, receiverGasLimit
      return [zeroAddress, zeroAddress, 0, zeroAddress, zeroAddress, 300000];
    
    case "VeritasCcipReceiverRegistry":
      // router, allowedSourceChainSelector, allowedSender
      return [zeroAddress, 999, zeroAddress];
    
    case "MockCcipRouter":
      // sourceChainSelector, flatFee
      return [999, ethers.parseUnits("1", 18)];
    
    case "MockLink":
      // no args
      return [];
    
    default:
      // Abstract contracts don't need constructor args
      return [];
  }
}

function byteLen(hex: string): number {
  if (!hex || hex === "0x") return 0;
  return (hex.length - 2) / 2;
}

function formatBytes(bytes: number): string {
  return bytes.toLocaleString();
}

function checkLimits(runtime: number, initcode: number): { runtimeOk: boolean; initcodeOk: boolean } {
  return {
    runtimeOk: runtime <= RUNTIME_LIMIT,
    initcodeOk: initcode <= INITCODE_LIMIT,
  };
}

interface ContractSize {
  name: string;
  runtimeBytes: number;
  initcodeBytes: number;
  runtimeOk: boolean;
  initcodeOk: boolean;
  error?: string;
}

async function main() {
  console.log("=".repeat(80));
  console.log("Contract Size Report");
  console.log("=".repeat(80));
  console.log(`Runtime Limit: ${formatBytes(RUNTIME_LIMIT)} bytes`);
  console.log(`Initcode Limit: ${formatBytes(INITCODE_LIMIT)} bytes`);
  console.log("=".repeat(80));
  console.log();

  const results: ContractSize[] = [];

  for (const name of CONTRACTS) {
    try {
      // Read artifact directly from hardhat
      const artifactPath = `contracts/${name}.sol:${name}`;
      let artifact;
      
      try {
        artifact = await artifacts.readArtifact(name);
      } catch {
        // Try reading from full path
        const paths = [
          `contracts/l2/${name}.sol:${name}`,
          `contracts/l1/${name}.sol:${name}`,
          `contracts/mocks/${name}.sol:${name}`,
          `contracts/libraries/${name}.sol:${name}`,
        ];
        
        let found = false;
        for (const path of paths) {
          try {
            artifact = await artifacts.readArtifact(path);
            found = true;
            break;
          } catch {
            continue;
          }
        }
        
        if (!found || !artifact) {
          throw new Error(`Artifact not found for ${name}`);
        }
      }

      // Ensure artifact exists
      if (!artifact) {
        throw new Error(`Artifact is undefined for ${name}`);
      }

      const runtime = artifact.deployedBytecode ?? "0x";
      const runtimeBytes = byteLen(runtime);

      // Calculate initcode from artifact bytecode or factory
      let initcodeBytes = 0;
      let isAbstract = false;
      
      // Try using bytecode from artifact first
      const artifactBytecode = artifact.bytecode ?? "0x";
      if (artifactBytecode && artifactBytecode !== "0x" && byteLen(artifactBytecode) > runtimeBytes) {
        // initcode = bytecode (contains constructor + runtime)
        initcodeBytes = byteLen(artifactBytecode);
      } else {
        // Try calculating initcode from factory
        try {
          const args = getConstructorArgs(name);
          const factory = await ethers.getContractFactory(name);
          
          try {
            const deployTx = await factory.getDeployTransaction(...args);
            const initcode = deployTx.data?.toString() ?? "0x";
            initcodeBytes = byteLen(initcode);
          } catch (deployError: any) {
            // If it fails, contract might be abstract
            if (deployError.message?.includes("abstract") || deployError.message?.includes("constructor")) {
              isAbstract = true;
            } else {
              throw deployError;
            }
          }
        } catch (e: any) {
          // Abstract contracts cannot be deployed
          if (e.message?.includes("abstract") || e.message?.includes("cannot be instantiated")) {
            isAbstract = true;
          } else {
            // If contract is library or abstract, initcode = 0
            isAbstract = true;
          }
        }
      }

      const limits = checkLimits(runtimeBytes, initcodeBytes);
      
      results.push({
        name,
        runtimeBytes,
        initcodeBytes,
        runtimeOk: limits.runtimeOk,
        initcodeOk: limits.initcodeOk,
      });

      // Print results with warnings
      const runtimeStatus = limits.runtimeOk ? "✓" : "✗ EXCEEDS LIMIT";
      const initcodeStatus = limits.initcodeOk ? "✓" : "✗ EXCEEDS LIMIT";
      
      console.log(`${name}:`);
      console.log(`  Runtime:   ${formatBytes(runtimeBytes).padStart(10)} bytes ${runtimeStatus}`);
      if (!limits.runtimeOk) {
        const excess = runtimeBytes - RUNTIME_LIMIT;
        console.log(`    ⚠️  Exceeds limit by ${formatBytes(excess)} bytes (${((excess / RUNTIME_LIMIT) * 100).toFixed(1)}%)`);
      }
      
      if (isAbstract || initcodeBytes === 0) {
        console.log(`  Initcode:  N/A (abstract contract or library)`);
      } else {
        console.log(`  Initcode:  ${formatBytes(initcodeBytes).padStart(10)} bytes ${initcodeStatus}`);
        if (!limits.initcodeOk) {
          const excess = initcodeBytes - INITCODE_LIMIT;
          console.log(`    ⚠️  Exceeds limit by ${formatBytes(excess)} bytes (${((excess / INITCODE_LIMIT) * 100).toFixed(1)}%)`);
        }
      }
      console.log();

    } catch (e: any) {
      results.push({
        name,
        runtimeBytes: 0,
        initcodeBytes: 0,
        runtimeOk: true,
        initcodeOk: true,
        error: e?.message ?? String(e),
      });
      console.log(`${name}:`);
      console.log(`  ⚠️  (skip) ${e?.message ?? e}`);
      console.log();
    }
  }

  // Summary table
  console.log("=".repeat(80));
  console.log("Summary");
  console.log("=".repeat(80));
  
  const deployableContracts = results.filter(r => r.initcodeBytes > 0 && !r.error && r.runtimeBytes > 0);
  const problematicContracts = results.filter(r => !r.runtimeOk || !r.initcodeOk);
  
  console.log(`Total contracts checked: ${results.length}`);
  console.log(`Deployable contracts: ${deployableContracts.length}`);
  console.log(`Contracts exceeding limits: ${problematicContracts.length}`);
  console.log();

  if (problematicContracts.length > 0) {
    console.log("⚠️  Contracts exceeding limits:");
    for (const contract of problematicContracts) {
      console.log(`  - ${contract.name}`);
      if (!contract.runtimeOk) {
        console.log(`    Runtime: ${formatBytes(contract.runtimeBytes)} bytes (limit: ${formatBytes(RUNTIME_LIMIT)})`);
      }
      if (!contract.initcodeOk) {
        console.log(`    Initcode: ${formatBytes(contract.initcodeBytes)} bytes (limit: ${formatBytes(INITCODE_LIMIT)})`);
      }
    }
    console.log();
  }

  // Largest contracts
  const sortedByRuntime = [...results]
    .filter(r => r.runtimeBytes > 0)
    .sort((a, b) => b.runtimeBytes - a.runtimeBytes);
  
  if (sortedByRuntime.length > 0) {
    console.log("Largest contracts (by runtime bytecode):");
    for (let i = 0; i < Math.min(5, sortedByRuntime.length); i++) {
      const contract = sortedByRuntime[i];
      console.log(`  ${i + 1}. ${contract.name}: ${formatBytes(contract.runtimeBytes)} bytes`);
    }
  }

  console.log("=".repeat(80));
}

await main();
