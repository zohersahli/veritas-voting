# Post-Vote Flow Frontend Audit Report

## Executive Summary

This audit identifies **6 critical bugs** and **2 missing features** that break the expected post-vote flow. The root causes are:

1. **State gating logic errors**: `canSendToL1` uses Finalize conditions instead of Send conditions
2. **Time comparison bug**: `now <= end` should be `now < end` (contract uses `>=` for ended check)
3. **Missing refetch logic**: No data refresh after successful finalize/send transactions
4. **Missing escrow validation**: UI doesn't check if escrow exists before showing Send to L1 button
5. **Missing status check**: Finalize button doesn't verify poll is actually Ended

---

## Detailed Issues

### Issue #1: Wrong Time Comparison Logic (CRITICAL)

**Location**: `frontend/src/pages/Results.tsx:190`

**Problem**:
```typescript
: now <= end
  ? PollStatus.Active
  : PollStatus.Ended;
```

**Why it breaks**:
- Contract `Voting.sol:62` checks: `if (nowTs >= endTime) revert VotingPollEnded`
- This means voting is allowed ONLY when `nowTs < endTime`
- Frontend uses `now <= end` which incorrectly treats `now == end` as Active
- When `now == end`, contract rejects votes but UI shows Active status
- This causes Finalize button to appear too early (when `now == end` but contract still rejects)

**Minimal Fix**:
```typescript
: now < end  // Change from now <= end
  ? PollStatus.Active
  : PollStatus.Ended;
```

**Impact**: P0 - Breaks core timing logic

---

### Issue #2: Wrong `canSendToL1` Condition (CRITICAL)

**Location**: `frontend/src/pages/Results.tsx:221`

**Problem**:
```typescript
const canSendToL1 = status === PollStatus.Ended && !isFinalized && quorumMet;
```

**Why it breaks**:
- Contract `CcipEscrowSenderL2.sol:298` requires: `if (!r.finalized) revert NotFinalized(pollId)`
- Send to L1 is ONLY allowed AFTER finalization
- Current code uses Finalize conditions (`!isFinalized`) instead of Send conditions (`isFinalized`)
- Button appears when poll is Ended but NOT finalized (wrong state)
- Button disappears after finalization (should appear instead)

**Minimal Fix**:
```typescript
const canFinalize = status === PollStatus.Ended && !isFinalized;
const canSendToL1 = isFinalized === true;  // Only after finalization
```

**Impact**: P0 - Send to L1 button never appears when it should

---

### Issue #3: Missing Finalize Status Check (HIGH)

**Location**: `frontend/src/pages/Results.tsx:290`

**Problem**:
```typescript
const finalizeDisabled = view.isFinalized || !canWrite;
```

**Why it breaks**:
- Doesn't check if `status === PollStatus.Ended`
- Button could be enabled during Active/Upcoming states
- Contract `FinalizationL2.sol:103` requires: `if (nowTs < endTime) revert FinalizationPollNotEnded`
- UI should match contract logic

**Minimal Fix**:
```typescript
const finalizeDisabled = view.isFinalized || !canWrite || view.status !== PollStatus.Ended;
```

**Impact**: P1 - Button may appear at wrong time

---

### Issue #4: Missing Refetch After Finalize (HIGH)

**Location**: `frontend/src/pages/Results.tsx` (missing useEffect)

**Problem**:
- No `useWaitForTransactionReceipt` for finalize transaction
- No refetch of `base` queries after finalize succeeds
- UI shows stale `res.finalized === false` even after successful finalization
- User must manually refresh page to see updated state

**Minimal Fix**:
Add imports at top:
```typescript
import { useWaitForTransactionReceipt } from "wagmi";
```

Add after line 179:
```typescript
// Track which function was called
const [lastFunction, setLastFunction] = useState<string | null>(null);

useEffect(() => {
  if (write.variables?.functionName) {
    setLastFunction(write.variables.functionName);
  }
}, [write.variables?.functionName]);

const finalizeReceipt = useWaitForTransactionReceipt({
  hash: txHash,
  chainId: CHAIN_IDS.baseSepolia,
  query: { enabled: Boolean(txHash) && lastFunction === "finalizePollOnL2" },
});

useEffect(() => {
  if (finalizeReceipt.isSuccess) {
    void base.refetch();
  }
}, [finalizeReceipt.isSuccess, base]);
```

