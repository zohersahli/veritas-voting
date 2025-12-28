# Deployment Documentation

**Date:** December 27, 2025  
**Networks:** Ethereum Sepolia (L1) & Base Sepolia (L2)  
**Status:** ✅ Deployed, Configured, Verified, and Tested

---

## Contract Addresses

### L1 - Ethereum Sepolia

**VeritasCcipReceiverRegistry**
- **Address:** `0x2718a6057cE3d0a57a219Abe21612eD104457f7C`
- **Network:** Ethereum Sepolia
- **Chain ID:** 11155111
- **Deployed:** December 27, 2025

**Verification Links:**
- **Etherscan:** https://sepolia.etherscan.io/address/0x2718a6057cE3d0a57a219Abe21612eD104457f7C#code
- **Blockscout:** https://eth-sepolia.blockscout.com/address/0x2718a6057cE3d0a57a219Abe21612eD104457f7C#code
- **Sourcify:** https://sourcify.dev/server/repo-ui/11155111/0x2718a6057cE3d0a57a219Abe21612eD104457f7C

---

### L2 - Base Sepolia

**VeritasCore**
- **Address:** `0x411947c4C08E0583A84E58d48f108c136978c11D`
- **Network:** Base Sepolia
- **Chain ID:** 84532
- **Deployed:** December 27, 2025

**Verification Links:**
- **Basescan:** https://sepolia.basescan.org/address/0x411947c4C08E0583A84E58d48f108c136978c11D#code
- **Blockscout:** https://base-sepolia.blockscout.com/address/0x411947c4C08E0583A84E58d48f108c136978c11D#code
- **Sourcify:** https://sourcify.dev/server/repo-ui/84532/0x411947c4C08E0583A84E58d48f108c136978c11D

---

## Deployment Configuration

### Deployer Information

- **Deployer Address:** `0x30469bE3132C668EA8D39e718F9b6e94De65b2b3`
- **Treasury Address:** `0x040FFC592d37cAf8525fEd3CE6cB0d3FE1b770C9`

---

## CCIP Configuration

### L1 Configuration (Ethereum Sepolia)

**CCIP Router:**
- **Address:** `0x0BF3dE8c5D3e8A2B34D2BEeB17ABfCeBaf363A59`

**LINK Token:**
- **Address:** `0x779877A7B0D9E8603169DdbD7836e478b4624789`

**Chain Selectors:**
- **Source Chain Selector (Base Sepolia):** `10344971235874465080`
- **Destination Chain Selector (Ethereum Sepolia):** `16015286601757825753`

**Gas Limits:**
- **CCIP Receiver Gas Limit:** `1000000`
- **CCIP ACK Gas Limit:** `1000000`

**ACK Configuration:**
- **ACK Destination Chain Selector:** `10344971235874465080` (Base Sepolia)
- **ACK L2 Receiver:** `0x411947c4C08E0583A84E58d48f108c136978c11D` (VeritasCore)
- **ACK Fee Token:** `0x779877A7B0D9E8603169DdbD7836e478b4624789` (L1 LINK)

**Allowed Sender:**
- **L2 VeritasCore:** `0x411947c4C08E0583A84E58d48f108c136978c11D`

---

### L2 Configuration (Base Sepolia)

**CCIP Router:**
- **Address:** `0xD3b06cEbF099CE7DA4AcCf578aaebFDBd6e88a93`

**LINK Token:**
- **Address:** `0xE4aB69C077896252FAFBD49EFD26B5D171A32410`

**Chain Selectors:**
- **Source Chain Selector (Base Sepolia):** `10344971235874465080`
- **Destination Chain Selector (Ethereum Sepolia):** `16015286601757825753`

**Gas Limits:**
- **CCIP Receiver Gas Limit:** `1000000`

**ACK Configuration:**
- **ACK Source Chain Selector:** `16015286601757825753` (Ethereum Sepolia)
- **ACK Sender (L1 Receiver Registry):** `0x2718a6057cE3d0a57a219Abe21612eD104457f7C`

**L1 Receiver:**
- **L1 Receiver Registry:** `0x2718a6057cE3d0a57a219Abe21612eD104457f7C`

---

## Deployment Steps

### 1. L1 Deployment (Ethereum Sepolia)

```bash
cd H:\veritas\contracts
npx hardhat run .\scripts\deploy-l1.ts --network ethereumSepolia
```

**Constructor Arguments:**
- `router`: `0x0BF3dE8c5D3e8A2B34D2BEeB17ABfCeBaf363A59` (L1_CCIP_ROUTER)
- `allowedSourceChainSelector`: `10344971235874465080` (CCIP_SOURCE_CHAIN_SELECTOR)
- `allowedSender`: `0x30469bE3132C668EA8D39e718F9b6e94De65b2b3` (Deployer - temporary)

