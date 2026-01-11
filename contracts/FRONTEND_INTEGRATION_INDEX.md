# Frontend Integration Index - Veritas Smart Contracts

**Generated:** Based on complete contract analysis  
**Scope:** All L2 contracts (VeritasCore) and L1 registry (VeritasCcipReceiverRegistry)

---

## A) Member List Support

### ❌ **NO** - No function returns a full list of members

**Evidence:**
- No function like `getMembers()`, `listMembers()`, `membersOf()`, or `getGroupMembers()` exists
- Only individual membership checks exist: `isMember(uint256 groupId, address user)`

**Available Reconstruction Methods:**

1. **Manual Membership (Manual/ClaimCode groups):**
   - Read `ManualMemberSet` events filtered by `groupId`
   - Track `member` addresses from events where `isMember == true`
   - **Gotcha:** Must also include `owner` (from `groups[groupId].owner`)

2. **NFT Membership:**
   - Read `NftMemberRegistered` events filtered by `groupId`
   - Filter addresses that still hold NFT: `IERC721(groupNft[groupId]).balanceOf(address) > 0`
   - **Gotcha:** Must check `nftRegistered[groupId][address] == true` AND current NFT balance
   - **Gotcha:** Must also include `owner`

3. **Claim Code Membership:**
   - Read `ClaimCodeClaimed` events filtered by `groupId`
   - Extract `member` addresses from events
   - **Gotcha:** Claimed members are stored in `manualMembers` mapping, so same as Manual method

**Recommended Frontend Approach:**
- Use event indexing (`getLogs`) to reconstruct member lists
- For Manual/ClaimCode: Index `ManualMemberSet` events, filter by `groupId` and `isMember == true`
- For NFT: Index `NftMemberRegistered` events, then verify current NFT balance
- Always add `owner` to the list (owner is always a member)

---

## B) Frontend Read API Index

### Groups

| Function | Contract | Line | Signature | Returns | Notes |
|----------|----------|------|-----------|---------|-------|
| `nextGroupId` | Groups.sol | 36 | `uint256 public nextGroupId` | `uint256` | Total groups created (1-indexed) |
| `groups` | Groups.sol | 37 | `mapping(uint256 => Group) public groups` | `Group` struct | Read group by ID. Struct: `{id, owner, membershipType, name, description, createdAt}` |
| `groupExists` | Groups.sol | 75 | `function groupExists(uint256 groupId) external view returns (bool)` | `bool` | Check if group exists |

**Group Struct:**
```solidity
struct Group {
    uint256 id;
    address owner;
    MembershipType membershipType;  // enum: Manual=0, NFT=1, ClaimCode=2
    string name;
    string description;
    uint64 createdAt;
}
```

### Membership

| Function | Contract | Line | Signature | Returns | Notes |
|----------|----------|------|-----------|---------|-------|
| `isMember` | Membership.sol | 120 | `function isMember(uint256 groupId, address user) public view returns (bool)` | `bool` | Check membership (includes owner check) |
| `isMember` (strict) | Membership.sol | 148 | `function isMember(uint256 groupId, address user, MembershipType membershipType) external view returns (bool)` | `bool` | Validates membershipType matches group's type |
| `getGroupMemberCount` | Membership.sol | 105 | `function getGroupMemberCount(uint256 groupId) public view returns (uint256)` | `uint256` | **Owner excluded** - raw stored count |
| `getEligibleCountForQuorum` | Membership.sol | 111 | `function getEligibleCountForQuorum(uint256 groupId) public view returns (uint256)` | `uint256` | **Owner included** - count + 1 |
| `manualMembers` | Membership.sol | 41 | `mapping(uint256 => mapping(address => bool)) public manualMembers` | `bool` | Check manual membership |
| `groupNft` | Membership.sol | 45 | `mapping(uint256 => address) public groupNft` | `address` | NFT contract address for NFT groups |
| `nftRegistered` | Membership.sol | 50 | `mapping(uint256 => mapping(address => bool)) public nftRegistered` | `bool` | Check NFT registration status |
| `claimCodeGroup` | Membership.sol | 54 | `mapping(bytes32 => uint256) public claimCodeGroup` | `uint256` | Map codeHash to groupId (0 = not created) |
| `claimCodeUsed` | Membership.sol | 57 | `mapping(bytes32 => bool) public claimCodeUsed` | `bool` | Check if claim code was used |
| `claimCodeOwner` | Membership.sol | 60 | `mapping(bytes32 => address) public claimCodeOwner` | `address` | Who claimed the code |

