import { PollStatus } from "@/lib/veritas";

/**
 * Extract finalized boolean from poll result
 * Supports different return shapes from contract calls
 */
export function toBoolFinalized(result: unknown): boolean {
  if (!result) return false;

  if (typeof result === "object" && result !== null) {
    const r = result as Record<string, unknown>;
    if (typeof r.finalized === "boolean") return r.finalized;
  }

  if (Array.isArray(result) && typeof result[0] === "boolean") {
    return result[0];
  }

  return false;
}

/**
 * Compute poll status based on time and finalized flag
 */
export function computeStatus(
  nowSec: number,
  startTime: bigint,
  endTime: bigint,
  finalized: boolean
): PollStatus {
  const start = Number(startTime);
  const end = Number(endTime);

  if (Number.isFinite(start) && nowSec < start) {
    return PollStatus.Upcoming;
  }

  if (Number.isFinite(end) && nowSec < end) {
    return PollStatus.Active;
  }

  return finalized ? PollStatus.Finalized : PollStatus.Ended;
}
