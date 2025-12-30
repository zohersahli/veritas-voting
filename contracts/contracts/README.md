@'
# Contracts overview

## What lives where

### L2 (Base)
Contains the voting system logic:
- Groups and membership rules (Manual, NFT, Claim code)
- Poll creation (stores IPFS CID on-chain)
- Voting and delegation
- Finalization on L2 and emitting events for off-chain finalizer

### L1 (Ethereum)
Contains the finality and payments layer:
- Record final result once (immutable registry)
- Escrow for deposits
- Platform fees and executor compensation
- Refund handling (including FailedQuorum path)

## Why split L2 and L1
- Clear separation of concerns
- Easier testing and auditing
- Prevent mixing network-specific assumptions
'@ | Set-Content -Encoding UTF8 H:\veritas\contracts\contracts\README.md
