import { useEffect, useMemo } from "react";
import { Link, useParams } from "react-router-dom";
import { useReadContract } from "wagmi";

import { CHAIN_IDS } from "@/config/contracts";
import { veritasRegistryAbi, veritasRegistryAddress } from "@/lib/veritas";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Skeleton } from "@/components/LoadingSkeleton";
import { Badge } from "@/components/ui/Badge";

type L1RecordView = {
  recorded: boolean;
  groupId: bigint;
  pollId: bigint;
  status: number;
  resultHash: `0x${string}`;
  inboundMessageId: `0x${string}`;
};

function statusLabel(status: number): string {
  if (status === 1) return "Passed";
  if (status === 2) return "Failed Quorum";
  return "Unknown";
}

export function L1Results() {
  const { groupId, pollId } = useParams();

  const parsed = useMemo(() => {
    try {
      if (!groupId || !pollId) return { ok: false as const, group: 0n, poll: 0n };
      return { ok: true as const, group: BigInt(groupId), poll: BigInt(pollId) };
    } catch {
      return { ok: false as const, group: 0n, poll: 0n };
    }
  }, [groupId, pollId]);

  const record = useReadContract({
    chainId: CHAIN_IDS.ethereumSepolia,
    address: veritasRegistryAddress,
    abi: veritasRegistryAbi,
    functionName: "getRecord",
    args: [parsed.group, parsed.poll],
    query: { enabled: parsed.ok },
  });

  const data = record.data as unknown as L1RecordView | undefined;

  useEffect(() => {
    if (data?.recorded) return;

    const id = window.setInterval(() => {
      void record.refetch();
    }, 3000);

    return () => window.clearInterval(id);
  }, [data?.recorded, record]);

  if (!parsed.ok) return <div>Missing groupId or pollId</div>;
  if (record.isLoading) return <Skeleton className="h-64 w-full" />;
  if (!data) return <div>No data</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">L1 Result</h1>
        <Link className="underline text-sm text-muted-foreground" to={`/polls/${parsed.poll}`}>
          Back to poll
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Ethereum Sepolia Registry</CardTitle>
        </CardHeader>

        <CardContent className="space-y-3 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Recorded</span>
            {data.recorded ? <Badge>Yes</Badge> : <Badge variant="secondary">No</Badge>}
          </div>

          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Status</span>
            <span className="font-medium">{statusLabel(data.status)}</span>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">GroupId</span>
            <span className="font-mono">{data.groupId.toString()}</span>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">PollId</span>
            <span className="font-mono">{data.pollId.toString()}</span>
          </div>

          <div className="space-y-1">
            <div className="text-muted-foreground">Result Hash</div>
            <div className="font-mono break-all">{data.resultHash}</div>
          </div>

          <div className="space-y-1">
            <div className="text-muted-foreground">Inbound MessageId</div>
            <div className="font-mono break-all">{data.inboundMessageId}</div>
          </div>

          {record.isError ? (
            <div className="text-red-500">Failed to read from L1 registry.</div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
