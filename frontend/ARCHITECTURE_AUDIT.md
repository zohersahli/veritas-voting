# Veritas Frontend-to-Contract Architecture Audit

**Date:** 2025-01-XX  
**Scope:** End-to-end workflow analysis comparing smart contracts (source of truth) vs React frontend implementation  
**Methodology:** Contract-first analysis, then frontend audit against contract spec

---

## Part A - Smart Contract Understanding (Source of Truth)

### A1) Executive Summary

Veritas is a cross-chain voting platform deployed on Base Sepolia (L2) with finalization on Ethereum Sepolia (L1). The system uses a modular contract architecture where `VeritasCore` orchestrates six modules: Groups (membership types), Membership (Manual/NFT/ClaimCode), Polls (metadata + quorum snapshots), Voting (with delegation weights), Delegation (poll-level), and FinalizationL2 (L2 result computation). Poll creation requires LINK escrow for CCIP fees. Results are sent to L1 via Chainlink CCIP, with ACK confirmation back to L2. The system enforces strict membership checks, time windows, and delegation constraints at every step.

**Key invariants:**
- Only group owners can create polls (enforced on-chain)
- Membership is checked at vote/delegate time (not cached)
- Poll status transitions: Upcoming → Active → Ended → Finalized (computed client-side)
- Delegation locks after delegate votes
- Finalization requires `endTime` passed and computes quorum from snapshot

---

### A2) Contract API Table

| Feature | Contract | Function | Caller | Permissions | Event(s) |
|---------|----------|----------|--------|-------------|----------|
| **Create Group** | `Groups` | `createGroup(name, description, membershipType)` | Anyone | None (whenNotPaused) | `GroupCreated(groupId, owner, membershipType, name)` |
| **Set Manual Member** | `Membership` | `setManualMember(groupId, member, isMember)` | Group Owner | `onlyGroupOwner` | `ManualMemberSet(groupId, member, isMember)` |
| **Set NFT Contract** | `Membership` | `setGroupNft(groupId, nft)` | Group Owner | `onlyGroupOwner` + NFT mode | `GroupNftSet(groupId, nft)` |
| **Register with NFT** | `Membership` | `registerWithNft(groupId)` | User | Must hold NFT | `NftMemberRegistered(groupId, member)` |
| **Create Claim Code** | `Membership` | `createClaimCode(groupId, codeHash)` | Group Owner | `onlyGroupOwner` + ClaimCode mode | `ClaimCodeCreated(groupId, codeHash)` |
| **Claim with Code** | `Membership` | `claimWithCode(groupId, codeHash)` | User | Valid code + not owner | `ClaimCodeClaimed(groupId, codeHash, member)` |
| **Create Poll** | `CcipEscrowSenderL2` | `createPollWithLinkEscrow(groupId, title, cid, options[], startTime, endTime, quorumEnabled, quorumBps)` | Anyone | Member + LINK escrow | `PollCreated(pollId, groupId, creator, title, cid, startTime, endTime, quorumEnabled, quorumBps, eligibleCountSnapshot)` |
| **Vote** | `Voting` | `vote(pollId, optionIndex)` | Member | Active poll + not delegated + member | `VoteCast(pollId, voter, optionIndex)`, `VoteCastWeighted(pollId, voter, optionIndex, weight)` |
| **Delegate** | `Delegation` | `delegate(pollId, delegate)` | Member | Active poll + both members + not voted | `Delegated(pollId, groupId, delegator, delegate)` |
| **Revoke Delegation** | `Delegation` | `revoke(pollId)` | Delegator | Active poll + not voted | `DelegationRevoked(pollId, groupId, delegator)` |
| **Finalize Poll** | `FinalizationL2` | `finalizePollOnL2(pollId)` | Anyone | Poll ended + not finalized | `PollFinalized(pollId, status, winningOption, totalVotes)` |
| **Send to L1** | `CcipEscrowSenderL2` | `sendResultToL1(pollId)` | Anyone | Finalized + status != Unknown | `ResultSentToL1(pollId, messageId, feePaid)` |

**Key View Functions:**
- `groups(groupId)` → `(id, owner, membershipType, name, description, createdAt)`
- `isMember(groupId, user)` → `bool` (checks membership type)
- `getPollMeta(pollId)` → `(id, groupId, creator, title, cid, startTime, endTime, quorumEnabled, quorumBps, eligibleCountSnapshot, createdAt, optionsLength)`
- `getPoll(pollId)` → `Poll` struct (full data including options array)
- `results(pollId)` → `(finalized, status, winningOption, totalVotes)`
- `hasVoted(pollId, voter)` → `bool`
- `voteCounts(pollId, optionIndex)` → `uint256`
- `delegateOf(pollId, delegator)` → `address`
- `delegatedToCount(pollId, delegate)` → `uint256`

