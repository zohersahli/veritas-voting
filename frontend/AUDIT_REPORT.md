# Blockchain + Frontend Architecture Audit Report

## Part A - Smart Contract Understanding (Source of Truth)

### A1) Executive Summary (10 lines)

Veritas is a cross-chain voting platform operating on Base Sepolia (L2) with finalization on Ethereum Sepolia (L1) via Chainlink CCIP. VeritasCore orchestrates Groups, Membership (Manual/NFT/ClaimCode), Polls, Voting with delegation, Finalization, and CCIP escrow. Users create groups, manage membership, create polls with LINK escrow, vote (with delegation), and finalize results. Finalized results are sent to L1 via CCIP. The system uses event indexing (PollCreated) for discovery since there's no on-chain mapping from groupId to pollIds. All user actions require membership verification and proper timing windows.

---

### A2) Contract API Table

| Feature | Contract | Function | Caller | Permissions | Event(s) |
|---------|----------|----------|--------|-------------|----------|
| Create Group | VeritasCore | `createGroup(name, description, membershipType)` | Anyone | `whenNotPaused` | `GroupCreated(groupId, owner, membershipType, name)` |
| Set Manual Member | VeritasCore | `setManualMember(groupId, member, isMember)` | Group Owner | `onlyGroupOwner` | `ManualMemberSet(groupId, member, isMember)`, `GroupMemberCountChanged(groupId, newCount)` |
| Set Group NFT | VeritasCore | `setGroupNft(groupId, nft)` | Group Owner | `onlyGroupOwner`, `membershipType == NFT` | `GroupNftSet(groupId, nft)` |
| Register with NFT | VeritasCore | `registerWithNft(groupId)` | Anyone | Must hold NFT | `NftMemberRegistered(groupId, member)`, `GroupMemberCountChanged(groupId, newCount)` |
| Create Claim Code | VeritasCore | `createClaimCode(groupId, codeHash)` | Group Owner | `onlyGroupOwner`, `membershipType == ClaimCode` | `ClaimCodeCreated(groupId, codeHash)` |
| Claim with Code | VeritasCore | `claimWithCode(groupId, codeHash)` | Anyone | Valid code, not owner | `ClaimCodeClaimed(groupId, codeHash, member)` |
| Create Poll | VeritasCore | `createPollWithLinkEscrow(groupId, title, cid, options[], startTime, endTime, quorumEnabled, quorumBps)` | Anyone | `whenNotPaused`, LINK approval, `startTime >= now` | `PollCreated(pollId, groupId, creator, ...)`, `EscrowLocked(pollId, groupId, creator, ...)`, `OpsFeeCharged(pollId, payer, treasury, amount)` |
| Vote | VeritasCore | `vote(pollId, optionIndex)` | Member | `whenNotPaused`, `isMember`, `!hasVoted`, `!delegated`, `startTime <= now < endTime` | `VoteCast(pollId, voter, optionIndex)`, `VoteCastWeighted(pollId, voter, optionIndex, weight)` |
| Delegate | VeritasCore | `delegate(pollId, delegate)` | Member | `whenNotPaused`, `isMember`, `!hasVoted`, `startTime <= now < endTime`, delegate must be member | `Delegated(pollId, groupId, delegator, delegate)` |
| Revoke Delegation | VeritasCore | `revoke(pollId)` | Delegator | `whenNotPaused`, `startTime <= now < endTime`, `!hasVoted` | `DelegationRevoked(pollId, groupId, delegator)` |
| Finalize Poll | VeritasCore | `finalizePollOnL2(pollId)` | Anyone | `now >= endTime`, `!finalized` | `PollFinalized(pollId, status, winningOption, totalVotes)` |
| Send to L1 | VeritasCore | `sendResultToL1(pollId)` | Anyone | `whenNotPaused`, `finalized`, `status != Unknown`, escrow exists | `ResultSentToL1(pollId, messageId, feePaid)` |

---

### A3) Workflow Spec

#### Workflow 1: Create Group