**Impact**: P1 - UI doesn't update after finalization

---

### Issue #5: Missing Refetch After Send to L1 (HIGH)

**Location**: `frontend/src/pages/Results.tsx` (missing useEffect)

**Problem**:
- No `useWaitForTransactionReceipt` for send transaction
- No refetch after send succeeds
- UI doesn't update to reflect `escrow.sent === true`

**Minimal Fix**:
Add after finalize receipt:
```typescript
const sendReceipt = useWaitForTransactionReceipt({
  hash: txHash,
  chainId: CHAIN_IDS.baseSepolia,
  query: { enabled: Boolean(txHash) && lastFunction === "sendResultToL1" },
});

useEffect(() => {
  if (sendReceipt.isSuccess) {
    void base.refetch();
    // Also refetch escrow if you add it
  }
}, [sendReceipt.isSuccess, base]);
```

**Note**: Since `Results.tsx` uses a single `write` hook for both finalize and send, you need to track which function was called. Alternatively, use separate `useWriteContract` hooks like `PollDetails.tsx` does.

**Impact**: P1 - UI doesn't update after send

---

### Issue #6: Missing Escrow Existence Check (CRITICAL)

**Location**: `frontend/src/pages/Results.tsx` and `frontend/src/pages/PollDetails.tsx`

**Problem**:
- Contract `CcipEscrowSenderL2.sol:294` requires: `if (!e.exists) revert MissingEscrow(pollId)`
- Frontend never checks `escrows[pollId].exists` before showing Send to L1 button
- Button appears even for polls created without escrow (will revert on-chain)
- No read contract call to fetch escrow data

**Minimal Fix**:
Add escrow read in `Results.tsx` after line 123:
```typescript
const escrow = useReadContract({
  chainId: CHAIN_IDS.baseSepolia,
  address: veritasCoreAddress,
  abi: veritasCoreAbi,
  functionName: "escrows",
  args: [id],
  query: { enabled: hasValidPollId },
});

const escrowData = escrow.data as { exists: boolean; sent: boolean } | undefined;
```

Update `canSendToL1` in view (line 221):
```typescript
const canSendToL1 = isFinalized === true && escrowData?.exists === true && escrowData?.sent === false;
```

**Impact**: P0 - Button appears for polls without escrow (will fail on-chain)

---

### Issue #7: Missing Refetch After Send in PollDetails (MEDIUM)

**Location**: `frontend/src/pages/PollDetails.tsx:235`

**Problem**:
- `PollDetails.tsx` has refetch after finalize (line 173-178) ✅
- But no refetch after send to L1 succeeds
- `l1MessageId` is extracted correctly, but `res` and other data don't refresh

**Minimal Fix**:
Add after line 235:
```typescript
useEffect(() => {
  if (sendReceipt.isSuccess) {
    void base.refetch();
    void votes.refetch();
  }
}, [sendReceipt.isSuccess, base, votes]);
```

**Impact**: P2 - Minor UX issue, data may be stale

---

### Issue #8: Missing Escrow Check in PollDetails (HIGH)

**Location**: `frontend/src/pages/PollDetails.tsx:297`

**Problem**:
- Same as Issue #6: `canSendToL1` doesn't check escrow existence
- Button appears even without escrow

**Minimal Fix**:
Add escrow read (similar to Results.tsx) and update `canSendToL1`:
```typescript
const escrow = useReadContract({
  chainId: CHAIN_IDS.baseSepolia,
  address: veritasCoreAddress,
  abi: veritasCoreAbi,
  functionName: "escrows",
  args: [id],
  query: { enabled: hasValidPollId },
});

const escrowData = escrow.data as { exists: boolean; sent: boolean } | undefined;

const canSendToL1 =
  isConnected &&
  isCorrectChain &&
  res?.finalized === true &&
  escrowData?.exists === true &&
  escrowData?.sent === false &&
  !sendPending;
```

