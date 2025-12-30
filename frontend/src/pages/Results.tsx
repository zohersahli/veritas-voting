import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useConnection, useReadContracts, useWriteContract } from "wagmi";

import { veritasCoreAbi, veritasCoreAddress, PollStatus } from "@/lib/veritas";
import { CHAIN_IDS } from "@/config/contracts";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { VoteChart } from "@/components/VoteChart";
import { StatusBadge } from "@/components/StatusBadge";
import { Skeleton } from "@/components/LoadingSkeleton";
import { TransactionStatus } from "@/components/TransactionStatus";
import { ArrowLeft, Trophy } from "lucide-react";
import { formatDate } from "@/utils/format";

type PollView = {
  id: bigint;
  groupId: bigint;
  creator: `0x${string}`;
  title: string;
  cid: string;
  startTime: bigint;
  endTime: bigint;
  quorum: { enabled: boolean; quorumBps: number };
  eligibleCountSnapshot: bigint;
  createdAt: bigint;
  options: string[];
};

type PollMetaView = {
  id: bigint;
  groupId: bigint;
  creator: `0x${string}`;
  title: string;
  cid: string;
  startTime: bigint;
  endTime: bigint;
  quorumEnabled: boolean;
  quorumBps: number;
  eligibleCountSnapshot: bigint;
  createdAt: bigint;
  optionsLength: bigint;
};

type ResultsView = {
  finalized: boolean;
  status: number;
  winningOption: bigint;
  totalVotes: bigint;
};

const EMPTY_OPTIONS: readonly string[] = [];

// Updates "now" every second to match on-chain time checks.
function useNowSeconds(): number {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

  useEffect(() => {
    const id = window.setInterval(() => {
      setNow(Math.floor(Date.now() / 1000));
    }, 1000);

    return () => window.clearInterval(id);
  }, []);

  return now;
}

// AR: Match contract ceil quorum math
// EN: Match contract ceil quorum math
function requiredVotesCeil(eligible: bigint, quorumBps: bigint): bigint {
  const DENOM = 10_000n;
  return (eligible * quorumBps + (DENOM - 1n)) / DENOM;
}