---

### A3) Workflow Spec

#### Workflow 1: Create Group

1. **Call `createGroup(name, description, membershipType)`**
   - **Params:** `name` (non-empty string), `description` (string), `membershipType` (0=Manual, 1=NFT, 2=ClaimCode)
   - **Requires:** Contract not paused, `name.length > 0`
   - **Reverts:** `EmptyName()` if name empty
   - **Event:** `GroupCreated(groupId, msg.sender, membershipType, name)` (indexed: groupId, owner)
   - **Returns:** `groupId` (auto-incremented)

2. **If NFT mode: Call `setGroupNft(groupId, nft)`**
   - **Params:** `groupId` (from step 1), `nft` (ERC721 address)
   - **Requires:** Caller is group owner, membershipType == NFT, `nft != address(0)`
   - **Reverts:** `NotGroupOwner`, `MembershipTypeMismatch`, `ZeroAddress`
   - **Event:** `GroupNftSet(groupId, nft)` (indexed: groupId, nft)

**Evidence:** `contracts/contracts/l2/Groups.sol:L52-L73`, `contracts/contracts/l2/Membership.sol:L199-L212`

---

#### Workflow 2: Join Group (Manual)

1. **Group owner calls `setManualMember(groupId, member, true)`**
   - **Params:** `groupId`, `member` (address), `isMember` (true)
   - **Requires:** Caller is group owner, `member != owner`, membershipType != NFT
   - **Reverts:** `NotGroupOwner`, `OwnerMembershipImmutable`, `UnsupportedMembershipType`
   - **Event:** `ManualMemberSet(groupId, member, true)` (indexed: groupId, member)
   - **Side effect:** Increments `_groupMemberCount[groupId]`

**Evidence:** `contracts/contracts/l2/Membership.sol:L163-L193`

---

#### Workflow 3: Join Group (NFT)

1. **User calls `registerWithNft(groupId)`**
   - **Params:** `groupId`
   - **Requires:** Group exists, membershipType == NFT, `msg.sender != owner`, NFT contract set, `IERC721(nft).balanceOf(msg.sender) > 0`
   - **Reverts:** `GroupDoesNotExist`, `MembershipTypeMismatch`, `OwnerMembershipImmutable`, `NftNotSet`, `NftBalanceRequired`, `NftAlreadyRegistered`
   - **Event:** `NftMemberRegistered(groupId, msg.sender)` (indexed: groupId, member)
   - **Side effect:** Sets `nftRegistered[groupId][msg.sender] = true`, increments count

**Note:** Membership check at vote time requires `nftRegistered[groupId][user] == true` AND `balanceOf(user) > 0` (must still hold NFT).

**Evidence:** `contracts/contracts/l2/Membership.sol:L214-L239`, `contracts/contracts/l2/Membership.sol:L130-L137`

---

#### Workflow 4: Join Group (ClaimCode)

1. **Group owner calls `createClaimCode(groupId, codeHash)`**
   - **Params:** `groupId`, `codeHash` (bytes32, keccak256 of code string)
   - **Requires:** Caller is group owner, membershipType == ClaimCode, `codeHash != bytes32(0)`, code not already created
   - **Reverts:** `NotGroupOwner`, `MembershipTypeMismatch`, `ZeroCodeHash`, `ClaimCodeAlreadyExists`
   - **Event:** `ClaimCodeCreated(groupId, codeHash)` (indexed: groupId, codeHash)

2. **User calls `claimWithCode(groupId, codeHash)`**
   - **Params:** `groupId`, `codeHash` (keccak256 of code string)
   - **Requires:** Group exists, membershipType == ClaimCode, `msg.sender != owner`, code exists for this group, code not used
   - **Reverts:** `GroupDoesNotExist`, `MembershipTypeMismatch`, `OwnerMembershipImmutable`, `ClaimCodeNotFound`, `ClaimCodeWrongGroup`, `ClaimCodeAlreadyUsed`
   - **Event:** `ClaimCodeClaimed(groupId, codeHash, msg.sender)` (indexed: groupId, codeHash, member)
   - **Side effect:** Sets `claimCodeUsed[codeHash] = true`, `manualMembers[groupId][msg.sender] = true`, increments count

**Evidence:** `contracts/contracts/l2/Membership.sol:L261-L276`, `contracts/contracts/l2/Membership.sol:L278-L314`

---

#### Workflow 5: Create Poll

1. **Approve LINK: `linkToken.approve(veritasCoreAddress, amount)`**
   - **Amount:** `opsFeeFlat + maxFee + platformFee` (computed from CCIP quote + margins)