1. User calls `createGroup(name, description, membershipType)` on VeritasCore
   - Contract: `contracts/contracts/l2/VeritasCore.sol:L46-L52` (wraps `Groups.sol:L52-L73`)
   - Params: `name` (non-empty string), `description` (string), `membershipType` (0=Manual, 1=NFT, 2=ClaimCode)
   - Requires: `whenNotPaused`, `bytes(name).length > 0` (reverts `EmptyName`)
   - Emits: `GroupCreated(groupId, msg.sender, membershipType, name)` indexed by `groupId`, `owner`
   - Returns: `groupId` (auto-incremented from `nextGroupId`)

2. If `membershipType == 1` (NFT), owner must call `setGroupNft(groupId, nftAddress)`
   - Contract: `contracts/contracts/l2/Membership.sol:L199-L212`
   - Requires: `onlyGroupOwner`, `membershipType == NFT`, `nft != address(0)`
   - Emits: `GroupNftSet(groupId, nft)` indexed by `groupId`, `nft`

---

#### Workflow 2: Join Group / Membership Verification

**Manual (Type 0):**
- Owner calls `setManualMember(groupId, member, true)`
  - Contract: `contracts/contracts/l2/Membership.sol:L163-L193`
  - Requires: `onlyGroupOwner`, `member != owner`, `member != address(0)`, `membershipType != NFT`
  - Emits: `ManualMemberSet(groupId, member, true)`, `GroupMemberCountChanged(groupId, newCount)`

**NFT (Type 1):**
- User calls `registerWithNft(groupId)`
  - Contract: `contracts/contracts/l2/Membership.sol:L216-L239`
  - Requires: `membershipType == NFT`, `nftRegistered[groupId][user] == false`, `IERC721(nft).balanceOf(user) > 0`, `user != owner`
  - Emits: `NftMemberRegistered(groupId, member)`, `GroupMemberCountChanged(groupId, newCount)`
- At vote time: `isMember` checks `nftRegistered[groupId][user] && IERC721(nft).balanceOf(user) > 0`
  - Contract: `contracts/contracts/l2/Membership.sol:L120-L145`

**ClaimCode (Type 2):**
- Owner creates code: `createClaimCode(groupId, codeHash)`
  - Contract: `contracts/contracts/l2/Membership.sol:L261-L276`
  - Requires: `onlyGroupOwner`, `membershipType == ClaimCode`, `codeHash != bytes32(0)`, `claimCodeGroup[codeHash] == 0`
  - Emits: `ClaimCodeCreated(groupId, codeHash)` indexed by `groupId`, `codeHash`
- User claims: `claimWithCode(groupId, codeHash)`
  - Contract: `contracts/contracts/l2/Membership.sol:L278-L314`
  - Requires: Valid code, `!claimCodeUsed[codeHash]`, `user != owner`
  - Emits: `ClaimCodeClaimed(groupId, codeHash, member)`, stores in `manualMembers[groupId][user] = true`

---

#### Workflow 3: Create Poll

1. User approves LINK: `approve(veritasCoreAddress, amount)` on LINK token
   - Amount: `opsFeeFlat + maxFee + platformFee` (calculated by frontend)

2. User calls `createPollWithLinkEscrow(groupId, title, cid, options[], startTime, endTime, quorumEnabled, quorumBps)`
   - Contract: `contracts/contracts/l2/CcipEscrowSenderL2.sol:L214-L268`
   - Requires: `whenNotPaused`, `bytes(title).length > 0`, `bytes(cid).length > 0`, `options.length >= 2`, `endTime > startTime`, `startTime >= block.timestamp`, `quorumBps <= 10000`, if `quorumEnabled` then `quorumBps > 0` else `quorumBps == 0`
   - Internal: Calls `_createPoll(...)` which:
     - Contract: `contracts/contracts/l2/Polls.sol:L185-L255`
     - Snapshot: `eligibleCountSnapshot = getEligibleCountForQuorum(groupId)` (includes owner +1)
     - Emits: `PollCreated(pollId, groupId, creator, title, cid, startTime, endTime, quorumEnabled, quorumBps, eligibleCountSnapshot)` indexed by `pollId`, `groupId`, `creator`
   - Escrow: Locks `maxFee + platformFee`, charges `opsFeeFlat` to treasury
   - Emits: `EscrowLocked(pollId, groupId, creator, deposited, maxFee, platformFee)`, `OpsFeeCharged(pollId, payer, treasury, opsFee)`

---

#### Workflow 4: Vote

