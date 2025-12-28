import type { Abi } from "viem";
import VeritasCoreAbiJson from "../abis/VeritasCore.json";
import { CONTRACTS } from "./contracts";

export const VERITAS = {
  chainId: CONTRACTS.baseSepolia.chainId,
  coreAddress: CONTRACTS.baseSepolia.VeritasCore as `0x${string}`,
  coreAbi: VeritasCoreAbiJson as unknown as Abi,
  l1ChainId: CONTRACTS.ethereumSepolia.chainId,
  l1Registry: CONTRACTS.ethereumSepolia.VeritasCcipReceiverRegistry as `0x${string}`,
} as const;
