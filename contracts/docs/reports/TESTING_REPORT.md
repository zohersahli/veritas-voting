# Testing Report

**Date:** December 2025 
**Test Framework:** Hardhat + Mocha + Ethers.js  
**Coverage Tool:** Hardhat 3 built-in coverage

---

## Executive Summary

Comprehensive testing was conducted on the Veritas smart contract system. All 121 tests pass successfully. Test coverage focuses on production code, with mocks excluded from coverage calculations (standard practice).

**Key Metrics:**
- ✅ 121 tests, all passing
- ✅ Production code coverage: See details below
- ✅ Mocks excluded from coverage (test utilities)

---

## Test Coverage

### Production Code Coverage (Excluding Mocks)

**Note:** Mocks (`contracts/mocks/**`) are excluded from coverage analysis as they are test utilities and not part of the production codebase. This is standard practice and aligns with industry best practices.

**Coverage Calculation:**
```bash
npx hardhat clean
npx hardhat test --coverage --config hardhat.coverage.config.ts
```

**Production Code Coverage Results:**

| Contract | Line Coverage | Statement Coverage |
|----------|---------------|-------------------|
| VeritasCore.sol | 100.00% | 100.00% |
| VeritasCcipReceiverRegistry.sol | 100.00% | 100.00% |
| CcipEscrowSenderL2.sol | 100.00% | 92.21% |
| Groups.sol | 100.00% | 100.00% |
| Membership.sol | 98.66% | 99.22% |
| Polls.sol | 100.00% | 100.00% |
| Voting.sol | 100.00% | 100.00% |
| Delegation.sol | 100.00% | 94.68% |
| FinalizationL2.sol | 98.98% | 93.65% |
| QuorumMath.sol | 100.00% | 100.00% |
| **Average (Production)** | **99.76%** | **97.98%** |

**How Production Coverage Average Was Calculated:**

The production coverage average (99.76% Line, 97.98% Statement) was calculated by:
1. Extracting coverage percentages from the full coverage report
2. Identifying production contracts (excluding mocks and harnesses)
3. Calculating the arithmetic mean of Line Coverage and Statement Coverage for production contracts only
4. Mocks (`MockCcipRouter.sol`, `MockLink.sol`, `MockERC721.sol`, etc.) and harnesses (`FinalizationHarness.sol`, `GroupsHarness.sol`, etc.) were excluded from the calculation

**Configuration:**
- Coverage tool: Hardhat 3 built-in coverage
- Solidity version: 0.8.30 (coverage compatibility)
- Note: Hardhat 3 built-in coverage does not support `skipFiles` configuration. Mocks are excluded from analysis manually.

### Full Coverage (Including Mocks)

**Overall Coverage:** 92.65% Line, 92.60% Statement (includes test utilities)

**Note:** This figure includes mocks and is provided for transparency. Production code coverage (excluding mocks) is the primary metric and shows **99.76% Line Coverage** and **97.98% Statement Coverage**.

---

## Test Results

### Test Suites

All test suites pass successfully:

1. **VeritasCore Tests**
   - Core functionality
   - Pause/unpause
   - Integration tests

2. **CcipEscrowSenderL2 Tests**
   - Escrow creation
   - Fee handling
   - CCIP message sending
   - ACK reception

3. **VeritasCcipReceiverRegistry Tests**
   - L1 registry functionality
   - CCIP message reception
   - Access control

4. **Groups Tests**
   - Group creation
   - Membership types
   - Access control

5. **Membership Tests**
   - Manual membership
   - NFT membership
   - Claim code membership

6. **Polls Tests**
   - Poll creation
   - Time validation
   - Option validation
   - Quorum validation

7. **Voting Tests**
   - Vote casting
   - Timing validation
   - Option validation
   - Membership validation

8. **Delegation Tests**
   - Delegation logic
   - Revocation logic
   - Circular delegation prevention
   - Chain delegation prevention

9. **FinalizationL2 Tests**
   - Result calculation
   - Quorum validation
   - Status determination

10. **QuorumMath Tests**
    - Quorum calculations
    - BPS validation
    - Overflow protection

---

## Test Methodology

### Unit Tests

- **Purpose:** Test individual contract functions
- **Coverage:** All public and internal functions
- **Framework:** Mocha + Ethers.js

### Integration Tests

- **Purpose:** Test cross-contract interactions
- **Coverage:** L1 ↔ L2 communication via CCIP
- **Framework:** Mocha + Ethers.js

### Test Categories

1. **Happy Path Tests:** Normal operation scenarios
2. **Edge Cases:** Boundary conditions
3. **Error Cases:** Invalid inputs and error conditions
4. **Access Control:** Permission checks
5. **Reentrancy:** Reentrancy protection verification

---

## Excluded from Coverage

### Mocks (Test Utilities)

The following mock contracts are excluded from coverage:

- `MockCcipRouter.sol`
- `MockLink.sol`
- `MockERC721.sol`
- `MockERC721Balance.sol`
- `FinalizationHarness.sol`
- `GroupsHarness.sol`
- `MembershipTypeHarness.sol`
- `QuorumMathHarness.sol`

**Reason:** Mocks are test utilities and not part of the production codebase. Excluding them from coverage is standard practice and provides a more accurate representation of production code quality.

---

## Test Execution

### Running Tests

```bash
# Run all tests
npx hardhat test

# Run with coverage (production code only)
npx hardhat clean
npx hardhat test --coverage --config hardhat.coverage.config.ts

# Run specific test file
npx hardhat test test/VeritasCore.ts
# Note: All test files use .ts extension (previously .spec.ts)
```

### Test Environment

- **Network:** Hardhat local network
- **Solidity Version:** 0.8.30 (coverage), 0.8.31 (development)
- **Optimizer:** Enabled (runs: 200, viaIR: true)