1. User calls `vote(pollId, optionIndex)`
   - Contract: `contracts/contracts/l2/Voting.sol:L50-L84` (called via `VeritasCore.sol:L54-L60`)
   - Requires: `whenNotPaused`, `!hasVoted[pollId][msg.sender]`, poll exists, `startTime <= now < endTime`, `optionIndex < optionsLength`, `isMember(groupId, msg.sender)`, `delegateOf[pollId][msg.sender] == address(0)` (not delegated)
   - Effects: `hasVoted[pollId][msg.sender] = true`, `voteCounts[pollId][optionIndex] += weight` (weight = 1 + delegatedToCount)
   - Emits: `VoteCast(pollId, voter, optionIndex)`, `VoteCastWeighted(pollId, voter, optionIndex, weight)`

---

#### Workflow 5: Poll Lifecycle Status Transitions

**On-chain status (computed from `block.timestamp`):**
- **Upcoming**: `now < startTime` (no on-chain state)
- **Active**: `startTime <= now < endTime` (no on-chain state)
- **Ended**: `now >= endTime` (no on-chain state)
- **Finalized**: `results[pollId].finalized == true` (on-chain state)

**Transition to Finalized:**
- Anyone calls `finalizePollOnL2(pollId)`
  - Contract: `contracts/contracts/l2/FinalizationL2.sol:L96-L183`
  - Requires: `!results[pollId].finalized`, poll exists, `now >= endTime`, `optionsLength > 0`
  - Computes: `totalVotes`, `winningOption`, `status` (Passed/FailedQuorum based on quorum math)
  - Stores: `results[pollId] = FinalizedResult(finalized=true, status, winningOption, totalVotes)`
  - Emits: `PollFinalized(pollId, status, winningOption, totalVotes)`

---

#### Workflow 6: CCIP / L1 Finalization Flow

1. After finalization, anyone calls `sendResultToL1(pollId)`
   - Contract: `contracts/contracts/l2/CcipEscrowSenderL2.sol:L292-L322`
   - Requires: `whenNotPaused`, escrow exists, `!escrows[pollId].sent`, `results[pollId].finalized == true`, `results[pollId].status != Unknown`
   - Computes: `resultHash = keccak256(abi.encode(groupId, pollId, status, winningOption, totalVotes))`
   - Builds CCIP message: `(groupId, pollId, status, resultHash)`
   - Pays fee from escrow, sets `escrows[pollId].sent = true`
   - Emits: `ResultSentToL1(pollId, messageId, feePaid)`

2. L1 receives via `_ccipReceive` on VeritasCcipReceiverRegistry
   - Contract: `contracts/contracts/l1/VeritasCcipReceiverRegistry.sol:L140-L213`
   - Validates: source chain selector, sender address
   - Records: `_records[key] = Record(recorded=true, groupId, pollId, status, resultHash, ...)`
   - Emits: `ResultRecorded(key, groupId, pollId, status, resultHash, inboundMessageId)`
   - Sends ACK back to L2

3. L2 receives ACK via `_ccipReceive` on VeritasCore (CcipEscrowSenderL2)
   - Contract: `contracts/contracts/l2/CcipEscrowSenderL2.sol:L420-L444`
   - Sets: `ackReceived[key] = true`
   - Emits: `L1AckReceived(key, groupId, pollId, inboundMessageId, ackMessageId)`

4. Owner claims platform fee (if status == Passed): `claimPlatformFee(pollId)`
   - Contract: `contracts/contracts/l2/CcipEscrowSenderL2.sol:L327-L349`
   - Requires: `onlyOwner`, `escrows[pollId].sent == true`, `results[pollId].finalized == true`, `results[pollId].status == Passed`, `ackReceived[key] == true`
   - Transfers: `reservedPlatform` to treasury

5. Creator withdraws leftover: `withdrawLeftover(pollId)`
   - Contract: `contracts/contracts/l2/CcipEscrowSenderL2.sol:L354-L376`
   - Requires: `msg.sender == escrows[pollId].creator`, `escrows[pollId].sent == true`
   - Transfers: `deposited - reservedPlatform` to creator

---

### A4) Invariants & Edge Cases

**Who can create polls:**
- Anyone (no membership check at creation)
- Note: Voting requires membership, but creation does not

