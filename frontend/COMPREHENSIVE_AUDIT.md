# Comprehensive Web3 dApp Audit Report

## Executive Summary

**Verdict: Mostly Aligned with Critical Gaps**

The frontend implementation aligns with core contract workflows (create group, create poll, vote, delegate, finalize) but has **critical gaps** that cause incorrect UI behavior and missing functionality:

1. ✅ **Fixed**: Stale `now` timestamp (P0) - resolved via `useNowSeconds()` hook
2. ✅ **Fixed**: Quorum calculation mismatch (P2) - resolved via `requiredVotesCeil()` matching contract `ceil` formula
3. ✅ **Fixed**: Missing membership pre-check in `PollDetails.tsx` (P1) - resolved via `isMember` read before vote UI
4. ❌ **Missing**: NFT registration UI (`registerWithNft`) - no frontend implementation
5. ❌ **Missing**: ClaimCode UI (`createClaimCode`, `claimWithCode`) - no frontend implementation
6. ⚠️ **Partial**: Poll discovery via events uses pagination but may fail on very large block ranges
7. ⚠️ **Partial**: Missing cache invalidation after `setManualMember` in `MemberList.tsx`
8. ⚠️ **Partial**: Missing chain ID guards in some write operations (`MemberList.tsx`, vote in `PollDetails.tsx`)

**Overall Alignment Score: 75/100**

---

## Contract Truth Table

### Workflow 1: Create Group

| Step | Contract | Function | Caller | Requirements | Reverts If | Events |
|------|----------|----------|--------|--------------|------------|--------|
| 1. Create | `VeritasCore` | `createGroup(name, description, membershipType)` | Anyone | `whenNotPaused`, `bytes(name).length > 0` | `EmptyName()` | `GroupCreated(groupId, owner, membershipType, name)` |
| 2. Set NFT (if type=1) | `VeritasCore` | `setGroupNft(groupId, nft)` | Owner | `onlyGroupOwner`, `membershipType == NFT`, `nft != address(0)` | `MembershipTypeMismatch`, `ZeroAddress` | `GroupNftSet(groupId, nft)` |

**Constraints:**
- `membershipType` locked at creation (0=Manual, 1=NFT, 2=ClaimCode)
- Owner cannot be added/removed as member
- NFT address must be set after group creation if `membershipType == 1`

**File References:**
- `contracts/contracts/l2/Groups.sol:L52-L73` (createGroup)
- `contracts/contracts/l2/Membership.sol:L199-L212` (setGroupNft)
- `contracts/contracts/l2/VeritasCore.sol:L46-L52` (wrapper)

---

### Workflow 2: Join Group / Membership Verification

| Membership Type | Contract | Function | Caller | Requirements | Reverts If | Events |
|----------------|----------|----------|--------|--------------|------------|--------|
| **Manual (0)** | `VeritasCore` | `setManualMember(groupId, member, true)` | Owner | `onlyGroupOwner`, `member != owner`, `membershipType != NFT` | `NotGroupOwner`, `OwnerMembershipImmutable`, `UnsupportedMembershipType` | `ManualMemberSet`, `GroupMemberCountChanged` |
| **NFT (1)** | `VeritasCore` | `registerWithNft(groupId)` | Anyone | `membershipType == NFT`, `!nftRegistered[groupId][user]`, `IERC721(nft).balanceOf(user) > 0`, `user != owner` | `MembershipTypeMismatch`, `NftAlreadyRegistered`, `NftBalanceRequired`, `OwnerMembershipImmutable` | `NftMemberRegistered`, `GroupMemberCountChanged` |
| **ClaimCode (2)** | `VeritasCore` | `createClaimCode(groupId, codeHash)` | Owner | `onlyGroupOwner`, `membershipType == ClaimCode`, `codeHash != bytes32(0)`, `claimCodeGroup[codeHash] == 0` | `NotGroupOwner`, `MembershipTypeMismatch`, `ZeroCodeHash`, `ClaimCodeAlreadyExists` | `ClaimCodeCreated` |
| **ClaimCode (2)** | `VeritasCore` | `claimWithCode(groupId, codeHash)` | Anyone | Valid code, `!claimCodeUsed[codeHash]`, `user != owner` | `ClaimCodeNotFound`, `ClaimCodeAlreadyUsed`, `ClaimCodeWrongGroup`, `OwnerMembershipImmutable` | `ClaimCodeClaimed`, `GroupMemberCountChanged` |