export function Results() {
  const { pollId } = useParams();

  const { id, hasValidPollId } = useMemo(() => {
    try {
      if (typeof pollId !== "string" || pollId.length === 0) return { id: 0n, hasValidPollId: false };
      return { id: BigInt(pollId), hasValidPollId: true };
    } catch {
      return { id: 0n, hasValidPollId: false };
    }
  }, [pollId]);

  // Connection (for gating writes)
  const { isConnected, chainId } = useConnection();
  const isCorrectChain = chainId === CHAIN_IDS.baseSepolia;

  const now = useNowSeconds();

  // 1) Base reads (hook always called, request gated by enabled)
  const base = useReadContracts({
    contracts: [
      {
        chainId: CHAIN_IDS.baseSepolia,
        address: veritasCoreAddress,
        abi: veritasCoreAbi,
        functionName: "getPoll",
        args: [id],
      },
      {
        chainId: CHAIN_IDS.baseSepolia,
        address: veritasCoreAddress,
        abi: veritasCoreAbi,
        functionName: "getPollMeta",
        args: [id],
      },
      {
        chainId: CHAIN_IDS.baseSepolia,
        address: veritasCoreAddress,
        abi: veritasCoreAbi,
        functionName: "getOptionsLength",
        args: [id],
      },
      {
        chainId: CHAIN_IDS.baseSepolia,
        address: veritasCoreAddress,
        abi: veritasCoreAbi,
        functionName: "results",
        args: [id],
      },
    ],
    query: { enabled: hasValidPollId },
  });

  const poll = base.data?.[0]?.result as unknown as PollView | undefined;
  const pollMeta = base.data?.[1]?.result as unknown as PollMetaView | undefined;

  // IMPORTANT: don't use truthy check because 0n is falsy
  const optionsLength =
    base.data?.[2]?.result != null ? Number(base.data[2].result) : 0;

  const res = base.data?.[3]?.result as unknown as ResultsView | undefined;

  // Prefer poll.options if present, otherwise fallback to getOption
  const pollOptions = poll?.options ?? (EMPTY_OPTIONS as readonly string[]);
  const shouldFetchOptions = !poll || pollOptions.length === 0;

  // 2) Options reads (hook always called, request gated by enabled)
  const optionContracts = useMemo(() => {
    if (!shouldFetchOptions || optionsLength === 0) return [];
    return Array.from({ length: optionsLength }).map((_, i) => ({
      chainId: CHAIN_IDS.baseSepolia,
      address: veritasCoreAddress,
      abi: veritasCoreAbi,
      functionName: "getOption" as const,
      args: [id, BigInt(i)] as const,
    }));
  }, [shouldFetchOptions, optionsLength, id]);

  const optionsRead = useReadContracts({
    contracts: optionContracts,
    query: { enabled: hasValidPollId && shouldFetchOptions && optionsLength > 0 },
  });

  const labels = useMemo(() => {
    if (!shouldFetchOptions && pollOptions.length > 0) {
      return pollOptions.map((opt, i) => (opt && opt.length > 0 ? opt : `Option ${i + 1}`));
    }

    return Array.from({ length: optionsLength }).map((_, i) => {
      const r = optionsRead.data?.[i]?.result;
      const s = r != null ? String(r) : "";
      return s && s.length > 0 ? s : `Option ${i + 1}`;
    });
  }, [shouldFetchOptions, pollOptions, optionsLength, optionsRead.data]);

  // 3) Votes reads (hook always called, request gated by enabled)
  const voteContracts = useMemo(() => {
    if (optionsLength === 0) return [];
    return Array.from({ length: optionsLength }).map((_, i) => ({
      chainId: CHAIN_IDS.baseSepolia,
      address: veritasCoreAddress,
      abi: veritasCoreAbi,
      functionName: "voteCounts" as const,
      args: [id, BigInt(i)] as const,
    }));
  }, [optionsLength, id]);

  const votes = useReadContracts({
    contracts: voteContracts,
    query: { enabled: hasValidPollId && optionsLength > 0 },
  });

  // 4) Write hook (wagmi v3: mutation object)
  const write = useWriteContract();
  const txHash = write.data;
  const isPending = write.isPending;
  const isSuccess = write.isSuccess;

  // 5) Derived view-model (useMemo before early returns)
  const view = useMemo(() => {
    const start = poll ? Number(poll.startTime) : 0;
    const end = poll ? Number(poll.endTime) : 0;

    const status =
      res?.finalized
        ? PollStatus.Finalized
        : now < start
        ? PollStatus.Upcoming
        : now <= end
        ? PollStatus.Active
        : PollStatus.Ended;

    const chartOptions = labels.map((label, i) => {
      const raw = votes.data?.[i]?.result;
      const v = raw != null ? Number(raw) : 0;
      return { label, votes: v, percentage: 0 };
    });

    const totalVotes = chartOptions.reduce((acc, curr) => acc + curr.votes, 0);
    for (const opt of chartOptions) opt.percentage = totalVotes > 0 ? (opt.votes / totalVotes) * 100 : 0;

    const winnerIndex =
      chartOptions.length === 0
        ? 0
        : chartOptions.reduce(
            (maxIdx, curr, idx, arr) => (curr.votes > arr[maxIdx].votes ? idx : maxIdx),
            0
          );

    const winner = chartOptions.length > 0 ? chartOptions[winnerIndex] : null;

    const quorumEnabled = Boolean(pollMeta?.quorumEnabled ?? poll?.quorum?.enabled);
    const quorumBps = Number(pollMeta?.quorumBps ?? poll?.quorum?.quorumBps ?? 0);
    const eligibleCountSnapshot = pollMeta?.eligibleCountSnapshot ?? poll?.eligibleCountSnapshot ?? 0n;

    const quorumRequired = quorumEnabled
      ? Number(requiredVotesCeil(eligibleCountSnapshot, BigInt(quorumBps)))
      : 0;
    const quorumMet = quorumEnabled ? totalVotes >= quorumRequired : true;

    const isFinalized = Boolean(res?.finalized);
    const canSendToL1 = status === PollStatus.Ended && !isFinalized && quorumMet;

    return {
      status,
      chartOptions,
      totalVotes,
      winner,
      quorumEnabled,
      quorumBps,
      eligible: Number(eligibleCountSnapshot),
      quorumRequired,
      quorumMet,
      isFinalized,
      canSendToL1,
    };
  }, [labels, votes.data, poll, pollMeta, res, now]);

  // Safe render guards AFTER all hooks
  if (!hasValidPollId) return <div>Missing poll id</div>;
  if (base.isLoading) return <Skeleton className="h-96 w-full" />;
  if (!poll) return <div>Poll not found</div>;

  const canWrite = isConnected && isCorrectChain && !isPending;

  const handleSendToL1 = () => {
    if (!canWrite) return;
    if (!view.canSendToL1) return;

    write.mutate({
      chainId: CHAIN_IDS.baseSepolia,
      address: veritasCoreAddress,
      abi: veritasCoreAbi,
      functionName: "sendResultToL1",
      args: [id],
    });
  };

  const handleFinalizeOnL2 = () => {
    if (!canWrite) return;
    if (view.isFinalized) return;

    write.mutate({
      chainId: CHAIN_IDS.baseSepolia,
      address: veritasCoreAddress,
      abi: veritasCoreAbi,
      functionName: "finalizePollOnL2",
      args: [id],
    });
  };

  const sendDisabled = !view.canSendToL1 || !canWrite;
  const finalizeDisabled = view.isFinalized || !canWrite;

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link to={`/polls/${pollId}`}>
            <ArrowLeft className="h-5 w-5" />
          </Link>
        </Button>

        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold">{poll.title}</h1>
            <StatusBadge status={view.status} />
          </div>
          <p className="text-muted-foreground">Ends: {formatDate(poll.endTime)}</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Results</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <VoteChart options={view.chartOptions} totalVotes={view.totalVotes} />

          {view.winner ? (
            <div className="flex items-center gap-3 rounded-lg border border-white/10 bg-white/5 p-4">
              <Trophy className="h-5 w-5" />
              <div>
                <div className="font-semibold">Leading option</div>
                <div className="text-sm text-muted-foreground">{view.winner.label}</div>
              </div>
            </div>
          ) : null}

          {view.quorumEnabled ? (
            <div className="text-sm text-muted-foreground">
              Quorum required: {view.quorumRequired} votes (eligible snapshot: {view.eligible}, quorum: {view.quorumBps} bps)
            </div>
          ) : (
            <div className="text-sm text-muted-foreground">Quorum: disabled</div>
          )}

          {!isConnected ? (
            <div className="text-sm text-muted-foreground">Connect your wallet to send or finalize results.</div>
          ) : !isCorrectChain ? (
            <div className="text-sm text-muted-foreground">Wrong network. Switch to Base Sepolia.</div>
          ) : null}

          <div className="flex flex-col gap-3">
            <Button variant="neon" disabled={sendDisabled} onClick={handleSendToL1}>
              {isPending ? "Sending..." : "Send result to L1"}
            </Button>

            <Button variant="outline" disabled={finalizeDisabled} onClick={handleFinalizeOnL2}>
              {isPending ? "Finalizing..." : "Finalize on L2"}
            </Button>

            <TransactionStatus status={isPending ? "pending" : isSuccess ? "success" : "idle"} hash={txHash} />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