**Time windows:**
- `startTime >= block.timestamp` (reverts `StartTimeInPast`)
- `endTime > startTime` (reverts `BadTimeRange`)
- Voting: `startTime <= now < endTime` (reverts `VotingPollNotStarted` or `VotingPollEnded`)
- Delegation: Same time window as voting
- Finalization: `now >= endTime` (reverts `FinalizationPollNotEnded`)

**Membership requirements:**
- Vote: `isMember(groupId, voter)` (reverts `VotingNotMember`)
  - Manual: `manualMembers[groupId][voter] == true` OR `voter == owner`
  - NFT: `nftRegistered[groupId][voter] == true` AND `IERC721(nft).balanceOf(voter) > 0` OR `voter == owner`
  - ClaimCode: `manualMembers[groupId][voter] == true` OR `voter == owner`
- Delegate: Both delegator and delegate must be members
- Owner is always a member (cannot be added/removed)

**Quorum logic:**
- If `quorumEnabled == false`: `quorumBps` must be `0` (reverts `QuorumDisabledButBpsNonZero`)
- If `quorumEnabled == true`: `quorumBps` must be `> 0` and `<= 10000` (reverts `QuorumEnabledButBpsZero` or `BadQuorumBps`)
- Snapshot: `eligibleCountSnapshot` captured at poll creation = `getEligibleCountForQuorum(groupId)` = `_groupMemberCount[groupId] + 1`
- Finalization: `requiredVotes = ceil(eligibleCountSnapshot * quorumBps / 10000)`, if `totalVotes < requiredVotes` then `status = FailedQuorum`

**Delegation constraints:**
- Cannot delegate to self (reverts `DelegationSelfNotAllowed`)
- Cannot delegate if already voted (reverts `DelegationDelegatorAlreadyVoted`)
- Cannot delegate if delegate already voted (reverts `DelegationDelegateAlreadyVoted`)
- Cannot delegate if delegate has delegated (reverts `DelegationDelegateHasDelegated`)
- Cannot delegate if delegator has incoming delegations (reverts `DelegationDelegatorHasIncoming`)
- Cannot revoke if delegate already voted (reverts `DelegationLockedAfterDelegateVoted`)

**Event discovery:**
- No on-chain mapping `groupId => pollIds[]`
- Frontend must index `PollCreated` events filtered by `groupId` (indexed topic)
- Event: `PollCreated(uint256 indexed pollId, uint256 indexed groupId, address indexed creator, ...)`
- Discovery method: `getLogs` with `args: { groupId: X }` filter

---

## Part B - Frontend Audit (Implementation Reality)

### B1) Frontend to Contract Mapping