**Impact**: P1 - Button appears for polls without escrow

---

## Summary Table

| # | File | Lines | Issue | Priority | Impact |
|---|------|-------|-------|----------|--------|
| 1 | `Results.tsx` | 190 | `now <= end` should be `now < end` | P0 | Wrong status at boundary |
| 2 | `Results.tsx` | 221 | `canSendToL1` uses Finalize condition | P0 | Button never appears |
| 3 | `Results.tsx` | 290 | Missing status check in `finalizeDisabled` | P1 | Button may appear early |
| 4 | `Results.tsx` | - | Missing refetch after finalize | P1 | Stale UI state |
| 5 | `Results.tsx` | - | Missing refetch after send | P1 | Stale UI state |
| 6 | `Results.tsx` | - | Missing escrow existence check | P0 | Button for non-escrow polls |
| 7 | `PollDetails.tsx` | - | Missing refetch after send | P2 | Minor UX issue |
| 8 | `PollDetails.tsx` | 297 | Missing escrow existence check | P1 | Button for non-escrow polls |

---

## Verification Checklist

After applying fixes, manually verify:

### Results.tsx
- [ ] Poll status changes from Active → Ended exactly at `endTime` (not before)
- [ ] Finalize button appears ONLY when `now >= endTime` AND `finalized === false`
- [ ] Finalize button disappears after successful finalization
- [ ] Send to L1 button appears ONLY after finalization AND escrow exists
- [ ] Send to L1 button disappears after successful send
- [ ] After finalize tx confirms, UI shows `finalized === true` without refresh
- [ ] After send tx confirms, UI updates without refresh
- [ ] For polls without escrow, Send to L1 button is hidden

### PollDetails.tsx
- [ ] Same checks as Results.tsx
- [ ] `l1MessageId` appears after send success
- [ ] Data refreshes after send without manual refresh

### Contract Alignment
- [ ] Finalize tx succeeds when `now >= endTime` (test at boundary)
- [ ] Finalize tx fails when `now < endTime`
- [ ] Send to L1 tx succeeds when `finalized === true` AND `escrow.exists === true`
- [ ] Send to L1 tx fails when `escrow.exists === false` (no escrow poll)
- [ ] Send to L1 tx fails when `finalized === false`

---

## Recommended Fix Order

1. **Fix #1** (time comparison) - Prevents wrong status
2. **Fix #2** (canSendToL1 logic) - Enables correct button state
3. **Fix #6** (escrow check in Results) - Prevents failed transactions
4. **Fix #8** (escrow check in PollDetails) - Prevents failed transactions
5. **Fix #4** (refetch after finalize) - Improves UX
6. **Fix #5** (refetch after send) - Improves UX
7. **Fix #3** (finalize status check) - Extra safety
8. **Fix #7** (refetch in PollDetails) - Minor improvement

---

## Notes

- All chainId checks are correct ✅
- Network switching logic is correct ✅
- Event decoding in PollDetails.tsx is correct ✅
- L1Results.tsx is correct ✅
- No ABI mismatches found ✅
- Time units are correct (seconds) ✅

The main issues are **state gating logic** and **missing refetch/escrow checks**.

---

## Root Cause Analysis

The bugs stem from **three architectural gaps**:

1. **Incomplete state machine**: UI doesn't fully mirror contract state transitions
   - Contract: `Active → Ended → Finalized → Sent`
   - UI: Missing proper transitions and guards

2. **Missing data dependencies**: UI doesn't read all required contract state
   - Escrow existence is never checked
   - Refetch logic is incomplete

3. **Time boundary mismatch**: Frontend uses inclusive comparison (`<=`) while contract uses exclusive (`>=`)
   - This creates a one-second window where UI and contract disagree

**Fix Strategy**: 
- Align time comparisons with contract logic
- Add missing state checks (escrow, status)
- Implement complete refetch chain after state-changing transactions
- Consider using separate `useWriteContract` hooks for each action (like PollDetails.tsx) instead of a single shared hook