2. **Call `createPollWithLinkEscrow(groupId, title, cid, options[], startTime, endTime, quorumEnabled, quorumBps)`**
   - **Params:**
     - `groupId` (must exist)
     - `title` (non-empty string)
     - `cid` (IPFS CID, non-empty string)
     - `options[]` (min 2, each non-empty)
     - `startTime` (uint64, must be >= block.timestamp)
     - `endTime` (uint64, must be > startTime)
     - `quorumEnabled` (bool)
     - `quorumBps` (uint16, 0-10000, must match quorumEnabled)
   - **Requires:** Contract not paused, LINK balance >= total, allowance >= total
   - **Reverts:** `EmptyTitle`, `EmptyCid`, `BadTimeRange`, `StartTimeInPast`, `TooFewOptions`, `EmptyOption`, `BadQuorumBps`, `QuorumEnabledButBpsZero`, `QuorumDisabledButBpsNonZero`
   - **Internal:** Calls `_createPoll()` which snapshots `eligibleCountSnapshot = getEligibleCountForQuorum(groupId)`
   - **Events:** `PollCreated(pollId, groupId, creator, title, cid, startTime, endTime, quorumEnabled, quorumBps, eligibleCountSnapshot)` (indexed: pollId, groupId, creator), `EscrowLocked(pollId, groupId, creator, deposited, reservedMaxFee, reservedPlatform)`, `OpsFeeCharged(pollId, payer, treasury, opsFee)`
   - **Returns:** `pollId` (auto-incremented)

**Note:** Contract does NOT enforce "only group owner can create polls" - this is a frontend assumption that may be incorrect.

**Evidence:** `contracts/contracts/l2/CcipEscrowSenderL2.sol:L214-L268`, `contracts/contracts/l2/Polls.sol:L185-L255`

---

#### Workflow 6: Vote

1. **Call `vote(pollId, optionIndex)`**
   - **Params:** `pollId`, `optionIndex` (0-based)
   - **Requires:**
     - Poll exists
     - `block.timestamp >= startTime` (poll started)
     - `block.timestamp < endTime` (poll not ended)
     - `optionIndex < optionsLength`
     - `isMember(groupId, msg.sender) == true` (checked at vote time)
     - `hasVoted[pollId][msg.sender] == false`
     - `delegateOf[pollId][msg.sender] == address(0)` (not delegated)
   - **Reverts:** `VotingPollDoesNotExist`, `VotingPollNotStarted`, `VotingPollEnded`, `VotingBadOption`, `VotingNotMember`, `VotingDelegated`, `AlreadyVoted`
   - **Computation:** `weight = 1 + delegatedToCount[pollId][msg.sender]` (includes delegators)
   - **Events:** `VoteCast(pollId, voter, optionIndex)` (indexed: pollId, voter), `VoteCastWeighted(pollId, voter, optionIndex, weight)`
   - **Side effect:** `hasVoted[pollId][msg.sender] = true`, `voteCounts[pollId][optionIndex] += weight`

**Evidence:** `contracts/contracts/l2/Voting.sol:L50-L84`

---

#### Workflow 7: Delegate

1. **Call `delegate(pollId, delegate)`**
   - **Params:** `pollId`, `delegate` (address)
   - **Requires:**
     - Poll exists
     - `block.timestamp >= startTime` AND `block.timestamp < endTime`
     - `isMember(groupId, msg.sender) == true` AND `isMember(groupId, delegate) == true`
     - `hasVoted[pollId][msg.sender] == false` AND `hasVoted[pollId][delegate] == false`
     - `delegateOf[pollId][delegate] == address(0)` (delegate not delegating)
     - `delegatorsTo[pollId][msg.sender].length == 0` (delegator has no incoming delegations)
     - `delegate != msg.sender` AND `delegate != address(0)`
   - **Reverts:** `DelegationPollDoesNotExist`, `DelegationPollNotStarted`, `DelegationPollEnded`, `DelegationNotMember`, `DelegationDelegatorAlreadyVoted`, `DelegationDelegateAlreadyVoted`, `DelegationDelegateHasDelegated`, `DelegationDelegatorHasIncoming`, `DelegationSelfNotAllowed`, `DelegationZeroAddress`
   - **Event:** `Delegated(pollId, groupId, delegator, delegate)` (indexed: pollId, groupId, delegator, delegate)
   - **Side effect:** `delegateOf[pollId][msg.sender] = delegate`, adds to `delegatorsTo[pollId][delegate]`

2. **Revoke: Call `revoke(pollId)`**
   - **Requires:** Poll exists, active window, `delegateOf[pollId][msg.sender] != address(0)`, neither voted
   - **Reverts:** `DelegationNotDelegating`, `DelegationDelegatorAlreadyVoted`, `DelegationLockedAfterDelegateVoted`
   - **Event:** `DelegationRevoked(pollId, groupId, delegator)`