**Membership Check (`isMember`):**
- **Manual**: `manualMembers[groupId][user] == true` OR `user == owner`
- **NFT**: `nftRegistered[groupId][user] == true` AND `IERC721(nft).balanceOf(user) > 0` OR `user == owner`
- **ClaimCode**: `manualMembers[groupId][user] == true` OR `user == owner`

**File References:**
- `contracts/contracts/l2/Membership.sol:L120-L145` (isMember)
- `contracts/contracts/l2/Membership.sol:L163-L193` (setManualMember)
- `contracts/contracts/l2/Membership.sol:L216-L239` (registerWithNft)
- `contracts/contracts/l2/Membership.sol:L261-L276` (createClaimCode)
- `contracts/contracts/l2/Membership.sol:L278-L314` (claimWithCode)

---

### Workflow 3: Create Poll

| Step | Contract | Function | Caller | Requirements | Reverts If | Events |
|------|----------|----------|--------|--------------|------------|--------|
| 1. Approve LINK | ERC20 | `approve(veritasCoreAddress, amount)` | Creator | LINK balance >= amount | Standard ERC20 errors | Standard ERC20 events |
| 2. Create Poll | `VeritasCore` | `createPollWithLinkEscrow(groupId, title, cid, options[], startTime, endTime, quorumEnabled, quorumBps)` | Anyone | `whenNotPaused`, `bytes(title).length > 0`, `bytes(cid).length > 0`, `options.length >= 2`, `endTime > startTime`, `startTime >= block.timestamp`, `quorumBps <= 10000`, if `quorumEnabled` then `quorumBps > 0` else `quorumBps == 0` | `EmptyTitle`, `EmptyCid`, `BadTimeRange`, `StartTimeInPast`, `TooFewOptions`, `EmptyOption`, `QuorumEnabledButBpsZero`, `QuorumDisabledButBpsNonZero` | `PollCreated(pollId, groupId, creator, ...)`, `EscrowLocked(pollId, groupId, creator, ...)`, `OpsFeeCharged(pollId, payer, treasury, opsFee)` |

**Constraints:**
- No membership check at creation (anyone can create)
- `startTime` must be `>= block.timestamp` (reverts `StartTimeInPast`)
- `eligibleCountSnapshot` captured at creation = `getEligibleCountForQuorum(groupId)` = `_groupMemberCount[groupId] + 1`
- LINK escrow: `totalRequired = maxFee + platformFee + opsFee`
- `opsFee` charged immediately to treasury

**File References:**
- `contracts/contracts/l2/CcipEscrowSenderL2.sol:L214-L268` (createPollWithLinkEscrow)
- `contracts/contracts/l2/Polls.sol:L185-L255` (_createPoll)

---

### Workflow 4: Vote

| Step | Contract | Function | Caller | Requirements | Reverts If | Events |
|------|----------|----------|--------|--------------|------------|--------|
| Vote | `VeritasCore` | `vote(pollId, optionIndex)` | Member | `whenNotPaused`, `!hasVoted[pollId][msg.sender]`, poll exists, `startTime <= now < endTime`, `optionIndex < optionsLength`, `isMember(groupId, msg.sender)`, `delegateOf[pollId][msg.sender] == address(0)` | `AlreadyVoted`, `VotingPollDoesNotExist`, `VotingPollNotStarted`, `VotingPollEnded`, `VotingBadOption`, `VotingNotMember`, `VotingDelegated` | `VoteCast(pollId, voter, optionIndex)`, `VoteCastWeighted(pollId, voter, optionIndex, weight)` |

**Constraints:**
- Weight = `1 + delegatedToCount` (delegation weight included)
- Cannot vote if already delegated (`delegateOf[pollId][msg.sender] != address(0)`)
- Time window: `startTime <= block.timestamp < endTime`
- Membership required: `isMember(groupId, voter)` must be `true`

**File References:**
- `contracts/contracts/l2/Voting.sol:L50-L84` (vote)
- `contracts/contracts/l2/VeritasCore.sol:L54-L60` (wrapper)

---

### Workflow 5: Delegate