**Result:**
- Contract deployed at: `0x2718a6057cE3d0a57a219Abe21612eD104457f7C`
- Saved to: `deployments/ethereumSepolia.json`

---

### 2. L2 Deployment (Base Sepolia)

```bash
cd H:\veritas\contracts
npx hardhat run .\scripts\deploy-l2.ts --network baseSepolia
```

**Prerequisites:**
- Set `CONFIRM_TESTNET_DEPLOY="YES"` in `.env`
- Set `L1_RECEIVER_REGISTRY_ADDRESS` in `.env` to L1 contract address

**Constructor Arguments:**
- `router`: `0xD3b06cEbF099CE7DA4AcCf578aaebFDBd6e88a93` (L2_CCIP_ROUTER)
- `link`: `0xE4aB69C077896252FAFBD49EFD26B5D171A32410` (L2_LINK_TOKEN)
- `destSelector`: `16015286601757825753` (CCIP_DEST_CHAIN_SELECTOR)
- `l1Receiver`: `0x2718a6057cE3d0a57a219Abe21612eD104457f7C` (L1_RECEIVER_REGISTRY_ADDRESS)
- `treasury`: `0x040FFC592d37cAf8525fEd3CE6cB0d3FE1b770C9` (TREASURY_ADDRESS)
- `receiverGasLimit`: `1000000` (CCIP_RECEIVER_GAS_LIMIT)

**Result:**
- Contract deployed at: `0x411947c4C08E0583A84E58d48f108c136978c11D`
- Saved to: `deployments/baseSepolia.json`

---

### 3. L1 Configuration

```bash
cd H:\veritas\contracts
npx hardhat run .\scripts\configure-l1.ts --network ethereumSepolia
```

**Actions:**
1. Set `allowedSender` to L2 VeritasCore address
2. Set ACK configuration (destination selector, L2 receiver, fee token, gas limit)
3. Optionally fund L1 Receiver with LINK for ACK fees (if `L1_ACK_FUND_AMOUNT_LINK` is set)

**Configuration:**
- `allowedSender`: `0x411947c4C08E0583A84E58d48f108c136978c11D` (L2 VeritasCore)
- `ackDestinationChainSelector`: `10344971235874465080` (Base Sepolia)
- `ackL2Receiver`: `0x411947c4C08E0583A84E58d48f108c136978c11D` (L2 VeritasCore)
- `ackFeeToken`: `0x779877A7B0D9E8603169DdbD7836e478b4624789` (L1 LINK)
- `ackGasLimit`: `1000000`

---

### 4. L2 Configuration

```bash
cd H:\veritas\contracts
npx hardhat run .\scripts\configure-l2.ts --network baseSepolia
```

**Actions:**
1. Set ACK allowlist (source selector, sender)

**Configuration:**
- `ackSourceChainSelector`: `16015286601757825753` (Ethereum Sepolia)
- `ackSender`: `0x2718a6057cE3d0a57a219Abe21612eD104457f7C` (L1 Receiver Registry)

---

### 5. Contract Verification

#### L1 Verification (Ethereum Sepolia)

```bash
cd H:\veritas\contracts
npx hardhat verify \
  --network ethereumSepolia \
  0x2718a6057cE3d0a57a219Abe21612eD104457f7C \
  "0x0BF3dE8c5D3e8A2B34D2BEeB17ABfCeBaf363A59" \
  "10344971235874465080" \
  "0x30469bE3132C668EA8D39e718F9b6e94De65b2b3"
```

**Verification Status:** ✅ Verified

---

#### L2 Verification (Base Sepolia)

```bash
cd H:\veritas\contracts
npx hardhat verify \
  --network baseSepolia \
  0x411947c4C08E0583A84E58d48f108c136978c11D \
  "0xD3b06cEbF099CE7DA4AcCf578aaebFDBd6e88a93" \
  "0xE4aB69C077896252FAFBD49EFD26B5D171A32410" \
  "16015286601757825753" \
  "0x2718a6057cE3d0a57a219Abe21612eD104457f7C" \
  "0x040FFC592d37cAf8525fEd3CE6cB0d3FE1b770C9" \
  "1000000"
```

**Verification Status:** ✅ Verified

---

## Funding Requirements

### L1 Receiver (VeritasCcipReceiverRegistry)

**ETH Balance:**
- Required for gas when processing incoming CCIP messages
- Recommended: ~0.01 ETH minimum

**LINK Balance:**
- Required for ACK fees when sending ACK messages to L2
- Recommended: ~2 LINK minimum (configurable via `L1_ACK_FUND_AMOUNT_LINK`)

**Funding Script:**
```bash
# Fund with ETH (manual transfer or use fund-l1-receiver-eth.ts)
# Fund with LINK (via configure-l1.ts if L1_ACK_FUND_AMOUNT_LINK is set)
```

---

### L2 VeritasCore