**Evidence:** `contracts/contracts/l2/Delegation.sol:L99-L143`, `contracts/contracts/l2/Delegation.sol:L145-L168`

---

#### Workflow 8: Poll Lifecycle Status Transitions

**Status computation (client-side, not on-chain):**
- **Upcoming:** `now < startTime`
- **Active:** `now >= startTime && now < endTime`
- **Ended:** `now >= endTime && !finalized`
- **Finalized:** `now >= endTime && finalized == true`

**Finalization:**
1. **Call `finalizePollOnL2(pollId)`**
   - **Requires:** Poll exists, `block.timestamp >= endTime`, not already finalized
   - **Reverts:** `FinalizationAlreadyFinalized`, `FinalizationPollDoesNotExist`, `FinalizationPollNotEnded`
   - **Computation:**
     - Iterates all options, sums `voteCounts[pollId][i]` → `totalVotes`
     - Finds `winningOption` (highest count, tie-break deterministic)
     - Computes `status`: if `totalVotes == 0` → `FailedQuorum`, else `Passed`
     - If quorum enabled: `requiredVotes = ceil(eligibleCountSnapshot * quorumBps / 10000)`, if `totalVotes < requiredVotes` → `FailedQuorum`
   - **Event:** `PollFinalized(pollId, status, winningOption, totalVotes)` (indexed: pollId)
   - **Side effect:** `results[pollId] = FinalizedResult(finalized=true, status, winningOption, totalVotes)`

**Evidence:** `contracts/contracts/l2/FinalizationL2.sol:L96-L183`, `frontend/src/pages/MyPolls.tsx:L101-L108`

---

#### Workflow 9: CCIP / L1 Finalization Flow

1. **L2: Call `sendResultToL1(pollId)`**
   - **Requires:** Escrow exists, not sent, `results[pollId].finalized == true`, `status != Unknown`
   - **Reverts:** `MissingEscrow`, `AlreadySent`, `NotFinalized`, `NotReadyStatus`
   - **Computation:** Quotes CCIP fee, builds message `(groupId, pollId, status, resultHash)`, sends via CCIP
   - **Event:** `ResultSentToL1(pollId, messageId, feePaid)` (indexed: pollId, messageId)
   - **Side effect:** `escrows[pollId].sent = true`, deducts fee from escrow

2. **L1: `VeritasCcipReceiverRegistry._ccipReceive()`**
   - **Validates:** Source chain selector, sender address (must be VeritasCore L2)
   - **Decodes:** `(groupId, pollId, status, resultHash)`
   - **Stores:** `_records[key] = Record(recorded=true, groupId, pollId, status, resultHash, inboundMessageId, ...)`
   - **Event:** `ResultRecorded(key, groupId, pollId, status, resultHash, inboundMessageId)` (indexed: key, groupId, pollId)
   - **ACK:** Sends ACK message back to L2 with `(groupId, pollId, status, resultHash, inboundMessageId)`
   - **Event:** `AckSent(key, ackMessageId, feePaid)`

3. **L2: `CcipEscrowSenderL2._ccipReceive()` (ACK handler)**
   - **Validates:** Source chain selector (L1), sender (L1 Receiver)
   - **Decodes:** `(groupId, pollId, status, resultHash, inboundMessageId)`
   - **Stores:** `ackReceived[key] = true`
   - **Event:** `L1AckReceived(key, groupId, pollId, inboundMessageId, ackMessageId)`

4. **L2: Owner calls `claimPlatformFee(pollId)` (if status == Passed)**
   - **Requires:** Escrow sent, finalized, `status == Passed`, `ackReceived[key] == true`
   - **Transfers:** `reservedPlatform` to treasury

**Evidence:** `contracts/contracts/l2/CcipEscrowSenderL2.sol:L292-L322`, `contracts/contracts/l1/VeritasCcipReceiverRegistry.sol:L140-L214`, `contracts/contracts/l2/CcipEscrowSenderL2.sol:L416-L436`

---

### A4) Invariants & Edge Cases

**Membership Invariants:**
- Owner is always a member (checked in `isMember()`)
- Manual mode: `manualMembers[groupId][user]` controls membership
- NFT mode: Requires `nftRegistered[groupId][user] == true` AND `balanceOf(user) > 0` at check time
- ClaimCode mode: Uses `manualMembers` (stored after claim)
- Owner cannot be added/removed via `setManualMember` or `registerWithNft`

**Poll Creation Constraints:**
- **UNCERTAIN:** Contract does NOT enforce "only group owner can create polls" - `createPollWithLinkEscrow` is public. Frontend assumes owner-only, but contract allows any member.
- `startTime` must be >= `block.timestamp` (cannot create polls in the past)
- `endTime` must be > `startTime`
- Minimum 2 options, each non-empty
- Quorum: if enabled, `quorumBps > 0`; if disabled, `quorumBps == 0`