| Page/Component | Contract Function/Event | Hook/Pattern | Evidence |
|----------------|-------------------------|--------------|----------|
| `CreateGroup.tsx` | `createGroup(name, description, membershipType)` | `useSimulateContract` + `useWriteContract.mutate` | `frontend/src/pages/CreateGroup.tsx:L86-L183` |
| `CreateGroup.tsx` | `setGroupNft(groupId, nft)` | `useWriteContract.mutate` (auto after create) | `frontend/src/pages/CreateGroup.tsx:L125-L165` |
| `CreateGroup.tsx` | `GroupCreated` event | `decodeEventLog` from receipt | `frontend/src/pages/CreateGroup.tsx:L42-L68` |
| `CreatePoll.tsx` | `approve(veritasCoreAddress, amount)` on LINK | `useSimulateContract` + `useWriteContract.mutate` | `frontend/src/pages/CreatePoll.tsx:L134-L154` |
| `CreatePoll.tsx` | `createPollWithLinkEscrow(...)` | `useSimulateContract` + `useWriteContract.mutate` | `frontend/src/pages/CreatePoll.tsx:L204-L315` |
| `PollDetails.tsx` | `getPoll(pollId)` | `useReadContracts` | `frontend/src/pages/PollDetails.tsx:L62-L87` |
| `PollDetails.tsx` | `results(pollId)` | `useReadContracts` | `frontend/src/pages/PollDetails.tsx:L62-L87` |
| `PollDetails.tsx` | `hasVoted(pollId, voter)` | `useReadContracts` | `frontend/src/pages/PollDetails.tsx:L62-L87` |
| `PollDetails.tsx` | `voteCounts(pollId, optionIndex)` | `useReadContracts` (array) | `frontend/src/pages/PollDetails.tsx:L97-L111` |
| `PollDetails.tsx` | `vote(pollId, optionIndex)` | `useWriteContract.mutate` | `frontend/src/pages/PollDetails.tsx:L160-L170` |
| `Delegation.tsx` | `delegateOf(pollId, delegator)` | `useReadContract` | `frontend/src/pages/Delegation.tsx:L43-L49` |
| `Delegation.tsx` | `delegatedToCount(pollId, delegate)` | `useReadContract` | `frontend/src/pages/Delegation.tsx:L51-L57` |
| `Delegation.tsx` | `hasVoted(pollId, voter)` | `useReadContract` | `frontend/src/pages/Delegation.tsx:L59-L65` |
| `Delegation.tsx` | `delegate(pollId, delegate)` | `useWriteContract.mutate` | `frontend/src/pages/Delegation.tsx:L135-L141` |
| `Delegation.tsx` | `revoke(pollId)` | `useWriteContract.mutate` | `frontend/src/pages/Delegation.tsx:L160-L166` |
| `Results.tsx` | `getPoll(pollId)`, `getPollMeta(pollId)`, `getOptionsLength(pollId)`, `results(pollId)` | `useReadContracts` | `frontend/src/pages/Results.tsx:L75-L107` |
| `Results.tsx` | `getOption(pollId, index)` | `useReadContracts` (array) | `frontend/src/pages/Results.tsx:L123-L137` |
| `Results.tsx` | `voteCounts(pollId, optionIndex)` | `useReadContracts` (array) | `frontend/src/pages/Results.tsx:L152-L166` |
| `Results.tsx` | `finalizePollOnL2(pollId)` | `useWriteContract.mutate` | `frontend/src/pages/Results.tsx:L252-L263` |
| `Results.tsx` | `sendResultToL1(pollId)` | `useWriteContract.mutate` | `frontend/src/pages/Results.tsx:L239-L250` |
| `GroupDetails.tsx` | `groups(groupId)` | `useReadContract` | `frontend/src/pages/GroupDetails.tsx:L111-L117` |
| `GroupDetails.tsx` | `_groupMemberCount(groupId)` | `useReadContract` (extra ABI) | `frontend/src/pages/GroupDetails.tsx:L125-L132` |
| `GroupDetails.tsx` | `groupNft(groupId)` | `useReadContract` (extra ABI) | `frontend/src/pages/GroupDetails.tsx:L133-L140` |
| `GroupDetails.tsx` | `PollCreated` events | `publicClient.getLogs` with pagination | `frontend/src/pages/GroupDetails.tsx:L154-L228` |
| `MyGroups.tsx` | `nextGroupId` | `useReadContract` | `frontend/src/pages/MyGroups.tsx:L74-L85` |
| `MyGroups.tsx` | `groups(groupId)` | `useReadContracts` (array 0..nextGroupId-1) | `frontend/src/pages/MyGroups.tsx:L103-L121` |
| `MyGroups.tsx` | `isMember(groupId, user)` | `useReadContracts` (array) | `frontend/src/pages/MyGroups.tsx:L151-L168` |
| `MemberList.tsx` | `setManualMember(groupId, member, true)` | `useWriteContract.mutate` | `frontend/src/pages/MemberList.tsx:L74-L91` |

---

### B2) Flow Coverage

| Contract Workflow Step | Implemented / Partial / Missing | Evidence |
|------------------------|----------------------------------|----------|
| Create Group | ✅ Implemented | `CreateGroup.tsx:L86-L183`, extracts `groupId` from `GroupCreated` event |
| Set Group NFT (after create) | ✅ Implemented | `CreateGroup.tsx:L145-L165` auto-calls after group creation |
| Join Manual Group | ✅ Implemented | `MemberList.tsx:L74-L91` calls `setManualMember` |
| Join NFT Group | ❌ Missing | No UI for `registerWithNft(groupId)` |
| Create Claim Code | ❌ Missing | No UI for `createClaimCode(groupId, codeHash)` |
| Claim with Code | ❌ Missing | No UI for `claimWithCode(groupId, codeHash)` |
| Create Poll | ✅ Implemented | `CreatePoll.tsx:L204-L315`, handles LINK approval + `createPollWithLinkEscrow` |
| Vote | ✅ Implemented | `PollDetails.tsx:L160-L170`, checks `hasVoted`, `computedStatus == Active` |
| Delegate | ✅ Implemented | `Delegation.tsx:L135-L141`, checks `hasVoted`, chain, membership (implicit via contract revert) |
| Revoke Delegation | ✅ Implemented | `Delegation.tsx:L160-L166` |
| Finalize Poll | ✅ Implemented | `Results.tsx:L252-L263` |
| Send to L1 | ✅ Implemented | `Results.tsx:L239-L250`, checks `canSendToL1` (ended + !finalized + quorumMet) |
| Discover Polls by Group | ⚠️ Partial | `GroupDetails.tsx:L154-L228` uses `getLogs` with pagination, but may fail on large ranges (100k limit) |
| Membership Check (before vote) | ⚠️ Partial | Frontend does not pre-check `isMember` before showing vote UI; relies on contract revert |