**Gotchas:**
- `getGroupMemberCount()` excludes owner. Use `getEligibleCountForQuorum()` for quorum calculations.
- NFT membership requires BOTH `nftRegistered[groupId][user] == true` AND `IERC721(groupNft[groupId]).balanceOf(user) > 0`
- Owner is always a member (checked first in `isMember()`)

### Polls

| Function | Contract | Line | Signature | Returns | Notes |
|----------|----------|------|-----------|---------|-------|
| `nextPollId` | Polls.sol | 62 | `uint256 public nextPollId` | `uint256` | Total polls created (1-indexed) |
| `exists` | Polls.sol | 91 | `function exists(uint256 pollId) public view returns (bool)` | `bool` | Check if poll exists |
| `getPoll` | Polls.sol | 177 | `function getPoll(uint256 pollId) external view returns (Poll memory)` | `Poll` struct | Full poll data including `options[]` array |
| `getPollMeta` | Polls.sol | 95 | `function getPollMeta(uint256 pollId) external view returns (...)` | Tuple | Lightweight: id, groupId, creator, title, cid, startTime, endTime, quorumEnabled, quorumBps, eligibleCountSnapshot, createdAt, optionsLength |
| `getPollCore` | Polls.sol | 132 | `function getPollCore(uint256 pollId) external view returns (...)` | Tuple | Minimal: exists_, groupId, startTime, endTime, eligibleCountSnapshot, quorumEnabled, quorumBps, optionsLength |
| `getOptionsLength` | Polls.sol | 164 | `function getOptionsLength(uint256 pollId) external view returns (uint256)` | `uint256` | Number of options |
| `getOption` | Polls.sol | 169 | `function getOption(uint256 pollId, uint256 optionIndex) external view returns (string memory)` | `string` | Single option by index |

**Poll Struct:**
```solidity
struct Poll {
    uint256 id;
    uint256 groupId;
    address creator;
    string title;
    string cid;  // IPFS CID
    uint64 startTime;
    uint64 endTime;
    QuorumConfig quorum;  // {enabled: bool, quorumBps: uint16}
    uint256 eligibleCountSnapshot;  // Snapshot at creation time
    uint64 createdAt;
    string[] options;  // Dynamic array
}
```

**Gotchas:**
- `getPoll()` returns full struct with `options[]` array (gas-intensive)
- `getPollMeta()` returns metadata without options array (use `getOption()` separately)
- `eligibleCountSnapshot` is taken at poll creation time (includes owner)

### Voting

| Function | Contract | Line | Signature | Returns | Notes |
|----------|----------|------|-----------|---------|-------|
| `hasVoted` | Voting.sol | 23 | `mapping(uint256 => mapping(address => bool)) public hasVoted` | `bool` | Check if user voted in poll |
| `voteCounts` | Voting.sol | 24 | `mapping(uint256 => mapping(uint256 => uint256)) public voteCounts` | `uint256` | Vote count per option: `voteCounts[pollId][optionIndex]` |

**Gotchas:**
- `voteCounts` includes weighted votes (delegation weight)
- Use `multicall` to read all option counts efficiently

### Delegation