**Voting Constraints:**
- Must be member at vote time (not cached)
- Cannot vote if delegated
- Cannot vote twice
- Poll must be active (`startTime <= now < endTime`)
- Option index must be valid

**Delegation Constraints:**
- Cannot delegate to self
- Both delegator and delegate must be members
- Neither can have voted
- Delegate cannot be delegating to someone else
- Delegator cannot have incoming delegations
- Delegation locks after delegate votes (cannot revoke)

**Time Windows:**
- Poll creation: `startTime >= now`
- Voting: `startTime <= now < endTime`
- Delegation: `startTime <= now < endTime`
- Finalization: `now >= endTime`

**Quorum Logic:**
- Snapshot taken at poll creation: `eligibleCountSnapshot = getEligibleCountForQuorum(groupId)` (includes owner +1)
- Finalization computes: `requiredVotes = ceil(eligibleCountSnapshot * quorumBps / 10000)`
- If `totalVotes < requiredVotes` → `FailedQuorum`
- If `totalVotes == 0` → `FailedQuorum` (always)

**Evidence:** `contracts/contracts/l2/Membership.sol:L118-L145`, `contracts/contracts/l2/Polls.sol:L185-L255`, `contracts/contracts/l2/Voting.sol:L50-L84`, `contracts/contracts/l2/Delegation.sol:L99-L143`, `contracts/contracts/l2/FinalizationL2.sol:L96-L183`

---

## Part B - Frontend Audit (Implementation Reality)

### B1) Frontend to Contract Mapping

| Page/Component | Contract Function/Event | Implementation |
|----------------|------------------------|----------------|
| **Dashboard** | `nextGroupId`, `nextPollId` | `useReadContracts` - reads stats |
| **CreateGroup** | `createGroup()`, `setGroupNft()` | `useWriteContract` - sequential txns |
| **MyGroups** | `nextGroupId`, `groups(groupId)[]`, `isMember()` | `useReadContract` + `useReadContracts` - iterates 0..nextGroupId-1 |
| **GroupDetails** | `groups()`, `isMember()`, `PollCreated` event (filtered by groupId) | `useReadContract` + `getLogs` with pagination |
| **CreatePoll** | `groups()`, `opsFeeFlat`, `linkToken.approve()`, `createPollWithLinkEscrow()` | `useReadContract` + `useWriteContract` - checks owner, approves LINK |
| **MyPolls** | `PollCreated` event (filtered by creator), `VoteCast` event (filtered by voter), `getPollMeta()`, `results()`, `hasVoted()` | `getLogs` with pagination + `multicall` |
| **PollDetails** | `getPoll()`, `results()`, `hasVoted()`, `voteCounts()[]`, `isMember()`, `vote()` | `useReadContracts` + `useWriteContract` |
| **Delegation** | `getPoll()`, `delegateOf()`, `delegatedToCount()`, `hasVoted()`, `isMember()` (x2), `delegate()`, `revoke()` | `useReadContract` + `useWriteContract` |

**Chain Assumptions:**
- All pages assume `CHAIN_IDS.baseSepolia` (84532) for VeritasCore
- L1 registry (`VeritasCcipReceiverRegistry`) on `CHAIN_IDS.ethereumSepolia` (11155111) - not used in frontend yet

**Evidence:** `frontend/src/config/contracts.ts`, `frontend/src/lib/veritas.ts`, `frontend/src/pages/*.tsx`

---

### B2) Flow Coverage

| Contract Workflow Step | Frontend Implementation | Status | Evidence |
|------------------------|------------------------|--------|----------|
| **Create Group** | `CreateGroup.tsx:L85-L183` | ✅ **Implemented** | Uses `useSimulateContract` + `useWriteContract`, extracts `groupId` from `GroupCreated` event |
| **Set NFT (after group creation)** | `CreateGroup.tsx:L143-L164` | ✅ **Implemented** | Auto-calls `setGroupNft` after group creation if NFT mode |
| **Join Manual** | `GroupDetails.tsx` (owner actions) | ⚠️ **Partial** | Owner can add members, but no dedicated "join" flow for users |
| **Join NFT** | `GroupDetails.tsx:L293-L350` | ✅ **Implemented** | `handleRegisterWithNft()` calls `registerWithNft()` |
| **Join ClaimCode** | `GroupDetails.tsx:L352-L420` | ✅ **Implemented** | `handleClaimWithCode()` computes hash, calls `claimWithCode()` |
| **Create Poll** | `CreatePoll.tsx:L198-L486` | ⚠️ **Partial** | Checks owner via `groups()` read, but contract allows any member. Missing: LINK approval flow may be incomplete |
| **Vote** | `PollDetails.tsx:L143-L290` | ✅ **Implemented** | Checks membership, calls `vote()`, handles errors |
| **Delegate** | `Delegation.tsx:L143-L188` | ✅ **Implemented** | Checks both memberships, calls `delegate()` |
| **Revoke Delegation** | `Delegation.tsx:L190-L220` | ✅ **Implemented** | Calls `revoke()` |
| **Finalize Poll** | Not found | ❌ **Missing** | No UI for `finalizePollOnL2()` |
| **Send to L1** | Not found | ❌ **Missing** | No UI for `sendResultToL1()` |
| **Poll Discovery (by group)** | `GroupDetails.tsx:L404-L450` | ✅ **Implemented** | Uses `getLogs` with `PollCreated` event filtered by `groupId`, paginated |
| **Poll Discovery (by creator)** | `MyPolls.tsx:L110-L137` | ✅ **Implemented** | Uses `getLogs` with `PollCreated` event filtered by `creator`, paginated |
| **Poll Discovery (by voter)** | `MyPolls.tsx:L139-L166` | ✅ **Implemented** | Uses `getLogs` with `VoteCast` event filtered by `voter`, paginated |