| Step | Contract | Function | Caller | Requirements | Reverts If | Events |
|------|----------|----------|--------|--------------|------------|--------|
| Delegate | `VeritasCore` | `delegate(pollId, delegate)` | Member | `whenNotPaused`, `delegate != address(0)`, `delegate != msg.sender`, poll exists, `startTime <= now < endTime`, `isMember(groupId, delegator)`, `isMember(groupId, delegate)`, `!hasVoted[pollId][delegator]`, `!hasVoted[pollId][delegate]`, `delegateOf[pollId][delegate] == address(0)`, `_delegatorsTo[pollId][delegator].length == 0` | `DelegationZeroAddress`, `DelegationSelfNotAllowed`, `DelegationPollDoesNotExist`, `DelegationPollNotStarted`, `DelegationPollEnded`, `DelegationNotMember`, `DelegationDelegatorAlreadyVoted`, `DelegationDelegateAlreadyVoted`, `DelegationDelegateHasDelegated`, `DelegationDelegatorHasIncoming` | `Delegated(pollId, groupId, delegator, delegate)` |
| Revoke | `VeritasCore` | `revoke(pollId)` | Delegator | `whenNotPaused`, poll exists, `startTime <= now < endTime`, `delegateOf[pollId][msg.sender] != address(0)`, `!hasVoted[pollId][msg.sender]`, `!hasVoted[pollId][delegate]` | `DelegationPollDoesNotExist`, `DelegationPollNotStarted`, `DelegationPollEnded`, `DelegationNotDelegating`, `DelegationDelegatorAlreadyVoted`, `DelegationLockedAfterDelegateVoted` | `DelegationRevoked(pollId, groupId, delegator)` |

**Constraints:**
- Cannot delegate to self
- Cannot delegate if already voted
- Cannot delegate if delegate already voted
- Cannot delegate if delegate has delegated
- Cannot delegate if delegator has incoming delegations
- Cannot revoke if delegate already voted (locked)

**File References:**
- `contracts/contracts/l2/Delegation.sol:L99-L143` (delegate)
- `contracts/contracts/l2/Delegation.sol:L145-L168` (revoke)
- `contracts/contracts/l2/VeritasCore.sol:L62-L68` (wrapper)

---

### Workflow 6: Finalize Poll

| Step | Contract | Function | Caller | Requirements | Reverts If | Events |
|------|----------|----------|--------|--------------|------------|--------|
| Finalize | `VeritasCore` | `finalizePollOnL2(pollId)` | Anyone | `!results[pollId].finalized`, poll exists, `now >= endTime`, `optionsLength > 0` | `FinalizationAlreadyFinalized`, `FinalizationPollDoesNotExist`, `FinalizationPollNotEnded`, `FinalizationZeroOptions` | `PollFinalized(pollId, status, winningOption, totalVotes)` |

**Quorum Logic:**
- If `quorumEnabled == false`: `status = Passed` (if `totalVotes > 0`) or `FailedQuorum` (if `totalVotes == 0`)
- If `quorumEnabled == true`: `requiredVotes = ceil(eligibleCountSnapshot * quorumBps / 10000)`, if `totalVotes < requiredVotes` then `status = FailedQuorum` else `status = Passed`
- Formula: `(eligibleCountSnapshot * quorumBps + 9999) / 10000` (ceil division)

**File References:**
- `contracts/contracts/l2/FinalizationL2.sol:L96-L183` (finalizePollOnL2)
- `contracts/contracts/l2/FinalizationL2.sol:L83-L91` (_requiredVotesCeil)

---

### Workflow 7: Send Result to L1 (CCIP)

| Step | Contract | Function | Caller | Requirements | Reverts If | Events |
|------|----------|----------|--------|--------------|------------|--------|
| Send to L1 | `VeritasCore` | `sendResultToL1(pollId)` | Anyone | `whenNotPaused`, escrow exists, `!escrows[pollId].sent`, `results[pollId].finalized == true`, `results[pollId].status != Unknown`, `fee <= escrows[pollId].deposited` | `MissingEscrow`, `AlreadySent`, `NotFinalized`, `NotReadyStatus`, `InsufficientEscrow` | `ResultSentToL1(pollId, messageId, feePaid)` |

**Constraints:**
- Must be finalized before sending
- Escrow must exist and not already sent
- Fee deducted from escrow
- Platform fee released only if `status == Passed`