| Function | Contract | Line | Signature | Returns | Notes |
|----------|----------|------|-----------|---------|-------|
| `delegateOf` | Delegation.sol | 35 | `mapping(uint256 => mapping(address => address)) public delegateOf` | `address` | Who a delegator delegated to: `delegateOf[pollId][delegator]` |
| `delegatedToCount` | Delegation.sol | 61 | `function delegatedToCount(uint256 pollId, address delegate_) external view returns (uint256)` | `uint256` | Number of delegators for a delegate |
| `delegatorAt` | Delegation.sol | 65 | `function delegatorAt(uint256 pollId, address delegate_, uint256 index) external view returns (address)` | `address` | Get delegator at index |
| `delegatorsSlice` | Delegation.sol | 71 | `function delegatorsSlice(uint256 pollId, address delegate_, uint256 offset, uint256 limit) external view returns (address[] memory)` | `address[]` | Paginated list of delegators |

**Gotchas:**
- `delegateOf[pollId][address] == address(0)` means no delegation
- Delegation is poll-specific (not global)
- Use `delegatorsSlice()` for pagination instead of looping `delegatorAt()`

### Results (Finalization)

| Function | Contract | Line | Signature | Returns | Notes |
|----------|----------|------|-----------|---------|-------|
| `results` | FinalizationL2.sol | 39 | `mapping(uint256 => FinalizedResult) public results` | `FinalizedResult` struct | Finalized result data |

**FinalizedResult Struct:**
```solidity
struct FinalizedResult {
    bool finalized;
    ResultStatus status;  // enum: Unknown=0, Passed=1, FailedQuorum=2
    uint256 winningOption;  // Index of winning option
    uint256 totalVotes;  // Total votes cast (weighted)
}
```

**Gotchas:**
- `results[pollId].finalized == false` means poll not finalized yet
- `winningOption` is the index (0-based) into `poll.options[]`
- `totalVotes` includes weighted votes from delegation

### CCIP / L1 Registry

| Function | Contract | Line | Signature | Returns | Notes |
|----------|----------|------|-----------|---------|-------|
| `getRecord` | VeritasCcipReceiverRegistry.sol | 131 | `function getRecord(uint256 groupId, uint256 pollId) external view returns (Record memory)` | `Record` struct | L1 record for finalized poll |
| `isRecorded` | VeritasCcipReceiverRegistry.sol | 135 | `function isRecorded(uint256 groupId, uint256 pollId) external view returns (bool)` | `bool` | Check if result recorded on L1 |
| `keyOf` | VeritasCcipReceiverRegistry.sol | 93 | `function keyOf(uint256 groupId, uint256 pollId) public pure returns (bytes32)` | `bytes32` | Compute record key (keccak256(abi.encode(groupId, pollId))) |
| `escrows` | CcipEscrowSenderL2.sol | 84 | `mapping(uint256 => Escrow) public escrows` | `Escrow` struct | Escrow data for poll |

**Record Struct (L1):**
```solidity
struct Record {
    bool recorded;
    uint256 groupId;
    uint256 pollId;
    ResultStatus status;  // enum: Unknown=0, Passed=1, FailedQuorum=2
    bytes32 resultHash;
    bytes32 inboundMessageId;  // L2 -> L1 message ID
    bytes32 ackMessageId;  // L1 -> L2 ACK message ID
    uint64 recordedAt;
}
```

**Escrow Struct (L2):**
```solidity
struct Escrow {
    bool exists;
    bool sent;  // Whether result was sent to L1
    address creator;
    uint256 groupId;
    uint256 deposited;  // Total LINK deposited
    uint256 reservedMaxFee;  // Reserved for CCIP fee
    uint256 reservedPlatform;  // Reserved for platform fee (if Passed)
}
```

**Gotchas:**
- `getRecord()` returns zero struct if not recorded yet (`recorded == false`)
- `escrows[pollId].sent == true` means result was sent to L1
- `escrows[pollId].reservedPlatform` is only claimable if `status == Passed` and ACK received

---

## C) Event Index for Off-Chain Reconstruction