---

### B3) Risks

#### Risk 1: Poll Creation Permission Mismatch
**Severity:** P1 High  
**Issue:** Frontend assumes only group owner can create polls (`CreatePoll.tsx:L107-L110`), but contract `createPollWithLinkEscrow` is public and does not check ownership.  
**Evidence:** 
- Contract: `contracts/contracts/l2/CcipEscrowSenderL2.sol:L214-L268` (no owner check)
- Frontend: `frontend/src/pages/CreatePoll.tsx:L107-L110` (checks `isGroupOwner`)  
**Impact:** Frontend may block valid poll creation by members, or contract may allow unauthorized polls if frontend check is bypassed.

---

#### Risk 2: Missing Finalization UI
**Severity:** P1 High  
**Issue:** No frontend UI for `finalizePollOnL2()`. Polls remain in "Ended" state indefinitely until someone calls finalize externally.  
**Evidence:** 
- Contract: `contracts/contracts/l2/FinalizationL2.sol:L96-L183`
- Frontend: No implementation found  
**Impact:** Polls cannot transition to Finalized state without manual contract interaction.

---

#### Risk 3: Missing L1 Send UI
**Severity:** P2 Medium  
**Issue:** No frontend UI for `sendResultToL1()`. Results are not sent to L1 after finalization.  
**Evidence:** 
- Contract: `contracts/contracts/l2/CcipEscrowSenderL2.sol:L292-L322`
- Frontend: No implementation found  
**Impact:** Cross-chain finalization flow incomplete.

---

#### Risk 4: Logs Pagination Correctness
**Severity:** P2 Medium  
**Issue:** `getLogs` uses `MAX_BLOCK_RANGE = 99_000n` with pagination. Need to verify RPC limits.  
**Evidence:** 
- `frontend/src/pages/MyPolls.tsx:L116-L134` (pagination loop)
- `frontend/src/pages/GroupDetails.tsx:L404-L450` (pagination loop)  
**Status:** ✅ **Correct** - Uses `fromBlock/toBlock` pagination, respects `latestBlock` boundary.  
**Note:** Hardcoded `VERITASCORE_DEPLOY_BLOCK = 35543182n` may need update if contract redeployed.

---

#### Risk 5: Membership Check Timing
**Severity:** P2 Medium  
**Issue:** Frontend pre-checks membership before showing vote/delegate buttons (`PollDetails.tsx:L112-L118`, `Delegation.tsx:L87-L101`), but contract checks at execution time. Race condition if membership changes between UI render and tx submission.  
**Evidence:** 
- Contract: `contracts/contracts/l2/Voting.sol:L66` (checks at vote time)
- Frontend: `frontend/src/pages/PollDetails.tsx:L112-L118` (pre-check)  
**Impact:** UI may show "can vote" but tx reverts if membership revoked. Acceptable UX trade-off, but should show error message.

---

#### Risk 6: NFT Membership Balance Check
**Severity:** P2 Medium  
**Issue:** Frontend does not check NFT balance before allowing `registerWithNft()`. Contract requires `balanceOf(user) > 0` at registration AND at vote time.  
**Evidence:** 
- Contract: `contracts/contracts/l2/Membership.sol:L230-L232` (checks balance)
- Frontend: `frontend/src/pages/GroupDetails.tsx:L293-L350` (no balance check)  
**Impact:** User may attempt registration without NFT, tx will revert. Should pre-check balance.

---

#### Risk 7: Chain Switching
**Severity:** P3 Low  
**Issue:** Some pages check `chainId === CHAIN_IDS.baseSepolia` but don't always trigger chain switch automatically.  
**Evidence:** 
- `frontend/src/pages/CreatePoll.tsx:L78` (checks, but switch may be manual)
- `frontend/src/pages/Delegation.tsx:L146-L149` (switches on action)  
**Impact:** User may be on wrong chain, actions fail silently.

