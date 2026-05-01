import type { ContractFunctionParameters, Address } from "viem";
import { zeroAddress } from "viem";
import { veritasCoreAbi, veritasCoreAddress } from "@/lib/veritas";
import { toBoolFinalized } from "@/lib/polls/pollStatus";

/**
 * Minimal client shape so we avoid PublicClient type duplication issues.
 */
export type MulticallClient = {
  multicall: (args: {
    contracts: ContractFunctionParameters[];
    allowFailure?: boolean;
  }) => Promise<readonly unknown[]>;
};

export type PollRawItem = {
  id: bigint;
  groupId: bigint;
  title: string;
  startTime: bigint;
  endTime: bigint;
  finalized: boolean;
  totalVotes: bigint;
  hasVoted: boolean;
};

type LoadPollDetailsArgs = {
  publicClient: MulticallClient;
  pollIds: bigint[];
  viewer?: Address;
  pollBatchSize?: number;
};

type SuccessLike = {
  status: string;
  result?: unknown; // wagmi style
  data?: unknown; // viem docs style
};

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null;
}

function isSuccessLike(x: unknown): x is SuccessLike {
  if (!isObject(x)) return false;
  const status = x.status;
  return (
    typeof status === "string" &&
    (Object.prototype.hasOwnProperty.call(x, "result") ||
      Object.prototype.hasOwnProperty.call(x, "data"))
  );
}

function getSuccessPayload(x: unknown): unknown | undefined {
  if (!isSuccessLike(x)) return undefined;
  // wagmi returns { status, result } and viem docs show { status, data }
  if (Object.prototype.hasOwnProperty.call(x, "result")) return x.result;
  return x.data;
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  if (size <= 0) return [arr];
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function extractMeta(meta: unknown): {
  groupId: bigint;
  title: string;
  startTime: bigint;
  endTime: bigint;
} {
  // Object shape (some viem versions can return objects with named fields)
  if (meta && typeof meta === "object" && !Array.isArray(meta)) {
    const r = meta as Record<string, unknown>;

    const groupId = typeof r.groupId === "bigint" ? r.groupId : 0n;
    const title = typeof r.title === "string" ? r.title : "";
    const startTime = typeof r.startTime === "bigint" ? r.startTime : 0n;
    const endTime = typeof r.endTime === "bigint" ? r.endTime : 0n;

    // If this object is actually the full tuple-like object, try common keys as fallback
    // (kept minimal and safe)
    return { groupId, title, startTime, endTime };
  }

  // Tuple/array shape from getPollMeta
  // Expected indexes (based on your earlier usage):
  // [0]=id, [1]=groupId, [3]=title, [5]=startTime, [6]=endTime, ...
  if (Array.isArray(meta)) {
    const groupId = typeof meta[1] === "bigint" ? meta[1] : 0n;
    const title = typeof meta[3] === "string" ? meta[3] : "";
    const startTime = typeof meta[5] === "bigint" ? meta[5] : 0n;
    const endTime = typeof meta[6] === "bigint" ? meta[6] : 0n;

    // Fallback to older compact shape if needed
    const fallbackTitle = typeof meta[0] === "string" ? meta[0] : title;
    const fallbackStart = typeof meta[1] === "bigint" ? meta[1] : startTime;
    const fallbackEnd = typeof meta[2] === "bigint" ? meta[2] : endTime;

    // If it looks like the full tuple (has indexes 3/5/6), use it
    if (title || startTime !== 0n || endTime !== 0n || groupId !== 0n) {
      return { groupId, title, startTime, endTime };
    }

    // Otherwise, use compact fallback
    return {
      groupId: 0n,
      title: fallbackTitle,
      startTime: fallbackStart,
      endTime: fallbackEnd,
    };
  }

  return { groupId: 0n, title: "", startTime: 0n, endTime: 0n };
}

function extractTotalVotes(result: unknown): bigint {
  // Object shape
  if (result && typeof result === "object" && !Array.isArray(result)) {
    const r = result as Record<string, unknown>;
    if (typeof r.totalVotes === "bigint") return r.totalVotes;
  }

  // Tuple/array shape from results(): [finalized, status, winningOption, totalVotes]
  if (Array.isArray(result) && typeof result[3] === "bigint") {
    return result[3];
  }

  return 0n;
}

export async function loadPollDetails(args: LoadPollDetailsArgs): Promise<PollRawItem[]> {
  const { publicClient, pollIds } = args;
  if (!pollIds?.length) return [];

  const viewer = (args.viewer ?? zeroAddress) as Address;
  const includeHasVoted = viewer !== zeroAddress;

  const pollBatchSize = args.pollBatchSize ?? 50;
  const batches = chunkArray(pollIds, pollBatchSize);

  const out: PollRawItem[] = [];

  for (const batch of batches) {
    const calls: ContractFunctionParameters[] = [];

    for (const pid of batch) {
      calls.push({
        address: veritasCoreAddress,
        abi: veritasCoreAbi,
        functionName: "getPollMeta",
        args: [pid],
      } as ContractFunctionParameters);

      calls.push({
        address: veritasCoreAddress,
        abi: veritasCoreAbi,
        functionName: "results",
        args: [pid],
      } as ContractFunctionParameters);

      if (includeHasVoted) {
        calls.push({
          address: veritasCoreAddress,
          abi: veritasCoreAbi,
          functionName: "hasVoted",
          args: [pid, viewer],
        } as ContractFunctionParameters);
      }
    }

    const results = await publicClient.multicall({
      contracts: calls,
      allowFailure: true,
    });

    const stride = includeHasVoted ? 3 : 2;

    for (let i = 0; i < batch.length; i++) {
      const id = batch[i];
      const base = i * stride;

      const metaItem = results[base];
      const resultItem = results[base + 1];
      const votedItem = includeHasVoted ? results[base + 2] : undefined;

      const rawMeta = getSuccessPayload(metaItem);
      const rawResult = getSuccessPayload(resultItem);

      const { groupId, title, startTime, endTime } = extractMeta(rawMeta);

      const finalized = toBoolFinalized(rawResult);
      const totalVotes = extractTotalVotes(rawResult);

      const votedPayload = getSuccessPayload(votedItem);
      const hasVoted = includeHasVoted ? Boolean(votedPayload) : false;

      out.push({
        id,
        groupId,
        title,
        startTime,
        endTime,
        finalized,
        totalVotes,
        hasVoted,
      });
    }
  }

  return out;
}