### Groups

| Event | Contract | Line | Signature | Indexed Fields | Non-Indexed Fields | Use Case |
|-------|----------|------|-----------|-----------------|-------------------|----------|
| `GroupCreated` | Groups.sol | 42 | `event GroupCreated(uint256 indexed groupId, address indexed owner, MembershipType membershipType, string name)` | `groupId`, `owner` | `membershipType`, `name` | Discover all groups, filter by owner |

### Membership

| Event | Contract | Line | Signature | Indexed Fields | Non-Indexed Fields | Use Case |
|-------|----------|------|-----------|-----------------|-------------------|----------|
| `ManualMemberSet` | Membership.sol | 69 | `event ManualMemberSet(uint256 indexed groupId, address indexed member, bool isMember)` | `groupId`, `member` | `isMember` | Reconstruct manual/claimcode member lists |
| `GroupNftSet` | Membership.sol | 70 | `event GroupNftSet(uint256 indexed groupId, address indexed nft)` | `groupId`, `nft` | None | Track NFT contract for NFT groups |
| `NftMemberRegistered` | Membership.sol | 74 | `event NftMemberRegistered(uint256 indexed groupId, address indexed member)` | `groupId`, `member` | None | Reconstruct NFT member lists |
| `NftMemberUnregistered` | Membership.sol | 75 | `event NftMemberUnregistered(uint256 indexed groupId, address indexed member)` | `groupId`, `member` | None | Track NFT unregistrations |
| `ClaimCodeCreated` | Membership.sol | 71 | `event ClaimCodeCreated(uint256 indexed groupId, bytes32 indexed codeHash)` | `groupId`, `codeHash` | None | Track claim codes created |
| `ClaimCodeClaimed` | Membership.sol | 72 | `event ClaimCodeClaimed(uint256 indexed groupId, bytes32 indexed codeHash, address indexed member)` | `groupId`, `codeHash`, `member` | None | Track claim code usage |
| `GroupMemberCountChanged` | Membership.sol | 77 | `event GroupMemberCountChanged(uint256 indexed groupId, uint256 newCount)` | `groupId` | `newCount` | Track member count changes |

**Gotchas:**
- For Manual/ClaimCode: Filter `ManualMemberSet` where `isMember == true` and `groupId` matches
- For NFT: Index `NftMemberRegistered`, then verify current NFT balance
- Always add `owner` to member lists (owner is always a member)

### Polls

| Event | Contract | Line | Signature | Indexed Fields | Non-Indexed Fields | Use Case |
|-------|----------|------|-----------|-----------------|-------------------|----------|
| `PollCreated` | Polls.sol | 68 | `event PollCreated(uint256 indexed pollId, uint256 indexed groupId, address indexed creator, string title, string cid, uint64 startTime, uint64 endTime, bool quorumEnabled, uint16 quorumBps, uint256 eligibleCountSnapshot)` | `pollId`, `groupId`, `creator` | `title`, `cid`, `startTime`, `endTime`, `quorumEnabled`, `quorumBps`, `eligibleCountSnapshot` | Discover polls, filter by creator or groupId |

**Gotchas:**
- `eligibleCountSnapshot` is the member count at poll creation time (includes owner)
- Use this for quorum calculations, not current member count

### Voting

| Event | Contract | Line | Signature | Indexed Fields | Non-Indexed Fields | Use Case |
|-------|----------|------|-----------|-----------------|-------------------|----------|
| `VoteCast` | Voting.sol | 29 | `event VoteCast(uint256 indexed pollId, address indexed voter, uint256 optionIndex)` | `pollId`, `voter` | `optionIndex` | Track votes, filter by voter or pollId |
| `VoteCastWeighted` | Voting.sol | 30 | `event VoteCastWeighted(uint256 indexed pollId, address indexed voter, uint256 optionIndex, uint256 weight)` | `pollId`, `voter` | `optionIndex`, `weight` | Track weighted votes (includes delegation weight) |

