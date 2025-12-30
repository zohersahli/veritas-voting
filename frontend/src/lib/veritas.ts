import { CONTRACTS } from "../config/contracts";
import type { Abi } from "viem";

import VeritasCoreJson from "../abis/VeritasCore.json";
import VeritasRegistryJson from "../abis/VeritasCcipReceiverRegistry.json";

// Addresses
export const veritasCoreAddress = CONTRACTS.baseSepolia.VeritasCore as `0x${string}`;
export const veritasRegistryAddress =
  CONTRACTS.ethereumSepolia.VeritasCcipReceiverRegistry as `0x${string}`;
export const linkTokenAddress = CONTRACTS.baseSepolia.LinkToken as `0x${string}`;

// ABIs - Hardhat generates these as JSON arrays directly
export const veritasCoreAbi = VeritasCoreJson as Abi;
export const veritasRegistryAbi = VeritasRegistryJson as Abi;

// Enums as const objects (works with TS "erasableSyntaxOnly")
export const PollStatus = {
  Upcoming: 0,
  Active: 1,
  Ended: 2,
  Finalized: 3,
} as const;
export type PollStatus = (typeof PollStatus)[keyof typeof PollStatus];

export const MembershipType = {
  Manual: 0,
  NFT: 1,
  ClaimCode: 2,
} as const;
export type MembershipType = (typeof MembershipType)[keyof typeof MembershipType];

export { CONTRACTS };
