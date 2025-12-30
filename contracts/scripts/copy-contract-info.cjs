const fs = require('fs');
const path = require('path');

console.log('📦 Copying contract info to frontend...\n');

// 1. نسخ ABI
const contracts = [
  { name: 'VeritasCore', source: 'l2/VeritasCore.sol' },
  { name: 'VeritasCcipReceiverRegistry', source: 'l1/VeritasCcipReceiverRegistry.sol' }
];

const frontendAbisPath = path.join(__dirname, '../../frontend/src/abis');
const artifactsPath = path.join(__dirname, '../artifacts/contracts');

// إنشاء folder إذا لم يكن موجود
if (!fs.existsSync(frontendAbisPath)) {
  fs.mkdirSync(frontendAbisPath, { recursive: true });
  console.log(`📁 Created directory: ${frontendAbisPath}`);
}

contracts.forEach(({ name, source }) => {
  const artifactPath = path.join(artifactsPath, source, `${name}.json`);
  const abiPath = path.join(frontendAbisPath, `${name}.json`);
  
  if (fs.existsSync(artifactPath)) {
    const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
    fs.writeFileSync(abiPath, JSON.stringify(artifact.abi, null, 2));
    console.log(`✅ Copied ${name} ABI`);
  } else {
    console.warn(`⚠️  Artifact not found: ${artifactPath}`);
  }
});

// 2. نسخ Addresses و Chain IDs
try {
  const deployments = {
    ethereumSepolia: JSON.parse(fs.readFileSync(path.join(__dirname, '../deployments/ethereumSepolia.json'), 'utf8')),
    baseSepolia: JSON.parse(fs.readFileSync(path.join(__dirname, '../deployments/baseSepolia.json'), 'utf8'))
  };

  const configPath = path.join(__dirname, '../../frontend/src/config/contracts.ts');
  const configContent = `// Auto-generated - Do not edit manually
// This file is generated automatically by scripts/copy-contract-info.cjs
// Run "npm run compile" to regenerate

export const CONTRACTS = {
  ethereumSepolia: {
    chainId: ${deployments.ethereumSepolia.chainId},
    VeritasCcipReceiverRegistry: '${deployments.ethereumSepolia.l1.VeritasCcipReceiverRegistry}'
  },
  baseSepolia: {
    chainId: ${deployments.baseSepolia.chainId},
    VeritasCore: '${deployments.baseSepolia.l2.VeritasCore}'
  }
} as const;
`;

  const configDir = path.dirname(configPath);
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
    console.log(`📁 Created directory: ${configDir}`);
  }
  fs.writeFileSync(configPath, configContent);
  console.log('✅ Generated contracts config\n');
} catch (error) {
  console.error('❌ Error generating contracts config:', error.message);
  console.error('   Make sure deployments files exist and are valid JSON');
  process.exit(1);
}

console.log('✨ Done!');