**Gotchas:**
- Both events are emitted for every vote
- `weight` = 1 + number of delegators (if delegate has delegators)
- Use `VoteCastWeighted` for accurate vote counts

### Delegation

| Event | Contract | Line | Signature | Indexed Fields | Non-Indexed Fields | Use Case |
|-------|----------|------|-----------|-----------------|-------------------|----------|
| `Delegated` | Delegation.sol | 42 | `event Delegated(uint256 indexed pollId, uint256 indexed groupId, address indexed delegator, address delegate)` | `pollId`, `groupId`, `delegator` | `delegate` | Track delegations, filter by delegator or pollId |
| `DelegationRevoked` | Delegation.sol | 43 | `event DelegationRevoked(uint256 indexed pollId, uint256 indexed groupId, address indexed delegator)` | `pollId`, `groupId`, `delegator` | None | Track delegation revocations |

**Gotchas:**
- Delegation is poll-specific
- Use `delegateOf[pollId][address]` for current delegation status

### Finalization

| Event | Contract | Line | Signature | Indexed Fields | Non-Indexed Fields | Use Case |
|-------|----------|------|-----------|-----------------|-------------------|----------|
| `PollFinalized` | FinalizationL2.sol | 44 | `event PollFinalized(uint256 indexed pollId, ResultStatus status, uint256 winningOption, uint256 totalVotes)` | `pollId` | `status`, `winningOption`, `totalVotes` | Track finalized polls |

**Gotchas:**
- `status` is enum: `Unknown=0`, `Passed=1`, `FailedQuorum=2`
- `winningOption` is index into `poll.options[]`

### CCIP / L1

| Event | Contract | Line | Signature | Indexed Fields | Non-Indexed Fields | Use Case |
|-------|----------|------|-----------|-----------------|-------------------|----------|
| `ResultSentToL1` | CcipEscrowSenderL2.sol | 115 | `event ResultSentToL1(uint256 indexed pollId, bytes32 indexed messageId, uint256 feePaid)` | `pollId`, `messageId` | `feePaid` | Track L2 -> L1 sends, extract messageId |
| `ResultRecorded` | VeritasCcipReceiverRegistry.sol | 57 | `event ResultRecorded(bytes32 indexed key, uint256 indexed groupId, uint256 indexed pollId, ResultStatus status, bytes32 resultHash, bytes32 inboundMessageId)` | `key`, `groupId`, `pollId` | `status`, `resultHash`, `inboundMessageId` | Track L1 record creation |
| `L1AckReceived` | CcipEscrowSenderL2.sol | 122 | `event L1AckReceived(bytes32 indexed key, uint256 indexed groupId, uint256 indexed pollId, bytes32 inboundMessageId, bytes32 ackMessageId)` | `key`, `groupId`, `pollId` | `inboundMessageId`, `ackMessageId` | Track L1 -> L2 ACK |
| `EscrowLocked` | CcipEscrowSenderL2.sol | 104 | `event EscrowLocked(uint256 indexed pollId, uint256 indexed groupId, address indexed creator, uint256 deposited, uint256 reservedMaxFee, uint256 reservedPlatform)` | `pollId`, `groupId`, `creator` | `deposited`, `reservedMaxFee`, `reservedPlatform` | Track escrow creation |
| `EscrowToppedUp` | CcipEscrowSenderL2.sol | 113 | `event EscrowToppedUp(uint256 indexed pollId, address indexed from, uint256 amount, uint256 newTotal)` | `pollId` | `from`, `amount`, `newTotal` | Track escrow top-ups |
| `PlatformFeeTransferred` | CcipEscrowSenderL2.sol | 117 | `event PlatformFeeTransferred(uint256 indexed pollId, address indexed treasury, uint256 amount)` | `pollId` | `treasury`, `amount` | Track platform fee claims |
| `LeftoverWithdrawn` | CcipEscrowSenderL2.sol | 119 | `event LeftoverWithdrawn(uint256 indexed pollId, address indexed to, uint256 amount)` | `pollId` | `to`, `amount` | Track leftover withdrawals |