---

### B3) Risks

| Risk | Severity | Description | Evidence |
|------|----------|-------------|----------|
| Wrong Chain | P1 High | Some pages check `chainId` before writes, but not all | `CreatePoll.tsx:L265-L268`, `Delegation.tsx:L107-L110` have guards; `PollDetails.tsx` checks `isCorrectChain` but may not prevent vote if user switches mid-session |
| Missing Membership Checks | P1 High | Frontend does not pre-check `isMember` before allowing vote/delegate UI | `PollDetails.tsx:L150-L158` only checks `hasVoted` and `computedStatus`, not `isMember`; `Delegation.tsx` does not check membership before showing UI |
| Wrong Assumptions About State | P0 Blocker | `now` in `PollDetails.tsx` and `Results.tsx` is computed once via `useMemo(() => Math.floor(Date.now() / 1000), [])` and never updates | `PollDetails.tsx:L59`, `Results.tsx:L72` - causes stale status calculation, shows "Voting is closed" incorrectly |
| Logs Scalability | P1 High | `GroupDetails.tsx` uses pagination (99k blocks/chunk) but may still hit limits on very old networks | `GroupDetails.tsx:L169-L185` - if deployment block is very old and latest block is >100k away, pagination may still fail on some RPCs |
| Missing NFT Registration UI | P2 Medium | No way for users to `registerWithNft` in frontend | No page/component found |
| Missing Claim Code UI | P2 Medium | No way for owners to create or users to claim codes | No page/component found |
| Quorum Calculation Mismatch | P2 Medium | Frontend calculates quorum as `floor(eligible * quorumBps / 10000)` but contract uses `ceil` | `Results.tsx:L211` uses `Math.floor`, contract `FinalizationL2.sol:L83-L91` uses `ceil` formula `(prod + 9999) / 10000` |
| Missing Cache Invalidation | P2 Medium | Some pages invalidate queries after writes, but not all | `CreatePoll.tsx:L237-L240`, `Delegation.tsx:L86-L94`, `CreateGroup.tsx:L113-L116` invalidate; `MemberList.tsx` does not invalidate after `setManualMember` |
| Type Safety Issues | P3 Low | Heavy use of `as unknown as` type assertions | `PollDetails.tsx:L89-L91`, `GroupDetails.tsx:L116`, `MyGroups.tsx:L136` - may hide ABI mismatches |

---

## Part C - Alignment Report

### C1) Are we aligned?

**Verdict: Mostly aligned with critical gaps**

**Justification (3-6 examples):**

1. ✅ **Aligned**: Core workflows (create group, create poll, vote, delegate, finalize) are implemented and match contract logic
2. ❌ **Critical Gap**: `now` timestamp is stale in `PollDetails.tsx` and `Results.tsx` - causes incorrect status display ("Voting is closed" when poll is active)
3. ⚠️ **Partial Gap**: Membership checks are missing in frontend - relies on contract revert instead of pre-checking `isMember` before showing vote/delegate UI
4. ⚠️ **Partial Gap**: NFT and ClaimCode membership flows are not implemented in frontend - users cannot join NFT groups or claim codes
5. ⚠️ **Partial Gap**: `GroupDetails.tsx` poll discovery uses pagination correctly but may still fail on very large block ranges
6. ⚠️ **Minor Gap**: Quorum calculation uses `floor` in frontend but contract uses `ceil` - may show incorrect quorum status

---

### C2) Mismatch List (Prioritized)

#### Mismatch 1: Stale `now` timestamp causes incorrect poll status

