import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  useConnection,
  useReadContract,
  useReadContracts,
  useWriteContract,
  useWaitForTransactionReceipt,
} from "wagmi";
import { zeroAddress } from "viem";

import { veritasCoreAbi, veritasCoreAddress, PollStatus } from "@/lib/veritas";
import { CHAIN_IDS } from "@/config/contracts";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { StatusBadge } from "@/components/StatusBadge";
import { VoteChart } from "@/components/VoteChart";
import { Skeleton } from "@/components/LoadingSkeleton";
import { TransactionStatus } from "@/components/TransactionStatus";
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

export function PollDetails() {
  const { pollId } = useParams();

  const { id, hasValidPollId } = useMemo(() => {
    try {
      if (typeof pollId !== "string" || pollId.length === 0)
        return { id: 0n, hasValidPollId: false };
      return { id: BigInt(pollId), hasValidPollId: true };
    } catch {
      return { id: 0n, hasValidPollId: false };
    }
  }, [pollId]);

  const { address, status, chainId } = useConnection();
  const isConnected = status === "connected";
  const isCorrectChain = chainId === CHAIN_IDS.baseSepolia;

  const voter = ((address ?? zeroAddress) as `0x${string}`);
  const [selectedOption, setSelectedOption] = useState<number | null>(null);
  const [l1MessageId, setL1MessageId] = useState<`0x${string}` | null>(null);

  const now = useNowSeconds();

  // 1) Base reads
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
        functionName: "results",
        args: [id],
      },
      {
        chainId: CHAIN_IDS.baseSepolia,
        address: veritasCoreAddress,
        abi: veritasCoreAbi,
        functionName: "hasVoted",
        args: [id, voter],
      },
    ],
    query: { enabled: hasValidPollId },
  });

  const poll = base.data?.[0]?.result as unknown as PollView | undefined;
  const res = base.data?.[1]?.result as unknown as ResultsView | undefined;
  const hasVoted = Boolean((base.data?.[2]?.result as boolean | undefined) ?? false);

  const pollGroupId = poll?.groupId;

  // AR: Pre-check membership to avoid showing actions that will revert.
  // EN: Pre-check membership to avoid showing actions that will revert.
  const { data: isMemberData, isLoading: isMemberLoading } = useReadContract({
    address: veritasCoreAddress,
    abi: veritasCoreAbi,
    functionName: "isMember",
    args: [pollGroupId ?? 0n, address ?? zeroAddress],
    query: { enabled: Boolean(pollGroupId) && Boolean(address) },
  });

  const isMember = isMemberData === true;

  const options: readonly string[] = poll?.options ?? EMPTY_OPTIONS;
  const optionsLength = options.length;

  // 2) Votes reads
  const voteContracts = useMemo(() => {
    if (!poll || optionsLength === 0) return [];
    return Array.from({ length: optionsLength }).map((_, i) => ({
      chainId: CHAIN_IDS.baseSepolia,
      address: veritasCoreAddress,
      abi: veritasCoreAbi,
      functionName: "voteCounts" as const,
      args: [id, BigInt(i)] as const,
    }));
  }, [poll, optionsLength, id]);

  const votes = useReadContracts({
    contracts: voteContracts,
    query: { enabled: hasValidPollId && Boolean(poll) && optionsLength > 0 },
  });

  // 3) Write: Vote
  const voteWrite = useWriteContract();
  const voteHash = voteWrite.data;
  const votePending = voteWrite.isPending;
  const voteSuccess = voteWrite.isSuccess;

  // 4) Write: Finalize
  const finalizeWrite = useWriteContract();
  const finalizeHash = finalizeWrite.data;
  const finalizePending = finalizeWrite.isPending;
  const finalizeSuccess = finalizeWrite.isSuccess;

  const finalizeReceipt = useWaitForTransactionReceipt({
    hash: finalizeHash,
    chainId: CHAIN_IDS.baseSepolia,
  });

  // Refetch data after successful finalization
  useEffect(() => {
    if (finalizeReceipt.isSuccess) {
      void base.refetch();
      void votes.refetch();
    }
  }, [finalizeReceipt.isSuccess, base, votes]);

  // Temporary: Log results after finalize confirmation
  useEffect(() => {
    if (finalizeReceipt.isSuccess) {
      console.log("RESULTS AFTER FINALIZE:", res);
    }
  }, [finalizeReceipt.isSuccess, res]);

  // 5) Write: Send to L1
  const sendWrite = useWriteContract();
  const sendHash = sendWrite.data;
  const sendPending = sendWrite.isPending;
  const sendSuccess = sendWrite.isSuccess;

  useEffect(() => {
    if (sendWrite.isSuccess && typeof sendWrite.data === "string") {
      setL1MessageId(sendWrite.data as `0x${string}`);
    }
  }, [sendWrite.isSuccess, sendWrite.data]);

  // 6) Chart
  const chart = useMemo(() => {
    const arr = Array.from({ length: optionsLength }).map((_, i) => {
      const raw = votes.data?.[i]?.result;
      const v = raw != null ? Number(raw) : 0;
      return { label: options[i] || `Option ${i + 1}`, votes: v, percentage: 0 };
    });

    const total = arr.reduce((acc, curr) => acc + curr.votes, 0);
    for (const opt of arr) opt.percentage = total > 0 ? (opt.votes / total) * 100 : 0;

    return { arr, total };
  }, [options, optionsLength, votes.data]);

  const statusLabel =
    res?.status === 1 ? "Passed" : res?.status === 2 ? "Failed Quorum" : "Unknown";

  const winningIndex = res?.winningOption != null ? Number(res.winningOption) : null;

  const winningLabel =
    winningIndex != null && winningIndex >= 0 && winningIndex < optionsLength
      ? options[winningIndex]
      : "N/A";

  // Guards after hooks
  if (!hasValidPollId) return <div>Missing poll id</div>;
  if (base.isLoading) return <Skeleton className="h-96 w-full" />;
  if (!poll) return <div>Poll not found</div>;

  const start = Number(poll.startTime);
  const end = Number(poll.endTime);

  const computedStatus =
    res?.finalized
      ? PollStatus.Finalized
      : now < start
      ? PollStatus.Upcoming
      : now < end
      ? PollStatus.Active
      : PollStatus.Ended;

  const canVote =
    isConnected &&
    isCorrectChain &&
    computedStatus === PollStatus.Active &&
    !hasVoted &&
    isMember &&
    !isMemberLoading &&
    selectedOption !== null &&
    selectedOption >= 0 &&
    selectedOption < optionsLength &&
    !votePending;

  const canFinalize =
    isConnected &&
    isCorrectChain &&
    computedStatus === PollStatus.Ended &&
    res?.finalized !== true &&
    !finalizePending;

  const canSendToL1 =
    isConnected &&
    isCorrectChain &&
    res?.finalized === true &&
    !sendPending;

  const handleVote = () => {
    if (!canVote || selectedOption === null) return;

    voteWrite.mutate({
      chainId: CHAIN_IDS.baseSepolia,
      address: veritasCoreAddress,
      abi: veritasCoreAbi,
      functionName: "vote",
      args: [id, BigInt(selectedOption)],
    });
  };

  const handleFinalize = () => {
    if (!canFinalize) return;

    finalizeWrite.mutate({
      chainId: CHAIN_IDS.baseSepolia,
      address: veritasCoreAddress,
      abi: veritasCoreAbi,
      functionName: "finalizePollOnL2",
      args: [id],
    });
  };

  const handleSendToL1 = () => {
    if (!canSendToL1) return;

    sendWrite.mutate({
      chainId: CHAIN_IDS.baseSepolia,
      address: veritasCoreAddress,
      abi: veritasCoreAbi,
      functionName: "sendResultToL1",
      args: [id],
    });
  };

  return (
    <div className="space-y-8">
      <div className="flex justify-between items-start">
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-bold">{poll.title}</h1>
            <StatusBadge status={computedStatus} />
          </div>
          <p className="text-muted-foreground">Ends: {formatDate(poll.endTime)}</p>
        </div>

        <div className="flex gap-2">
          <Button variant="outline" asChild>
            <Link to={`/polls/${id}/delegate`}>Delegate Vote</Link>
          </Button>

          <Button
            variant="outline"
            disabled={!canFinalize}
            onClick={handleFinalize}
            title={!isCorrectChain ? "Switch to Base Sepolia" : undefined}
          >
            {finalizePending ? "Finalizing..." : "Finalize Poll"}
          </Button>

          <Button
            variant="neon"
            disabled={!canSendToL1}
            onClick={handleSendToL1}
            title={!isCorrectChain ? "Switch to Base Sepolia" : undefined}
          >
            {sendPending ? "Sending..." : "Send to L1"}
          </Button>

          <Button asChild variant="outline">
            <Link to={`/results/l1/${poll.groupId.toString()}/${id.toString()}`}>
              View L1 Result
            </Link>
          </Button>
        </div>

        {finalizeReceipt.isLoading ? (
          <div className="text-sm text-muted-foreground">Waiting for confirmation...</div>
        ) : finalizeReceipt.isSuccess ? (
          <div className="text-sm text-green-500">Finalize confirmed ✅</div>
        ) : finalizeReceipt.isError ? (
          <div className="text-sm text-red-500">Finalize failed ❌</div>
        ) : null}

        {l1MessageId ? (
          <div className="text-sm text-green-500">
            Sent to L1. MessageId: <span className="font-mono">{l1MessageId}</span>
          </div>
        ) : null}
      </div>

      <div className="grid md:grid-cols-3 gap-8">
        <div className="md:col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Cast Your Vote</CardTitle>
            </CardHeader>

            <CardContent className="space-y-4">
              {!isConnected ? (
                <div className="p-4 bg-secondary text-muted-foreground rounded-lg text-center">
                  Connect your wallet to vote.
                </div>
              ) : !isCorrectChain ? (
                <div className="p-4 bg-secondary text-muted-foreground rounded-lg text-center">
                  Wrong network. Switch to Base Sepolia.
                </div>
              ) : isConnected && !isMemberLoading && !isMember ? (
                <div className="p-3 rounded-md border text-sm bg-yellow-500/10 border-yellow-500/20 text-yellow-500">
                  You are not a member of this group, so you cannot vote or delegate.
                </div>
              ) : hasVoted ? (
                <div className="p-4 bg-green-500/10 text-green-500 rounded-lg text-center">
                  You have already voted in this poll.
                </div>
              ) : computedStatus !== PollStatus.Active ? (
                <div className="p-4 bg-secondary text-muted-foreground rounded-lg text-center">
                  Voting is closed.
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="grid gap-2">
                    {chart.arr.map((opt, idx) => (
                      <div
                        key={idx}
                        onClick={() => setSelectedOption(idx)}
                        className={`p-4 rounded-lg border cursor-pointer transition-all ${
                          selectedOption === idx
                            ? "border-primary bg-primary/10 ring-1 ring-primary"
                            : "hover:bg-secondary"
                        }`}
                      >
                        <div className="font-medium">{opt.label}</div>
                      </div>
                    ))}
                  </div>

                  <Button
                    className="w-full"
                    size="lg"
                    variant="neon"
                    disabled={!canVote}
                    onClick={handleVote}
                  >
                    {votePending ? "Voting..." : "Submit Vote"}
                  </Button>

                  <TransactionStatus
                    status={votePending ? "pending" : voteSuccess ? "success" : "idle"}
                    hash={voteHash}
                  />

                  <TransactionStatus
                    status={finalizePending ? "pending" : finalizeSuccess ? "success" : "idle"}
                    hash={finalizeHash}
                  />

                  <TransactionStatus
                    status={sendPending ? "pending" : sendSuccess ? "success" : "idle"}
                    hash={sendHash}
                  />
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Final Result</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Finalized</span>
                <span className={res?.finalized ? "text-green-500 font-medium" : "text-muted-foreground"}>
                  {res?.finalized ? "Yes" : "No"}
                </span>
              </div>

              <div className="flex justify-between">
                <span className="text-muted-foreground">Status</span>
                <span className="font-medium">{statusLabel}</span>
              </div>

              <div className="flex justify-between">
                <span className="text-muted-foreground">Winning Option</span>
                <span className="font-medium">{winningLabel}</span>
              </div>

              <div className="flex justify-between">
                <span className="text-muted-foreground">Total Votes</span>
                <span className="font-medium">{res?.totalVotes != null ? Number(res.totalVotes) : 0}</span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Current Results</CardTitle>
            </CardHeader>
            <CardContent>
              <VoteChart options={chart.arr} totalVotes={chart.total} />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