---

#### Risk 8: IPFS CID Generation
**Severity:** P3 Low  
**Issue:** `generateCidFromDescription()` creates fake CID hash, not real IPFS upload.  
**Evidence:** `frontend/src/lib/ipfs.ts:L16-L31`  
**Impact:** CID is not retrievable from IPFS gateways. Backend endpoint exists but frontend doesn't use it.

---

## Part C - Alignment Report

### C1) Are We Aligned?

**Verdict: Mostly Aligned** ✅⚠️

**Justification:**

1. **✅ Core workflows implemented:** Create group, join (NFT/ClaimCode), create poll, vote, delegate are correctly implemented with proper contract calls.

2. **⚠️ Permission assumption mismatch:** Frontend assumes owner-only poll creation, but contract allows any member. This is a **design decision gap** - either frontend should allow members, or contract should enforce owner-only.

3. **❌ Missing finalization flow:** No UI for `finalizePollOnL2()` or `sendResultToL1()`. Polls cannot complete lifecycle without external tools.

4. **✅ Event-based discovery correct:** Poll discovery via `PollCreated` and `VoteCast` events uses proper pagination and indexed filters.

5. **✅ Membership checks present:** Frontend pre-checks membership before actions, though contract re-checks at execution (acceptable).

6. **⚠️ NFT balance not pre-checked:** Registration may fail if user doesn't hold NFT, but error handling exists.

---

### C2) Mismatch List (Prioritized)

#### Mismatch 1: Poll Creation Permission
**Severity:** P1 High  
**What is wrong:** Frontend enforces owner-only poll creation, but contract allows any member.  
**Contract evidence:** `contracts/contracts/l2/CcipEscrowSenderL2.sol:L214` (public function, no owner check)  
**Frontend evidence:** `frontend/src/pages/CreatePoll.tsx:L107-L110` (checks `isGroupOwner`)  
**Minimal fix:** Either:
- Option A: Remove owner check from frontend, allow any member to create polls
- Option B: Add `onlyGroupOwner` modifier to `createPollWithLinkEscrow` in contract (requires contract upgrade)

---

#### Mismatch 2: Missing Finalization UI
**Severity:** P1 High  
**What is wrong:** No frontend UI for `finalizePollOnL2()`. Polls remain "Ended" indefinitely.  
**Contract evidence:** `contracts/contracts/l2/FinalizationL2.sol:L96-L183`  
**Frontend evidence:** No implementation  
**Minimal fix:** Add button in `PollDetails.tsx` or `MyPolls.tsx` that calls `finalizePollOnL2(pollId)` when `now >= endTime && !finalized`. Show status: "Finalize Poll" button.

---

#### Mismatch 3: Missing L1 Send UI
**Severity:** P2 Medium  
**What is wrong:** No UI for `sendResultToL1()` after finalization.  
**Contract evidence:** `contracts/contracts/l2/CcipEscrowSenderL2.sol:L292-L322`  
**Frontend evidence:** No implementation  
**Minimal fix:** Add button in `PollDetails.tsx` that calls `sendResultToL1(pollId)` when `finalized == true && status != Unknown && !sent`. Show: "Send Result to L1" button.

---

#### Mismatch 4: NFT Balance Not Pre-Checked
**Severity:** P2 Medium  
**What is wrong:** Frontend doesn't check NFT balance before allowing `registerWithNft()`.  
**Contract evidence:** `contracts/contracts/l2/Membership.sol:L230-L232` (requires `balanceOf(user) > 0`)  
**Frontend evidence:** `frontend/src/pages/GroupDetails.tsx:L293-L350` (no balance check)  
**Minimal fix:** Add `useReadContract` to read `IERC721(nft).balanceOf(address)` before showing register button. Disable button if balance == 0.

---

#### Mismatch 5: IPFS CID Fake Generation
**Severity:** P3 Low  
**What is wrong:** `generateCidFromDescription()` creates hash-based fake CID, not real IPFS upload.  
**Contract evidence:** Contract expects valid IPFS CID (no validation, but used for retrieval)  
**Frontend evidence:** `frontend/src/lib/ipfs.ts:L16-L31` (fake CID generation)  
**Minimal fix:** Call backend `/ipfs/pin-poll-description` endpoint (exists in `backend/server.js`) to upload and get real CID.

---

### C3) Recommended Next Steps

**Step-by-step plan (ordered by priority):**