**Gotchas:**
- `ResultSentToL1.messageId` is the CCIP message ID (use this, not transaction hash)
- `ResultRecorded.key` = `keccak256(abi.encode(groupId, pollId))`
- `L1AckReceived` confirms L1 received and processed the result

---

## D) Enums + Meanings

### MembershipType (Groups.sol:18-22)

```solidity
enum MembershipType {
    Manual,    // 0 - Owner manages members manually
    NFT,       // 1 - Register + hold NFT at vote time
    ClaimCode  // 2 - One-time claim codes (stored as manual members)
}
```

**Usage:**
- `groups[groupId].membershipType` returns enum value
- Immutable after group creation

### ResultStatus (FinalizationL2.sol:23-27, VeritasCcipReceiverRegistry.sol:15-19)

```solidity
enum ResultStatus {
    Unknown,      // 0 - Not finalized or invalid
    Passed,      // 1 - Poll passed (quorum met if enabled)
    FailedQuorum // 2 - Poll failed quorum requirement
}
```

**Usage:**
- `results[pollId].status` returns enum value
- `Record.status` (L1) uses same enum
- `Unknown` means poll not finalized or invalid status

**Gotchas:**
- `Unknown` is also used as placeholder in `sendResultToL1` (should never be sent)
- `Passed` means poll succeeded (quorum met if enabled, or quorum disabled)
- `FailedQuorum` means poll failed quorum requirement

---

## E) Recommended Frontend Data Flows

### MyGroups Page

**Goal:** List all groups where user is owner or member

**Flow:**
1. Read `nextGroupId` to get total groups
2. Loop `groups[i]` for `i = 1` to `nextGroupId` (multicall)
3. Filter groups where:
   - `groups[i].owner == userAddress` OR
   - `isMember(i, userAddress) == true`
4. For each group, read `getGroupMemberCount(i)` or `getEligibleCountForQuorum(i)`

**Alternative (Event-based):**
1. Index `GroupCreated` events filtered by `owner == userAddress`
2. Index `ManualMemberSet` events filtered by `member == userAddress` and `isMember == true`
3. Index `NftMemberRegistered` events filtered by `member == userAddress`
4. Index `ClaimCodeClaimed` events filtered by `member == userAddress`
5. Union all `groupId`s from events
6. Read `groups[groupId]` for each group

**Gotchas:**
- Owner is always a member (check `owner` first)
- For NFT groups, verify current NFT balance

---

### GroupDetails Page

**Goal:** Show group info, membership type, members list, polls

**Flow:**
1. Read `groups[groupId]` for metadata
2. Read `getEligibleCountForQuorum(groupId)` for member count
3. **Members List:**
   - **Manual/ClaimCode:** Index `ManualMemberSet` events where `groupId` matches and `isMember == true`, extract `member` addresses, add `owner`
   - **NFT:** Index `NftMemberRegistered` events where `groupId` matches, filter addresses where `IERC721(groupNft[groupId]).balanceOf(address) > 0`, add `owner`
4. **Polls:** Index `PollCreated` events filtered by `groupId`, extract `pollId`s

**Gotchas:**
- Owner must be included in member list
- NFT members must hold NFT at current time (not just registered)

---

### MemberList Component

**Goal:** Display list of members for a group

**Flow:**
1. Read `groups[groupId].membershipType` to determine type
2. **Manual/ClaimCode:**
   - Index `ManualMemberSet` events filtered by `groupId`
   - Extract unique `member` addresses where `isMember == true`
   - Add `groups[groupId].owner`
3. **NFT:**
   - Index `NftMemberRegistered` events filtered by `groupId`
   - For each `member`, check `IERC721(groupNft[groupId]).balanceOf(member) > 0`
   - Add `groups[groupId].owner`