**LINK Balance:**
- Required for CCIP fees when sending results to L1
- Users approve LINK to VeritasCore before creating polls
- Escrow mechanism handles LINK for CCIP fees

---

## Testing

### Smoke Test

A comprehensive end-to-end smoke test was conducted and passed successfully.

**Test Script:**
```bash
cd H:\veritas\contracts
npx hardhat run .\scripts\test-ccip-testnet.ts --network baseSepolia
```

**Test Results:**
- ✅ Group creation on L2
- ✅ Poll creation with LINK escrow
- ✅ Voting on L2
- ✅ Finalization on L2
- ✅ L2→L1 message via CCIP
- ✅ L1 record creation
- ✅ L1→L2 ACK message
- ✅ ACK received on L2

**Test Details:**
- **GroupId:** 5
- **PollId:** 3
- **L2→L1 MessageId:** `0x5efca5fe6e1a47d9c7611106168a507e67c993f55d28bb0e20d9e7eb89b9bd35`
- **L1→L2 ACK MessageId:** `0xf56fa1f91dde1f18f8678674f855b8ac72f66d276bb568bd14b2847b517c3de5`

See `docs/reports/TESTING_REPORT.md` for detailed test results.

---

## Deployment Files

### JSON Files

- **L1 Deployment:** `deployments/ethereumSepolia.json`
- **L2 Deployment:** `deployments/baseSepolia.json`

### Scripts

- **L1 Deployment:** `scripts/deploy-l1.ts`
- **L2 Deployment:** `scripts/deploy-l2.ts`
- **L1 Configuration:** `scripts/configure-l1.ts`
- **L2 Configuration:** `scripts/configure-l2.ts`
- **Smoke Test:** `scripts/test-ccip-testnet.ts`
- **Status Check:** `scripts/check-status.ts`
- **L1 Funding:** `scripts/fund-l1-receiver-eth.ts`

---

## Environment Variables

### Required Variables

**RPC URLs:**
- `ETHEREUM_SEPOLIA_RPC_URL`
- `BASE_SEPOLIA_RPC_URL`

**Wallet:**
- `PRIVATE_KEY` (64 hex chars without 0x prefix)

**Treasury:**
- `TREASURY_ADDRESS`

**CCIP Configuration:**
- `L1_CCIP_ROUTER`
- `L2_CCIP_ROUTER`
- `L1_LINK_TOKEN`
- `L2_LINK_TOKEN`
- `CCIP_DEST_CHAIN_SELECTOR` (Ethereum Sepolia)
- `CCIP_SOURCE_CHAIN_SELECTOR` (Base Sepolia)
- `CCIP_RECEIVER_GAS_LIMIT`
- `CCIP_ACK_GAS_LIMIT`

**Deployment:**
- `L1_RECEIVER_REGISTRY_ADDRESS` (set after L1 deployment)
- `L2_VERITASCORE_ADDRESS` (set after L2 deployment)
- `CONFIRM_TESTNET_DEPLOY` (set to "YES" for testnet deployments)

**Verification:**
- `ETHERSCAN_API_KEY`
- `BASESCAN_API_KEY`

**Optional:**
- `L1_ACK_FUND_AMOUNT_LINK` (amount to fund L1 receiver with LINK)

---

## Important Notes

1. **Deployment Order:** Always deploy L1 first, then L2, then configure both sides.

2. **Configuration:** Cross-chain configuration must be done after both contracts are deployed.

3. **Funding:** L1 Receiver needs ETH for gas and LINK for ACK fees. Fund it before testing.

4. **Verification:** Contract verification requires correct constructor arguments in the exact order.

5. **Testing:** Run smoke test after deployment and configuration to verify end-to-end flow.

6. **Security:** Never commit `.env` file with real private keys or API keys to version control.

---

## Troubleshooting

### Common Issues

1. **"Contract already verified"**
   - Contract is already verified. Check Explorer links above.

2. **"Constructor arguments mismatch"**
   - Verify constructor arguments match deployment exactly.
   - Check order of arguments.

3. **"Insufficient balance"**
   - Ensure L1 Receiver has ETH for gas and LINK for ACK fees.
   - Check deployer wallet has sufficient funds.

4. **"ACK not received"**
   - Verify L1 Receiver has LINK balance for ACK fees.
   - Check ACK configuration on both L1 and L2.
   - Verify CCIP message status on CCIP Explorer.

5. **"Timeout in smoke test"**
   - CCIP messages can take 20-40 minutes on testnet.
   - Check CCIP Explorer for message status.
   - Use `check-status.ts` script to verify manually.

---

## References

- **CCIP Explorer:** https://ccip.chain.link/
- **Etherscan (Sepolia):** https://sepolia.etherscan.io/
- **Basescan (Sepolia):** https://sepolia.basescan.org/
- **Chainlink CCIP Docs:** https://docs.chain.link/ccip

---