**File References:**
- `contracts/contracts/l2/CcipEscrowSenderL2.sol:L292-L322` (sendResultToL1)

---

### Workflow 8: Poll Discovery by Group

**On-Chain Reality:**
- No mapping `groupId => pollIds[]`
- No getter function to retrieve poll IDs by group
- Only event-based discovery: `PollCreated(uint256 indexed pollId, uint256 indexed groupId, address indexed creator, ...)`

**Discovery Method:**
- Frontend must use `getLogs` with filter: `args: { groupId: X }`
- Event indexed topics: `pollId`, `groupId`, `creator`

**File References:**
- `contracts/contracts/l2/Polls.sol:L68-L79` (PollCreated event)

---

## Frontend Reality Table

### Page: CreateGroup.tsx

| UI Action | Contract Call | Hook Pattern | Status | Evidence |
|-----------|--------------|--------------|--------|----------|
| Create Group | `createGroup(name, description, membershipType)` | `useSimulateContract` + `useWriteContract.mutate` | ✅ Implemented | `frontend/src/pages/CreateGroup.tsx:L86-L183` |
| Set NFT (auto) | `setGroupNft(groupId, nft)` | `useWriteContract.mutate` (auto after create) | ✅ Implemented | `frontend/src/pages/CreateGroup.tsx:L145-L165` |
| Extract groupId | `GroupCreated` event | `decodeEventLog` from receipt | ✅ Implemented | `frontend/src/pages/CreateGroup.tsx:L42-L68` |
| Cache invalidation | N/A | `queryClient.invalidateQueries()` after success | ✅ Implemented | `frontend/src/pages/CreateGroup.tsx:L113-L116` |

**Missing:**
- None

---

### Page: CreatePoll.tsx

| UI Action | Contract Call | Hook Pattern | Status | Evidence |
|-----------|--------------|--------------|--------|----------|
| Approve LINK | `approve(veritasCoreAddress, amount)` | `useSimulateContract` + `useWriteContract.mutate` | ✅ Implemented | `frontend/src/pages/CreatePoll.tsx:L134-L154` |
| Create Poll | `createPollWithLinkEscrow(...)` | `useSimulateContract` + `useWriteContract.mutate` | ✅ Implemented | `frontend/src/pages/CreatePoll.tsx:L204-L315` |
| Chain guard | N/A | `useConnection` + `useSwitchChain` before mutate | ✅ Implemented | `frontend/src/pages/CreatePoll.tsx:L265-L268, L287-L290` |
| Start time buffer | N/A | `START_TIME_BUFFER_SECONDS = 120` | ✅ Implemented | `frontend/src/pages/CreatePoll.tsx:L62, L182` |
| Cache invalidation | N/A | `queryClient.invalidateQueries()` after success | ✅ Implemented | `frontend/src/pages/CreatePoll.tsx:L237-L240` |

**Missing:**
- None

---

### Page: PollDetails.tsx

| UI Action | Contract Call | Hook Pattern | Status | Evidence |
|-----------|--------------|--------------|--------|----------|
| Read poll | `getPoll(pollId)` | `useReadContracts` | ✅ Implemented | `frontend/src/pages/PollDetails.tsx:L77-L87` |
| Read results | `results(pollId)` | `useReadContracts` | ✅ Implemented | `frontend/src/pages/PollDetails.tsx:L77-L87` |
| Read hasVoted | `hasVoted(pollId, voter)` | `useReadContracts` | ✅ Implemented | `frontend/src/pages/PollDetails.tsx:L77-L87` |
| Read voteCounts | `voteCounts(pollId, optionIndex)` | `useReadContracts` (array) | ✅ Implemented | `frontend/src/pages/PollDetails.tsx:L112-L126` |
| Read isMember | `isMember(groupId, user)` | `useReadContract` | ✅ Implemented | `frontend/src/pages/PollDetails.tsx:L112-L120` |
| Vote | `vote(pollId, optionIndex)` | `useWriteContract.mutate` | ✅ Implemented | `frontend/src/pages/PollDetails.tsx:L178-L184` |
| Time status | N/A | `useNowSeconds()` hook (updates every second) | ✅ Fixed | `frontend/src/pages/PollDetails.tsx:L40-L53, L74` |

**Missing:**
- Chain ID guard before vote (relies on `isCorrectChain` check but may not prevent vote if user switches mid-session)

