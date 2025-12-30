import type { PublicClient } from "viem";
import { parseAbiItem } from "viem";
import { veritasCoreAddress } from "@/lib/veritas";
import { VERITASCORE_DEPLOY_BLOCK } from "@/config/deploy";

export const POLL_CREATED_EVENT = parseAbiItem(
  "event PollCreated(uint256 indexed pollId, uint256 indexed groupId, address indexed creator, string title, string cid, uint64 startTime, uint64 endTime, bool quorumEnabled, uint16 quorumBps, uint256 eligibleCountSnapshot)"
);

const MAX_BLOCK_RANGE = 99_000n;

export async function fetchPollCreatedLogsPaginated(
  publicClient: PublicClient,
  groupId: bigint,
  cancelled?: () => boolean
) {
  const latestBlock = await publicClient.getBlockNumber();

  let fromBlock = VERITASCORE_DEPLOY_BLOCK;
  const logs: unknown[] = [];

  while (fromBlock <= latestBlock) {
    if (cancelled?.()) break;

    let toBlock = fromBlock + MAX_BLOCK_RANGE - 1n;
    if (toBlock > latestBlock) toBlock = latestBlock;

    const chunk = await publicClient.getLogs({
      address: veritasCoreAddress,
      event: POLL_CREATED_EVENT,
      args: { groupId },
      fromBlock,
      toBlock,
    });

    logs.push(...(chunk as unknown[]));
    fromBlock = toBlock + 1n;
  }

  return logs;
}
