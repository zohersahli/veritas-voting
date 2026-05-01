import { createPublicClient, fallback, http } from "viem";
import { baseSepolia } from "viem/chains";

export const logsClient = createPublicClient({
  chain: baseSepolia,
  transport: fallback([
    http("https://base-sepolia-rpc.publicnode.com"),
    http("https://sepolia.base.org"),
  ]),
});

export const LOG_CHUNK_RANGE = 5_000n;

export async function fetchChunked<T>(
  fromBlock: bigint,
  toBlock: bigint,
  range: bigint,
  fetch: (from: bigint, to: bigint) => Promise<readonly T[]>
): Promise<T[]> {
  const out: T[] = [];
  if (toBlock < fromBlock) return out;

  let start = fromBlock;
  while (start <= toBlock) {
    const end = start + range - 1n;
    const chunkTo = end < toBlock ? end : toBlock;

    const chunk = await fetch(start, chunkTo);
    out.push(...chunk);

    start = chunkTo + 1n;
  }

  return out;
}