---

### Page: Delegation.tsx

| UI Action | Contract Call | Hook Pattern | Status | Evidence |
|-----------|--------------|--------------|--------|----------|
| Read delegateOf | `delegateOf(pollId, delegator)` | `useReadContract` | ✅ Implemented | `frontend/src/pages/Delegation.tsx:L43-L49` |
| Read delegatedToCount | `delegatedToCount(pollId, delegate)` | `useReadContract` | ✅ Implemented | `frontend/src/pages/Delegation.tsx:L51-L57` |
| Read hasVoted | `hasVoted(pollId, voter)` | `useReadContract` | ✅ Implemented | `frontend/src/pages/Delegation.tsx:L59-L65` |
| Delegate | `delegate(pollId, delegate)` | `useWriteContract.mutate` | ✅ Implemented | `frontend/src/pages/Delegation.tsx:L135-L141` |
| Revoke | `revoke(pollId)` | `useWriteContract.mutate` | ✅ Implemented | `frontend/src/pages/Delegation.tsx:L160-L166` |
| Chain guard | N/A | `useConnection` + `useSwitchChain` before mutate | ✅ Implemented | `frontend/src/pages/Delegation.tsx:L107-L110, L146-L149` |
| Cache invalidation | N/A | `queryClient.invalidateQueries()` after success | ✅ Implemented | `frontend/src/pages/Delegation.tsx:L86-L94` |

**Missing:**
- Membership pre-check before showing delegate UI (relies on contract revert)

---

### Page: Results.tsx

| UI Action | Contract Call | Hook Pattern | Status | Evidence |
|-----------|--------------|--------------|--------|----------|
| Read poll | `getPoll(pollId)`, `getPollMeta(pollId)`, `getOptionsLength(pollId)`, `results(pollId)` | `useReadContracts` | ✅ Implemented | `frontend/src/pages/Results.tsx:L75-L107` |
| Read options | `getOption(pollId, index)` | `useReadContracts` (array) | ✅ Implemented | `frontend/src/pages/Results.tsx:L123-L137` |
| Read voteCounts | `voteCounts(pollId, optionIndex)` | `useReadContracts` (array) | ✅ Implemented | `frontend/src/pages/Results.tsx:L152-L166` |
| Finalize | `finalizePollOnL2(pollId)` | `useWriteContract.mutate` | ✅ Implemented | `frontend/src/pages/Results.tsx:L256-L263` |
| Send to L1 | `sendResultToL1(pollId)` | `useWriteContract.mutate` | ✅ Implemented | `frontend/src/pages/Results.tsx:L243-L250` |
| Time status | N/A | `useNowSeconds()` hook (updates every second) | ✅ Fixed | `frontend/src/pages/Results.tsx:L55-L68, L78` |
| Quorum calculation | N/A | `requiredVotesCeil()` matching contract ceil formula | ✅ Fixed | `frontend/src/pages/Results.tsx:L57-L60, L224-L226` |

**Missing:**
- None

---

### Page: GroupDetails.tsx

| UI Action | Contract Call | Hook Pattern | Status | Evidence |
|-----------|--------------|--------------|--------|----------|
| Read group | `groups(groupId)` | `useReadContract` | ✅ Implemented | `frontend/src/pages/GroupDetails.tsx:L111-L117` |
| Read memberCount | `_groupMemberCount(groupId)` | `useReadContract` (extra ABI) | ✅ Implemented | `frontend/src/pages/GroupDetails.tsx:L125-L132` |
| Read groupNft | `groupNft(groupId)` | `useReadContract` (extra ABI) | ✅ Implemented | `frontend/src/pages/GroupDetails.tsx:L133-L140` |
| Discover polls | `PollCreated` events | `publicClient.getLogs` with pagination | ⚠️ Partial | `frontend/src/pages/GroupDetails.tsx:L154-L228` |

**Missing:**
- UI for `registerWithNft(groupId)` (NFT membership)
- UI for `createClaimCode(groupId, codeHash)` (ClaimCode creation)
- UI for `claimWithCode(groupId, codeHash)` (ClaimCode claiming)

**Issues:**
- Pagination uses `MAX_BLOCK_RANGE = 99_000n` which may still fail on some RPCs (Alchemy Free tier = 10 blocks)

---