1. **Clarify poll creation permission** (P1)
   - **Decision needed:** Should any member create polls, or only owner?
   - **If owner-only:** Add `onlyGroupOwner` modifier to contract (requires upgrade)
   - **If member-allowed:** Remove owner check from `CreatePoll.tsx:L107-L110`
   - **Files:** `contracts/contracts/l2/CcipEscrowSenderL2.sol`, `frontend/src/pages/CreatePoll.tsx`

2. **Add finalization UI** (P1)
   - **Add button in `PollDetails.tsx`:**
     - Show when `now >= endTime && !finalized`
     - Call `finalizePollOnL2(pollId)`
     - Display finalization status (status, winningOption, totalVotes)
   - **Files:** `frontend/src/pages/PollDetails.tsx`, `frontend/src/pages/MyPolls.tsx`

3. **Add L1 send UI** (P2)
   - **Add button in `PollDetails.tsx`:**
     - Show when `finalized == true && status != Unknown && escrow.sent == false`
     - Call `sendResultToL1(pollId)`
     - Display messageId and fee
   - **Files:** `frontend/src/pages/PollDetails.tsx`

4. **Pre-check NFT balance** (P2)
   - **In `GroupDetails.tsx`:**
     - Add `useReadContract` to read `IERC721(groupNft).balanceOf(address)`
     - Disable "Register with NFT" button if balance == 0
     - Show error: "You must hold an NFT from this collection"
   - **Files:** `frontend/src/pages/GroupDetails.tsx`

5. **Integrate real IPFS upload** (P3)
   - **Update `CreatePoll.tsx`:**
     - Replace `generateCidFromDescription()` with API call to `backend/ipfs/pin-poll-description`
     - Handle loading/error states
   - **Files:** `frontend/src/lib/ipfs.ts`, `frontend/src/pages/CreatePoll.tsx`

6. **Add error handling for membership race conditions** (P2)
   - **In `PollDetails.tsx` and `Delegation.tsx`:**
     - Catch `VotingNotMember` / `DelegationNotMember` errors
     - Show user-friendly message: "Your membership was revoked. Please refresh."
   - **Files:** `frontend/src/pages/PollDetails.tsx`, `frontend/src/pages/Delegation.tsx`

7. **Verify deployment block** (P3)
   - **Check `VERITASCORE_DEPLOY_BLOCK`:**
     - Confirm it matches actual deployment block
     - Update if contract was redeployed
   - **Files:** `frontend/src/config/deploy.ts`

8. **Add manual membership UI** (P3)
   - **In `GroupDetails.tsx`:**
     - Add "Add Member" form for group owner (Manual mode)
     - Call `setManualMember(groupId, address, true)`
   - **Files:** `frontend/src/pages/GroupDetails.tsx`

9. **Test logs pagination edge cases** (P3)
   - **Verify:**
     - Very old polls (near deploy block)
     - Very new polls (near latest block)
     - Empty results
   - **Files:** `frontend/src/pages/MyPolls.tsx`, `frontend/src/pages/GroupDetails.tsx`

10. **Add L1 registry views** (Future)
    - **New page `Results.tsx`:**
      - Query `VeritasCcipReceiverRegistry.getRecord(groupId, pollId)` on L1
      - Display finalized results from L1
    - **Files:** `frontend/src/pages/Results.tsx` (exists but may be incomplete)

---

## Appendix: Key File References

**Contracts:**
- `contracts/contracts/l2/VeritasCore.sol` - Main orchestrator
- `contracts/contracts/l2/Groups.sol:L52-L73` - Group creation
- `contracts/contracts/l2/Membership.sol` - Membership logic
- `contracts/contracts/l2/Polls.sol:L185-L255` - Poll creation
- `contracts/contracts/l2/Voting.sol:L50-L84` - Voting logic
- `contracts/contracts/l2/Delegation.sol:L99-L143` - Delegation logic
- `contracts/contracts/l2/FinalizationL2.sol:L96-L183` - Finalization
- `contracts/contracts/l2/CcipEscrowSenderL2.sol:L214-L268` - Poll creation with escrow
- `contracts/contracts/l1/VeritasCcipReceiverRegistry.sol:L140-L214` - L1 receiver

**Frontend:**
- `frontend/src/pages/CreateGroup.tsx` - Group creation
- `frontend/src/pages/GroupDetails.tsx` - Group management, membership
- `frontend/src/pages/CreatePoll.tsx` - Poll creation
- `frontend/src/pages/PollDetails.tsx` - Poll view, voting
- `frontend/src/pages/Delegation.tsx` - Delegation management
- `frontend/src/pages/MyPolls.tsx` - Poll discovery via events
- `frontend/src/pages/MyGroups.tsx` - Group listing
- `frontend/src/lib/veritas.ts` - Contract addresses, ABIs
- `frontend/src/config/contracts.ts` - Chain configs
- `frontend/src/config/deploy.ts` - Deployment block

---

**End of Audit Report**

