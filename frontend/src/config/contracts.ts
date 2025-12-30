// Auto-generated - Do not edit manually
// This file is generated automatically by scripts/copy-contract-info.cjs
// Run "npm run compile" to regenerate

export const CONTRACTS = {
  ethereumSepolia: {
    chainId: 11155111,
    VeritasCcipReceiverRegistry: '0x2718a6057cE3d0a57a219Abe21612eD104457f7C'
  },
  baseSepolia: {
    chainId: 84532,
    VeritasCore: '0x411947c4C08E0583A84E58d48f108c136978c11D',
    LinkToken: '0xE4aB69C077896252FAFBD49EFD26B5D171A32410' // Base Sepolia LINK token
  }
} as const;

export const CHAIN_IDS = {
  baseSepolia: CONTRACTS.baseSepolia.chainId,
  ethereumSepolia: CONTRACTS.ethereumSepolia.chainId
} as const;