4. Display list

**Gotchas:**
- Must handle all three membership types differently
- Owner is always first member
- NFT balance check is required (not just registration)

---

### MyPolls Page

**Goal:** List polls created by or voted in by user

**Flow:**
1. **Created Polls:**
   - Index `PollCreated` events filtered by `creator == userAddress`
   - Extract `pollId`s
2. **Voted Polls:**
   - Index `VoteCast` events filtered by `voter == userAddress`
   - Extract unique `pollId`s
3. For each `pollId`, read `getPollMeta(pollId)` (multicall)
4. Compute status: `now < startTime` = Upcoming, `now < endTime` = Active, `finalized` = Finalized, else = Ended
5. Read `hasVoted[pollId][userAddress]` to show vote status

**Gotchas:**
- Use `getPollMeta()` instead of `getPoll()` to avoid loading options array
- Status computation requires `results[pollId].finalized` check

---

### PollDetails Page

**Goal:** Show poll details, options, votes, results, actions

**Flow:**
1. Read `getPoll(pollId)` for full poll data (includes options)
2. Read `results[pollId]` for finalization status
3. Read `voteCounts[pollId][i]` for each option index (multicall)
4. Read `hasVoted[pollId][userAddress]` for user vote status
5. Read `delegateOf[pollId][userAddress]` for delegation status
6. Read `isMember(poll.groupId, userAddress)` for membership check
7. **Final Result:**
   - If `results[pollId].finalized == true`:
     - Display `results[pollId].status` (Passed/FailedQuorum)
     - Display `poll.options[results[pollId].winningOption]`
     - Display `results[pollId].totalVotes`
8. **L1 Result:**
   - Read `getRecord(poll.groupId, pollId)` from L1 registry
   - Display `Record.status`, `Record.resultHash`, `Record.inboundMessageId`

**Gotchas:**
- `winningOption` is index into `poll.options[]` array
- `totalVotes` includes weighted votes
- L1 record may not exist yet (check `recorded == true`)

---

### L1Results Page

**Goal:** Show L1 record for finalized poll

**Flow:**
1. Read `getRecord(groupId, pollId)` from L1 registry
2. If `recorded == false`, auto-refresh every 3 seconds
3. Display:
   - `Record.status` (Passed/FailedQuorum)
   - `Record.resultHash`
   - `Record.inboundMessageId` (L2 -> L1 message ID)
   - `Record.ackMessageId` (L1 -> L2 ACK message ID, if exists)
   - `Record.recordedAt` timestamp

**Gotchas:**
- Record may not exist immediately after `sendResultToL1` (CCIP delay)
- `ackMessageId` may be `bytes32(0)` if ACK not sent yet
- Use `isRecorded(groupId, pollId)` for quick check

---

## Summary

### Key Takeaways

1. **No member list function** - Must reconstruct from events
2. **Owner is always a member** - Must add to all member lists
3. **NFT membership requires balance check** - Not just registration
4. **Use events for discovery** - `PollCreated`, `VoteCast`, `ManualMemberSet`, etc.
5. **Use multicall for efficiency** - Read multiple values in one call
6. **Member count excludes owner** - Use `getEligibleCountForQuorum()` for quorum
7. **Poll snapshot is immutable** - `eligibleCountSnapshot` taken at creation
8. **L1 record may not exist immediately** - Auto-refresh until `recorded == true`
9. **Message ID from event** - Extract from `ResultSentToL1` event, not transaction hash

### Recommended Patterns

- **Event Indexing:** Use `getLogs()` with indexed filters for discovery
- **Multicall:** Batch read operations for efficiency
- **Caching:** Cache event data in frontend state
- **Pagination:** Use `delegatorsSlice()` for delegation lists
- **Status Computation:** Compute poll status client-side from `startTime`, `endTime`, `finalized`

---

**End of Index**