### Component: MemberList.tsx

| UI Action | Contract Call | Hook Pattern | Status | Evidence |
|-----------|--------------|--------------|--------|----------|
| Add member | `setManualMember(groupId, member, true)` | `useWriteContract.mutate` | ✅ Implemented | `frontend/src/components/MemberList.tsx:L74-L91` |

**Missing:**
- Chain ID guard before `setManualMember` (only checks `isCorrectChain` but doesn't prevent write)
- Cache invalidation after `setManualMember` success

---

### Page: MyGroups.tsx

| UI Action | Contract Call | Hook Pattern | Status | Evidence |
|-----------|--------------|--------------|--------|----------|
| Read nextGroupId | `nextGroupId` | `useReadContract` | ✅ Implemented | `frontend/src/pages/MyGroups.tsx:L74-L85` |
| Read groups | `groups(groupId)` | `useReadContracts` (array 0..nextGroupId-1) | ✅ Implemented | `frontend/src/pages/MyGroups.tsx:L103-L121` |
| Read isMember | `isMember(groupId, user)` | `useReadContracts` (array) | ✅ Implemented | `frontend/src/pages/MyGroups.tsx:L151-L168` |

**Missing:**
- None

---

## Prioritized Mismatch List

### P0 - Critical Blockers

#### Mismatch P0-1: Missing NFT Registration UI
- **Severity**: P0 Blocker (for NFT groups)
- **What is wrong**: No UI for users to call `registerWithNft(groupId)`. NFT group members cannot join the group.
- **Contract Evidence**: `contracts/contracts/l2/Membership.sol:L216-L239` - `registerWithNft(groupId)` is public
- **Frontend Evidence**: No component/page found that calls `registerWithNft`
- **Minimal Fix**: Add button in `GroupDetails.tsx` (members tab) when `membershipType == 1` and user is not registered, call `registerWithNft(groupId)` via `useWriteContract`
- **Files to modify**: `frontend/src/pages/GroupDetails.tsx`

---

#### Mismatch P0-2: Missing ClaimCode UI
- **Severity**: P0 Blocker (for ClaimCode groups)
- **What is wrong**: No UI for owners to create claim codes or users to claim them. ClaimCode groups are unusable.
- **Contract Evidence**: 
  - `contracts/contracts/l2/Membership.sol:L261-L276` (createClaimCode)
  - `contracts/contracts/l2/Membership.sol:L278-L314` (claimWithCode)
- **Frontend Evidence**: No component/page found
- **Minimal Fix**: 
  - Owner UI: Add section in `GroupDetails.tsx` to generate/display claim codes (hash input field)
  - User UI: Add form to enter code and call `claimWithCode(groupId, codeHash)` via `useWriteContract`
  - Note: Frontend must hash user input to `bytes32` using `keccak256` (viem)
- **Files to modify**: `frontend/src/pages/GroupDetails.tsx`

---

### P1 - High Priority

#### Mismatch P1-1: Poll Discovery May Fail on Large Block Ranges
- **Severity**: P1 High
- **What is wrong**: `GroupDetails.tsx` uses pagination (99k blocks/chunk) but if deployment block is very old and latest block is >100k away, some RPC providers may still reject chunks. Alchemy Free tier has 10 block limit.
- **Contract Evidence**: No on-chain getter for `groupId => pollIds[]`, must use events (`contracts/contracts/l2/Polls.sol:L68-L79`)
- **Frontend Evidence**: `frontend/src/pages/GroupDetails.tsx:L169-L185` uses `MAX_BLOCK_RANGE = 99_000n`
- **Minimal Fix**: 
  - Reduce `MAX_BLOCK_RANGE` to `9999n` (or make it configurable per RPC)
  - Add try-catch per chunk with retry logic using smaller chunks on failure
  - Or detect RPC limits and adjust chunk size dynamically
- **Files to modify**: `frontend/src/pages/GroupDetails.tsx`

---

#### Mismatch P1-2: Missing Chain ID Guard in MemberList.tsx
- **Severity**: P1 High
- **What is wrong**: `MemberList.tsx` checks `isCorrectChain` but doesn't prevent `setManualMember` write if user switches network mid-session.
- **Contract Evidence**: Write operations require correct chain (implicit via RPC)
- **Frontend Evidence**: `frontend/src/components/MemberList.tsx:L46-L92` - no chain guard before `write.mutate`
- **Minimal Fix**: Add `useConnection` + `useSwitchChain` checks before `write.mutate` (similar to `CreatePoll.tsx:L265-L268`)
- **Files to modify**: `frontend/src/components/MemberList.tsx`

---

#### Mismatch P1-3: Missing Chain ID Guard in PollDetails.tsx Vote
- **Severity**: P1 High
- **What is wrong**: `PollDetails.tsx` checks `isCorrectChain` but doesn't explicitly prevent vote if user switches network mid-session.
- **Contract Evidence**: Write operations require correct chain
- **Frontend Evidence**: `frontend/src/pages/PollDetails.tsx:L175-L185` - `handleVote` doesn't check chain before `write.mutate`
- **Minimal Fix**: Add `useConnection` + `useSwitchChain` checks in `handleVote` before `write.mutate` (similar to `CreatePoll.tsx:L265-L268`)
- **Files to modify**: `frontend/src/pages/PollDetails.tsx`

---

#### Mismatch P1-4: Missing Membership Pre-Check in Delegation.tsx
- **Severity**: P1 High
- **What is wrong**: `Delegation.tsx` does not pre-check `isMember` before showing delegate UI. User may see UI but transaction will revert with `DelegationNotMember`.
- **Contract Evidence**: `contracts/contracts/l2/Delegation.sol:L110-L111` requires both delegator and delegate to be members
- **Frontend Evidence**: `frontend/src/pages/Delegation.tsx` does not check membership before showing delegate form
- **Minimal Fix**: Add `useReadContract` calls to `isMember(groupId, user)` for both delegator and delegate, gate UI with `isMember` results
- **Files to modify**: `frontend/src/pages/Delegation.tsx`

---

### P2 - Medium Priority

#### Mismatch P2-1: Missing Cache Invalidation in MemberList.tsx
- **Severity**: P2 Medium
- **What is wrong**: `MemberList.tsx` does not invalidate queries after `setManualMember`, so member count and membership status may be stale.
- **Contract Evidence**: `contracts/contracts/l2/Membership.sol:L184-L190` emits `GroupMemberCountChanged` and updates `_groupMemberCount`
- **Frontend Evidence**: `frontend/src/components/MemberList.tsx:L74-L91` calls `setManualMember` but no `queryClient.invalidateQueries()` after success
- **Minimal Fix**: Add `useQueryClient` and `useEffect` to invalidate queries after `useWaitForTransactionReceipt` success
- **Files to modify**: `frontend/src/components/MemberList.tsx`

---

#### Mismatch P2-2: Type Safety Issues (as unknown as)
- **Severity**: P2 Medium
- **What is wrong**: Heavy use of `as unknown as` type assertions may hide ABI mismatches.
- **Contract Evidence**: N/A (type safety issue)
- **Frontend Evidence**: 
  - `frontend/src/pages/PollDetails.tsx:L89-L91`
  - `frontend/src/pages/GroupDetails.tsx:L116`
  - `frontend/src/pages/MyGroups.tsx:L136`
- **Minimal Fix**: Validate tuple structures match ABI exactly, add type guards instead of assertions where possible
- **Files to modify**: Multiple files (low priority, can be done incrementally)

---

## Summary of Fixes Applied

### ✅ Fixed Issues

1. **Stale `now` timestamp (P0)** - Fixed via `useNowSeconds()` hook in `PollDetails.tsx` and `Results.tsx`
2. **Quorum calculation mismatch (P2)** - Fixed via `requiredVotesCeil()` matching contract `ceil` formula in `Results.tsx`
3. **Missing membership pre-check in PollDetails.tsx (P1)** - Fixed via `isMember` read before vote UI

### ❌ Remaining Issues

1. **Missing NFT registration UI (P0)** - No implementation
2. **Missing ClaimCode UI (P0)** - No implementation
3. **Poll discovery scalability (P1)** - Pagination may fail on very large ranges
4. **Missing chain guards (P1)** - `MemberList.tsx` and vote in `PollDetails.tsx`
5. **Missing membership pre-check in Delegation.tsx (P1)** - No implementation
6. **Missing cache invalidation in MemberList.tsx (P2)** - No implementation
7. **Type safety issues (P2)** - Multiple files using `as unknown as`

---

**End of Report**