- **Severity**: P0 Blocker
- **What is wrong**: `now` is computed once via `useMemo(() => Math.floor(Date.now() / 1000), [])` and never updates, causing `computedStatus` to be stale. User sees "Voting is closed" even when poll is active.
- **Evidence from contracts**: `contracts/contracts/l2/Voting.sol:L60-L62` checks `nowTs < startTime` and `nowTs >= endTime` using `block.timestamp` (always current)
- **Evidence from frontend**: `frontend/src/pages/PollDetails.tsx:L59`, `frontend/src/pages/Results.tsx:L72` - `now` is static
- **Minimal fix**: Use `useState` + `useEffect` with `setInterval` to update `now` every second, or compute `now` directly in render (with memoization to avoid excessive re-renders)

---

#### Mismatch 2: Missing membership pre-checks before vote/delegate UI

- **Severity**: P1 High
- **What is wrong**: Frontend does not call `isMember(groupId, user)` before showing vote/delegate buttons. User may see UI but transaction will revert with `VotingNotMember` or `DelegationNotMember`.
- **Evidence from contracts**: `contracts/contracts/l2/Voting.sol:L66` reverts `VotingNotMember(groupId, user)` if `!isMember`, `contracts/contracts/l2/Delegation.sol:L110-L111` requires both delegator and delegate to be members
- **Evidence from frontend**: `frontend/src/pages/PollDetails.tsx:L150-L158` only checks `hasVoted` and `computedStatus`, `frontend/src/pages/Delegation.tsx` does not check membership before showing delegate form
- **Minimal fix**: Add `useReadContract` calls to `isMember(groupId, user)` in `PollDetails.tsx` and `Delegation.tsx`, gate UI with `isMember` result

---

#### Mismatch 3: Poll discovery may fail on very large block ranges

- **Severity**: P1 High
- **What is wrong**: `GroupDetails.tsx` uses pagination (99k blocks/chunk) but if deployment block is very old and latest block is >100k away, some RPC providers may still reject chunks. Also, if RPC has stricter limits (e.g., Alchemy Free tier = 10 blocks), current pagination is insufficient.
- **Evidence from contracts**: No on-chain getter for `groupId => pollIds[]`, must use events (`contracts/contracts/l2/Polls.sol:L68-L79` - `PollCreated` event)
- **Evidence from frontend**: `frontend/src/pages/GroupDetails.tsx:L169-L185` uses `MAX_BLOCK_RANGE = 99_000n`, but error logs show Base Sepolia Public RPC has 100k limit and Alchemy Free tier has 10 block limit
- **Minimal fix**: Reduce `MAX_BLOCK_RANGE` to `9999n` (or make it configurable per RPC), add retry logic with smaller chunks on failure, or use a dedicated RPC provider with higher limits

---

#### Mismatch 4: NFT membership registration UI missing

- **Severity**: P2 Medium
- **What is wrong**: No UI for users to call `registerWithNft(groupId)`. NFT group members cannot join.
- **Evidence from contracts**: `contracts/contracts/l2/Membership.sol:L216-L239` - `registerWithNft(groupId)` is public, requires NFT balance
- **Evidence from frontend**: No component/page found that calls `registerWithNft`
- **Minimal fix**: Add button in `GroupDetails.tsx` (members tab) when `membershipType == 1` and user is not registered, call `registerWithNft(groupId)` via `useWriteContract`

---

#### Mismatch 5: ClaimCode membership UI missing

- **Severity**: P2 Medium
- **What is wrong**: No UI for owners to create claim codes or users to claim them.
- **Evidence from contracts**: `contracts/contracts/l2/Membership.sol:L261-L276` (create), `contracts/contracts/l2/Membership.sol:L278-L314` (claim)
- **Evidence from frontend**: No component/page found
- **Minimal fix**: Add UI in `GroupDetails.tsx` for owner to generate/display claim codes, add UI for users to enter code and claim

---

#### Mismatch 6: Quorum calculation uses floor instead of ceil