---

## Smoke Test on Testnet

### Overview

A comprehensive end-to-end smoke test was conducted on Ethereum Sepolia (L1) and Base Sepolia (L2) testnets to validate the complete CCIP cross-chain voting flow.

**Test Date:** December 27, 2025  
**Test Script:** `scripts/test-ccip-testnet.ts`  
**Networks:** 
- L1: Ethereum Sepolia
- L2: Base Sepolia

### Test Flow

The smoke test validates the complete voting lifecycle:

1. **Group Creation** - Create groups on L2 (ensures fresh `groupId`)
2. **LINK Approval** - Approve LINK tokens for VeritasCore
3. **Poll Creation** - Create poll with LINK escrow
4. **Voting** - Cast vote on L2
5. **Finalization** - Finalize poll results on L2
6. **L2→L1 Message** - Send results to L1 via CCIP
7. **L1 Record** - Verify results recorded on L1
8. **L1→L2 ACK** - Verify ACK received on L2

### Test Results

**Status:** ✅ **PASSED**

#### Test Execution Details

- **GroupId:** 5 (fresh, not used on L1 before)
- **PollId:** 3
- **Key:** `0x405aad32e1adbac89bb7f176e338b8fc6e994ca210c9bb7bdca249b465942250`
- **L2→L1 MessageId:** `0x5efca5fe6e1a47d9c7611106168a507e67c993f55d28bb0e20d9e7eb89b9bd35`
- **L1→L2 ACK MessageId:** `0xf56fa1f91dde1f18f8678674f855b8ac72f66d276bb568bd14b2847b517c3de5`

#### Contract Addresses

- **L1 Receiver Registry:** `0x2718a6057cE3d0a57a219Abe21612eD104457f7C` (Ethereum Sepolia)
- **L2 VeritasCore:** `0x411947c4C08E0583A84E58d48f108c136978c11D` (Base Sepolia)

#### Verification Points

✅ **L2→L1 Message:** Successfully sent via CCIP  
✅ **L1 Record:** Results recorded on L1 (`isRecorded: true`)  
✅ **L1→L2 ACK:** ACK successfully received on L2 (`ackReceived: true`)  
✅ **Message Matching:** L1 record contains correct `messageId` matching L2→L1 message

### Test Configuration

**Timeout Settings:**
- L1 Record Wait: 60 minutes
- ACK Wait: 60 minutes
- Poll Interval: 15 seconds

**Network Configuration:**
- CCIP Router (L1): Ethereum Sepolia CCIP Router
- CCIP Router (L2): Base Sepolia CCIP Router
- LINK Token (L1): `0x779877A7B0D9E8603169DdbD7836e478b4624789`
- LINK Token (L2): `0xE4aB69C077896252FAFBD49EFD26B5D171A32410`

### Key Improvements Made

1. **Contract Fix:** Refactored `CcipEscrowSenderL2` to inherit `CCIPReceiver` from Chainlink, fixing `msg.sender` validation issues
2. **Fresh GroupId:** Script creates two groups and uses the second one to ensure a fresh `groupId` on L1
3. **MessageId Verification:** Added explicit `messageId` matching to prevent false positives from old records
4. **Extended Timeouts:** Increased timeouts to 60 minutes to accommodate CCIP latency on testnet
5. **Enhanced Logging:** Added comprehensive test summary with all relevant IDs

### Running the Smoke Test

```bash
# Run smoke test on Base Sepolia
npx hardhat run .\scripts\test-ccip-testnet.ts --network baseSepolia
```

**Prerequisites:**
- L1 and L2 contracts deployed
- Cross-chain configuration completed (`configure-l1.ts` and `configure-l2.ts`)
- Sufficient LINK balance on L2 for CCIP fees
- Sufficient LINK balance on L1 Receiver for ACK fees
- Sufficient ETH balance on L1 Receiver for gas

### Troubleshooting

If the test times out:
1. Check CCIP Explorer for message status: https://ccip.chain.link/
2. Verify L1 record manually:
   ```bash
   npx hardhat run .\scripts\check-status.ts --network ethereumSepolia
   ```
3. Verify L2 ACK status:
   ```bash
   npx hardhat run .\scripts\check-status.ts --network baseSepolia
   ```

---

## Conclusion

All tests pass successfully. The test suite provides comprehensive coverage of production code functionality, including edge cases and error conditions. The codebase is well-tested and ready for deployment.

**Test Status:** ✅ All Tests Passing  
**Coverage Status:** ✅ Comprehensive  
**Smoke Test:** ✅ Passed on Testnet  
**Readiness:** ✅ Ready for Testnet

---

## Appendix

### Test Files

**Test Files (13 files):**
- `test/VeritasCore.ts`
- `test/VeritasCcipReceiverRegistry.ts`
- `test/Groups.ts`
- `test/Membership.ts`
- `test/Polls.ts`
- `test/Voting.ts`
- `test/Delegation.ts`
- `test/FinalizationL2.ts`
- `test/QuorumMath.ts`
- `test/CcipEscrowSenderL2.ts`
- `test/CcipEscrowSenderL2.extra.ts`
- `test/CcipEscrowSenderL2.moreBranches.extra.ts`
- `test/CcipEscrowSenderL2.constructor.extra.ts`


### Coverage Configuration

**Note:** Hardhat 3 built-in coverage does not support `skipFiles` configuration. Mocks are excluded from coverage analysis manually. The `.solcover.json` file exists but is not currently used by Hardhat 3's built-in coverage tool.

**Manual Exclusion:**
- Mocks (`contracts/mocks/**`) are excluded from coverage analysis
- Production code coverage is calculated separately: **99.76% Line, 97.98% Statement**