- **Severity**: P2 Medium
- **What is wrong**: Frontend calculates `quorumRequired = Math.floor((eligible * quorumBps) / 10000)` but contract uses `ceil` formula `(eligibleCount * quorumBps + 9999) / 10000`. May show "quorum not met" when it actually is met.
- **Evidence from contracts**: `contracts/contracts/l2/FinalizationL2.sol:L83-L91` - `_requiredVotesCeil` uses `(prod + 9999) / 10000` (ceil)
- **Evidence from frontend**: `frontend/src/pages/Results.tsx:L211` uses `Math.floor((eligible * quorumBps) / 10000)`
- **Minimal fix**: Change to `Math.ceil((eligible * quorumBps) / 10000)` or use exact contract formula `(eligible * quorumBps + 9999) / 10000`

---

#### Mismatch 7: Missing cache invalidation after member management

- **Severity**: P3 Low
- **What is wrong**: `MemberList.tsx` does not invalidate queries after `setManualMember`, so member count and membership status may be stale.
- **Evidence from contracts**: `contracts/contracts/l2/Membership.sol:L184-L190` emits `GroupMemberCountChanged` and updates `_groupMemberCount`
- **Evidence from frontend**: `frontend/src/components/MemberList.tsx:L74-L91` calls `setManualMember` but no `queryClient.invalidateQueries()` after success
- **Minimal fix**: Add `useQueryClient` and `useEffect` to invalidate queries after `useWaitForTransactionReceipt` success

---

### C3) Recommended Next Steps (Step-by-Step, Minimal Risk)

1. **Fix stale `now` timestamp (P0)**
   - Files: `frontend/src/pages/PollDetails.tsx`, `frontend/src/pages/Results.tsx`
   - Change: Replace `useMemo(() => Math.floor(Date.now() / 1000), [])` with `useState` + `useEffect` + `setInterval` to update every second
   - Risk: Low (UI-only change)

2. **Add membership pre-checks (P1)**
   - Files: `frontend/src/pages/PollDetails.tsx`, `frontend/src/pages/Delegation.tsx`
   - Change: Add `useReadContract` calls to `isMember(groupId, user)`, gate vote/delegate UI with `isMember` result
   - Risk: Low (read-only addition)

3. **Reduce pagination chunk size and add error handling (P1)**
   - Files: `frontend/src/pages/GroupDetails.tsx`
   - Change: Reduce `MAX_BLOCK_RANGE` to `9999n`, add try-catch per chunk with retry logic, or detect RPC limits and adjust chunk size dynamically
   - Risk: Medium (may require RPC detection logic)

4. **Add NFT registration UI (P2)**
   - Files: `frontend/src/pages/GroupDetails.tsx` (members tab)
   - Change: Add button when `membershipType == 1` and user is not registered, call `registerWithNft(groupId)` via `useWriteContract`
   - Risk: Low (new feature)

5. **Add ClaimCode UI (P2)**
   - Files: `frontend/src/pages/GroupDetails.tsx` (new tab or section)
   - Change: Owner UI to generate/display codes (hash input), user UI to enter code and call `claimWithCode(groupId, codeHash)`
   - Risk: Medium (requires code hashing logic - frontend must hash user input to `bytes32`)

6. **Fix quorum calculation (P2)**
   - Files: `frontend/src/pages/Results.tsx`
   - Change: Replace `Math.floor` with `Math.ceil` or use contract formula `(eligible * quorumBps + 9999) / 10000`
   - Risk: Low (calculation fix)

7. **Add cache invalidation for member management (P3)**
   - Files: `frontend/src/components/MemberList.tsx`
   - Change: Add `useQueryClient` and `useEffect` to invalidate queries after `setManualMember` success
   - Risk: Low (cache management)

8. **Add chain ID guards to all write operations (P1)**
   - Files: `frontend/src/pages/PollDetails.tsx` (vote), `frontend/src/components/MemberList.tsx` (setManualMember)
   - Change: Add `useConnection` + `useSwitchChain` checks before `mutate` calls (similar to `CreatePoll.tsx:L265-L268`)
   - Risk: Low (defensive guards)

9. **Verify type assertions match ABI (P3)**
   - Files: All pages using `as unknown as`
   - Change: Validate tuple structures match ABI exactly, add type guards instead of assertions where possible
   - Risk: Low (type safety improvement)

10. **Test end-to-end flow (P1)**
    - Files: N/A (testing)
    - Change: Run smoke test: Create Group → Join (Manual) → Create Poll → Vote → Finalize → Send to L1
    - Risk: Low (validation)

---

**End of Report**

