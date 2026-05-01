// H:\veritas\frontend\src\pages\PollDetails.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  useConnection,
  useReadContract,
  useReadContracts,
  useWriteContract,
  useWaitForTransactionReceipt,
  useSwitchChain,
} from "wagmi";
import {
  zeroAddress,
  decodeEventLog,
  keccak256,
  encodeAbiParameters,
  parseAbiParameters,
} from "viem";

import { veritasCoreAbi, veritasCoreAddress, PollStatus } from "@/lib/veritas";
import { CHAIN_IDS } from "@/config/contracts";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { StatusBadge } from "@/components/StatusBadge";
import { VoteChart } from "@/components/VoteChart";
import { Skeleton } from "@/components/LoadingSkeleton";
import { TransactionStatus } from "@/components/TransactionStatus";
import { formatDate } from "@/utils/format";
import { useNowSeconds } from "@/hooks/useNowSeconds";
import { toast } from "@/hooks/useToast";
import { computeStatus } from "@/lib/polls/pollStatus";

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
  status: bigint; // bigint from viem
  winningOption: bigint;
  totalVotes: bigint;
};

type EscrowView = {
  exists: boolean;
  sent: boolean;
  creator: `0x${string}`;
  groupId: bigint;
  deposited: bigint;
  reservedMaxFee: bigint;
  reservedPlatform: bigint;
};

const EMPTY_OPTIONS: readonly string[] = [];

/**
 * AR: بعض قراءات wagmi ترجع struct كـ tuple (array) وليس object.
 * EN: Some wagmi reads return structs as tuples (arrays), not objects.
 */
type ResultsTuple = readonly [boolean, bigint | number, bigint | number, bigint | number];

// AR: Match contract ceil quorum math
// EN: Match contract ceil quorum math
function requiredVotesCeil(eligible: bigint, quorumBps: bigint): bigint {
  const DENOM = 10_000n;
  if (eligible === 0n || quorumBps === 0n) return 0n;
  return (eligible * quorumBps + (DENOM - 1n)) / DENOM;
}
type EscrowTuple = readonly [
  boolean,
  boolean,
  `0x${string}`,
  bigint,
  bigint,
  bigint,
  bigint
];

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null;
}

// Add this helper near isObject()
function toBigIntSafe(x: unknown, fallback: bigint = 0n): bigint {
  if (typeof x === "bigint") return x;
  if (typeof x === "number") return BigInt(x);
  if (typeof x === "string") {
    try {
      return BigInt(x);
    } catch {
      return fallback;
    }
  }
  return fallback;
}

function asResultsView(x: unknown): ResultsView | undefined {
  if (!x) return undefined;

  // Tuple: [finalized, status, winningOption, totalVotes]
  if (Array.isArray(x)) {
    const t = x as unknown as ResultsTuple;
    return {
      finalized: Boolean(t[0]),
      status: toBigIntSafe(t[1]),
      winningOption: toBigIntSafe(t[2]),
      totalVotes: toBigIntSafe(t[3]),
    };
  }

  // Object fallback
  if (isObject(x)) {
    const finalized = x["finalized"];
    const status = x["status"];
    const winningOption = x["winningOption"];
    const totalVotes = x["totalVotes"];

    if (typeof finalized === "boolean") {
      return {
        finalized,
        status: toBigIntSafe(status),
        winningOption: toBigIntSafe(winningOption),
        totalVotes: toBigIntSafe(totalVotes),
      };
    }
  }

  return undefined;
}

function asEscrowView(x: unknown): EscrowView | undefined {
  if (!x) return undefined;

  // Tuple: [exists, sent, creator, groupId, deposited, reservedMaxFee, reservedPlatform]
  if (Array.isArray(x)) {
    const t = x as unknown as EscrowTuple;
    return {
      exists: Boolean(t[0]),
      sent: Boolean(t[1]),
      creator: t[2],
      groupId: t[3],
      deposited: t[4],
      reservedMaxFee: t[5],
      reservedPlatform: t[6],
    };
  }

  // Object fallback
  if (isObject(x)) {
    const exists = x["exists"];
    const sent = x["sent"];
    const creator = x["creator"];
    const groupId = x["groupId"];
    const deposited = x["deposited"];
    const reservedMaxFee = x["reservedMaxFee"];
    const reservedPlatform = x["reservedPlatform"];

    if (typeof exists === "boolean" && typeof sent === "boolean") {
      return {
        exists,
        sent,
        creator: (typeof creator === "string" ? creator : zeroAddress) as `0x${string}`,
        groupId: typeof groupId === "bigint" ? groupId : 0n,
        deposited: typeof deposited === "bigint" ? deposited : 0n,
        reservedMaxFee: typeof reservedMaxFee === "bigint" ? reservedMaxFee : 0n,
        reservedPlatform: typeof reservedPlatform === "bigint" ? reservedPlatform : 0n,
      };
    }
  }

  return undefined;
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
  const { switchChainAsync } = useSwitchChain();

  const voter = (address ?? zeroAddress) as `0x${string}`;
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
  const res = asResultsView(base.data?.[1]?.result);
  const hasVoted = Boolean((base.data?.[2]?.result as boolean | undefined) ?? false);

  const pollGroupId = poll?.groupId;

  // AR: Pre-check membership to avoid showing actions that will revert.
  // EN: Pre-check membership to avoid showing actions that will revert.
  const { data: isMemberData, isLoading: isMemberLoading } = useReadContract({
    chainId: CHAIN_IDS.baseSepolia,
    address: veritasCoreAddress,
    abi: veritasCoreAbi,
    functionName: "isMember",
    args: [pollGroupId ?? 0n, address ?? zeroAddress],
    query: { enabled: pollGroupId != null && Boolean(address) },
  });

  const isMember = isMemberData === true;

  // Escrow read
  const escrow = useReadContract({
    chainId: CHAIN_IDS.baseSepolia,
    address: veritasCoreAddress,
    abi: veritasCoreAbi,
    functionName: "escrows",
    args: [id],
    query: { enabled: hasValidPollId },
  });

  const escrowData = asEscrowView(escrow.data);

  // Paused state read (for Send-to-L1 UX guard)
  const { data: isPaused } = useReadContract({
    chainId: CHAIN_IDS.baseSepolia,
    address: veritasCoreAddress,
    abi: veritasCoreAbi,
    functionName: "paused",
    query: { enabled: hasValidPollId },
  });

  // AR: Treat paused as "not safe" unless it's explicitly false.
  // EN: Treat paused as "not safe" unless it's explicitly false.
  const isNotPaused = isPaused === false;

  // Owner read (Ownable)
  const ownerRead = useReadContract({
    chainId: CHAIN_IDS.baseSepolia,
    address: veritasCoreAddress,
    abi: veritasCoreAbi,
    functionName: "owner",
    query: { enabled: hasValidPollId },
  });

  // Role checks
  const normalizedAddress = (address ?? zeroAddress).toLowerCase();
  const ownerAddr = ((ownerRead.data as `0x${string}` | undefined) ?? zeroAddress).toLowerCase();
  const creatorAddr = ((escrowData?.creator ?? zeroAddress) as `0x${string}`).toLowerCase();

  const isOwner =
    normalizedAddress !== zeroAddress.toLowerCase() && normalizedAddress === ownerAddr;

  const isCreator =
    normalizedAddress !== zeroAddress.toLowerCase() && normalizedAddress === creatorAddr;

  // ackKey = keccak256(abi.encode(groupId, pollId))
  const groupIdForAck = (escrowData?.groupId ?? poll?.groupId ?? 0n) as bigint;

  const ackKey = useMemo(() => {
    // AR: Do not compute a fake key. Wait until groupId is known.
    // EN: Do not compute a fake key. Wait until groupId is known.
    if (!hasValidPollId) return null;
    if (groupIdForAck === 0n) return null;

    return keccak256(
      encodeAbiParameters(parseAbiParameters("uint256, uint256"), [groupIdForAck, id])
    ) as `0x${string}`;
  }, [hasValidPollId, groupIdForAck, id]);

  const ackRead = useReadContract({
    chainId: CHAIN_IDS.baseSepolia,
    address: veritasCoreAddress,
    abi: veritasCoreAbi,
    functionName: "ackReceived",
    args: ackKey ? [ackKey] : undefined,
    query: { enabled: Boolean(ackKey) },
  });

  const ackLoading = ackRead.isLoading;
  const ackReceived = ackRead.data === true;

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

  const voteReceipt = useWaitForTransactionReceipt({
    hash: voteHash,
    chainId: CHAIN_IDS.baseSepolia,
    query: { enabled: Boolean(voteHash) },
  });

  // Refetch data after successful vote
  useEffect(() => {
    if (voteReceipt.isSuccess) {
      void base.refetch();
      void votes.refetch();
    }
  }, [voteReceipt.isSuccess, base, votes]);

  // 4) Write: Finalize
  const finalizeWrite = useWriteContract();
  const finalizeHash = finalizeWrite.data;
  const finalizePending = finalizeWrite.isPending;

  const finalizeReceipt = useWaitForTransactionReceipt({
    hash: finalizeHash,
    chainId: CHAIN_IDS.baseSepolia,
    query: { enabled: Boolean(finalizeHash) },
  });

  // Refetch data after successful finalization
  useEffect(() => {
    if (finalizeReceipt.isSuccess) {
      void base.refetch();
      void votes.refetch();
      void escrow.refetch();
      void ackRead.refetch();
    }
  }, [finalizeReceipt.isSuccess, base, votes, escrow, ackRead]);

  // 5) Write: Send to L1
  const sendWrite = useWriteContract();
  const sendHash = sendWrite.data;
  const sendPending = sendWrite.isPending;

  const sendReceipt = useWaitForTransactionReceipt({
    hash: sendHash,
    chainId: CHAIN_IDS.baseSepolia,
    query: { enabled: Boolean(sendHash) },
  });

  // 5b) Write: Withdraw Leftover (Creator)
  const withdrawWrite = useWriteContract();
  const withdrawHash = withdrawWrite.data;
  const withdrawPending = withdrawWrite.isPending;

  const withdrawReceipt = useWaitForTransactionReceipt({
    hash: withdrawHash,
    chainId: CHAIN_IDS.baseSepolia,
    query: { enabled: Boolean(withdrawHash) },
  });

  // 5c) Write: Claim Platform Fee (Owner)
  const claimWrite = useWriteContract();
  const claimHash = claimWrite.data;
  const claimPending = claimWrite.isPending;

  const claimReceipt = useWaitForTransactionReceipt({
    hash: claimHash,
    chainId: CHAIN_IDS.baseSepolia,
    query: { enabled: Boolean(claimHash) },
  });

  // Extract messageId from ResultSentToL1 event after send success
  useEffect(() => {
    if (!sendReceipt.isSuccess || !sendReceipt.data) return;

    const receipt = sendReceipt.data;
    const coreAddr = veritasCoreAddress.toLowerCase();

    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== coreAddr) continue;

      try {
        const decoded = decodeEventLog({
          abi: veritasCoreAbi,
          data: log.data,
          topics: log.topics,
        });

        if (decoded.eventName === "ResultSentToL1") {
          const args = decoded.args as { messageId?: `0x${string}` | bigint };
          if (args.messageId) {
            let msgId: `0x${string}`;
            if (typeof args.messageId === "bigint") {
              const hexStr = args.messageId.toString(16).padStart(64, "0");
              msgId = `0x${hexStr}` as `0x${string}`;
            } else {
              msgId = args.messageId as `0x${string}`;
            }
            setL1MessageId(msgId);
            break;
          }
        }
      } catch {
        // Ignore logs that don't decode with our ABI
      }
    }
  }, [sendReceipt.isSuccess, sendReceipt.data]);

  // Refetch data after successful send
  useEffect(() => {
    if (sendReceipt.isSuccess) {
      void base.refetch();
      void votes.refetch();
      void escrow.refetch();
      void ackRead.refetch();
    }
  }, [sendReceipt.isSuccess, base, votes, escrow, ackRead]);

  // Refetch after successful withdraw
  useEffect(() => {
    if (withdrawReceipt.isSuccess) {
      void base.refetch();
      void escrow.refetch();
      void ackRead.refetch();
    }
  }, [withdrawReceipt.isSuccess, base, escrow, ackRead]);

  // Refetch after successful claim
  useEffect(() => {
    if (claimReceipt.isSuccess) {
      void base.refetch();
      void escrow.refetch();
      void ackRead.refetch();
    }
  }, [claimReceipt.isSuccess, base, escrow, ackRead]);

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
    res?.status === 1n ? "Passed" : res?.status === 2n ? "Failed Quorum" : "Unknown";

  const winningIndex = res?.winningOption != null ? Number(res.winningOption) : null;

  const winningLabel =
    winningIndex != null && winningIndex >= 0 && winningIndex < optionsLength
      ? options[winningIndex]
      : "N/A";

  // Quorum calculation
  const quorumEnabled = poll?.quorum?.enabled ?? false;
  const quorumBps = poll?.quorum?.quorumBps ?? 0n;
  const eligibleCountSnapshot = poll?.eligibleCountSnapshot ?? 0n;
  const quorumRequired = quorumEnabled
    ? Number(requiredVotesCeil(eligibleCountSnapshot, BigInt(quorumBps)))
    : 0;
  const quorumMet = quorumEnabled
    ? Number(res?.totalVotes ?? 0n) >= quorumRequired
    : true;

  // Compute before debug + before early returns (safe fallbacks)
  const computedStatus = computeStatus(
    now,
    poll?.startTime ?? 0n,
    poll?.endTime ?? 0n,
    res?.finalized ?? false
  );

  const canSendToL1 =
    isConnected &&
    isCorrectChain &&
    isNotPaused &&
    res?.finalized === true &&
    res?.status !== 0n &&
    escrowData?.exists === true &&
    escrowData?.sent === false &&
    (escrowData?.deposited ?? 0n) > 0n &&
    !sendPending;

  // Withdraw + Claim guards
  const deposited = escrowData?.deposited ?? 0n;
  const reservedPlatform = escrowData?.reservedPlatform ?? 0n;

  // AR: Prevent underflow. Only allow if deposited > reservedPlatform.
  // EN: Prevent underflow. Only allow if deposited > reservedPlatform.
  const hasWithdrawable = deposited > reservedPlatform;

  const canWithdrawLeftover =
    isConnected &&
    isCorrectChain &&
    isNotPaused &&
    escrowData?.exists === true &&
    escrowData?.sent === true &&
    isCreator &&
    hasWithdrawable &&
    !withdrawPending;

  const canClaimPlatformFee =
    isConnected &&
    isCorrectChain &&
    isNotPaused &&
    escrowData?.exists === true &&
    escrowData?.sent === true &&
    isOwner &&
    res?.status === 1n &&
    ackReceived === true &&
    reservedPlatform > 0n &&
    !claimPending;

  // AR: Debug Claim guard values (temporary).
  // EN: Debug Claim guard values (temporary).
  const lastClaimGuardRef = useRef<string>("");

  useEffect(() => {
    if (!hasValidPollId) return;
    if (base.isLoading) return;

    const payload = {
      address,
      owner: ownerRead.data,
      isOwner,
      chainId,
      isCorrectChain,
      isPaused,
      isNotPaused,
      pollStatus: res?.status,
      escrowExists: escrowData?.exists,
      escrowSent: escrowData?.sent,
      groupIdForAck: groupIdForAck?.toString(),
      ackKey,
      ackReceived,
      reservedPlatform: reservedPlatform?.toString(),
      canClaimPlatformFee,
      // AR: Additional checks to identify which condition breaks activation.
      // EN: Additional checks to identify which condition breaks activation.
      status,
      isConnected,
      claimPending,
      typeofResStatus: typeof res?.status,
      typeofReservedPlatform: typeof reservedPlatform,
    };

    const key = JSON.stringify(payload, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
    if (key === lastClaimGuardRef.current) return;

    lastClaimGuardRef.current = key;
    console.log("CLAIM_GUARD", payload);
  }, [
    hasValidPollId,
    base.isLoading,
    address,
    ownerRead.data,
    isOwner,
    chainId,
    isCorrectChain,
    isPaused,
    isNotPaused,
    res?.status,
    escrowData?.exists,
    escrowData?.sent,
    groupIdForAck,
    ackKey,
    ackReceived,
    reservedPlatform,
    canClaimPlatformFee,
    status,
    isConnected,
    claimPending,
  ]);

  // AR: Debug Send guard values (temporary).
  // EN: Debug Send guard values (temporary).
  const lastSendGuardRef = useRef<string>("");
  useEffect(() => {
    if (!hasValidPollId) return;
    if (base.isLoading) return;

    const payload = {
      isConnected,
      chainId,
      isCorrectChain,
      sendPending,
      isPaused,
      finalized: res?.finalized,
      status: res?.status,
      escrowExists: escrowData?.exists,
      escrowSent: escrowData?.sent,
      deposited: escrowData?.deposited,
      canSendToL1,
    };

    const key = JSON.stringify(payload, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
    if (key === lastSendGuardRef.current) return;

    lastSendGuardRef.current = key;
    console.log("SEND_GUARD", payload);
  }, [
    hasValidPollId,
    base.isLoading,
    isConnected,
    chainId,
    isCorrectChain,
    sendPending,
    isPaused,
    res?.finalized,
    res?.status,
    escrowData?.exists,
    escrowData?.sent,
    escrowData?.deposited,
    canSendToL1,
  ]);

  // Guards after hooks
  if (!hasValidPollId) return <div>Missing poll id</div>;
  if (base.isLoading) return <Skeleton className="h-96 w-full" />;
  if (!poll) return <div>Poll not found</div>;

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
    optionsLength > 0 &&
    !finalizePending;

  const handleVote = async () => {
    if (!canVote || selectedOption === null) return;
    if (!isConnected) return;

    if (!isCorrectChain) {
      try {
        await switchChainAsync({ chainId: CHAIN_IDS.baseSepolia });
      } catch (err) {
        console.error("Failed to switch chain:", err);
        toast.error(
          "Network switch was rejected or failed. Please switch to Base Sepolia manually."
        );
        return;
      }
    }

    voteWrite.mutate({
      chainId: CHAIN_IDS.baseSepolia,
      address: veritasCoreAddress,
      abi: veritasCoreAbi,
      functionName: "vote",
      args: [id, BigInt(selectedOption)],
    });
  };

  const handleFinalize = async () => {
    if (!canFinalize) return;
    if (!isConnected) return;

    if (!isCorrectChain) {
      try {
        await switchChainAsync({ chainId: CHAIN_IDS.baseSepolia });
      } catch (err) {
        console.error("Failed to switch chain:", err);
        toast.error(
          "Network switch was rejected or failed. Please switch to Base Sepolia manually."
        );
        return;
      }
    }

    finalizeWrite.mutate({
      chainId: CHAIN_IDS.baseSepolia,
      address: veritasCoreAddress,
      abi: veritasCoreAbi,
      functionName: "finalizePollOnL2",
      args: [id],
    });
  };

  const handleSendToL1 = async () => {
    if (!canSendToL1) return;
    if (!isConnected) return;

    if (!isCorrectChain) {
      try {
        await switchChainAsync({ chainId: CHAIN_IDS.baseSepolia });
      } catch (err) {
        console.error("Failed to switch chain:", err);
        toast.error(
          "Network switch was rejected or failed. Please switch to Base Sepolia manually."
        );
        return;
      }
    }

    sendWrite.mutate({
      chainId: CHAIN_IDS.baseSepolia,
      address: veritasCoreAddress,
      abi: veritasCoreAbi,
      functionName: "sendResultToL1",
      args: [id],
    });
  };

  const handleWithdrawLeftover = async () => {
    if (!canWithdrawLeftover) return;
    if (!isConnected) return;

    if (!isCorrectChain) {
      try {
        await switchChainAsync({ chainId: CHAIN_IDS.baseSepolia });
      } catch (err) {
        console.error("Failed to switch chain:", err);
        toast.error(
          "Network switch was rejected or failed. Please switch to Base Sepolia manually."
        );
        return;
      }
    }

    withdrawWrite.mutate({
      chainId: CHAIN_IDS.baseSepolia,
      address: veritasCoreAddress,
      abi: veritasCoreAbi,
      functionName: "withdrawLeftover",
      args: [id],
    });
  };

  const handleClaimPlatformFee = async () => {
    if (!canClaimPlatformFee) return;
    if (!isConnected) return;

    if (!isCorrectChain) {
      try {
        await switchChainAsync({ chainId: CHAIN_IDS.baseSepolia });
      } catch (err) {
        console.error("Failed to switch chain:", err);
        toast.error(
          "Network switch was rejected or failed. Please switch to Base Sepolia manually."
        );
        return;
      }
    }

    claimWrite.mutate({
      chainId: CHAIN_IDS.baseSepolia,
      address: veritasCoreAddress,
      abi: veritasCoreAbi,
      functionName: "claimPlatformFee",
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
            title={
              !isCorrectChain
                ? "Switch to Base Sepolia"
                : !isNotPaused
                ? "Contract is paused"
                : undefined
            }
          >
            {sendPending ? "Sending..." : "Send to L1"}
          </Button>

          {isCreator ? (
            <Button
              variant="outline"
              disabled={!canWithdrawLeftover}
              onClick={handleWithdrawLeftover}
              title={
                !isCorrectChain
                  ? "Switch to Base Sepolia"
                  : !isNotPaused
                  ? "Contract is paused"
                  : escrowData?.sent !== true
                  ? "Send to L1 first"
                  : !hasWithdrawable
                  ? "No leftover available"
                  : undefined
              }
            >
              {withdrawPending ? "Withdrawing..." : "Withdraw Leftover"}
            </Button>
          ) : null}

          {isOwner ? (
            <Button
              variant="outline"
              disabled={!canClaimPlatformFee}
              onClick={handleClaimPlatformFee}
              title={
                !isCorrectChain
                  ? "Switch to Base Sepolia"
                  : !isNotPaused
                  ? "Contract is paused"
                  : res?.status !== 1n
                  ? "Poll must be Passed"
                  : ackKey == null || ackLoading
                  ? "Loading ACK..."
                  : ackReceived !== true
                  ? "Waiting for ACK"
                  : reservedPlatform <= 0n
                  ? "No platform fee reserved"
                  : undefined
              }
            >
              {claimPending ? "Claiming..." : "Claim Platform Fee"}
            </Button>
          ) : null}

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

        {finalizeHash ? (
          <TransactionStatus
            status={
              finalizeReceipt.isLoading || finalizePending
                ? "pending"
                : finalizeReceipt.isSuccess
                ? "success"
                : finalizeReceipt.isError || Boolean(finalizeWrite.error)
                ? "error"
                : "idle"
            }
            hash={finalizeHash}
            error={(finalizeWrite.error ?? (finalizeReceipt.error as Error | null)) ?? undefined}
            chainId={CHAIN_IDS.baseSepolia}
          />
        ) : null}

        {sendHash ? (
          <TransactionStatus
            status={
              sendReceipt.isLoading || sendPending
                ? "pending"
                : sendReceipt.isSuccess
                ? "success"
                : sendReceipt.isError || Boolean(sendWrite.error)
                ? "error"
                : "idle"
            }
            hash={sendHash}
            error={(sendWrite.error ?? (sendReceipt.error as Error | null)) ?? undefined}
            chainId={CHAIN_IDS.baseSepolia}
          />
        ) : null}

        {withdrawHash ? (
          <TransactionStatus
            status={
              withdrawReceipt.isLoading || withdrawPending
                ? "pending"
                : withdrawReceipt.isSuccess
                ? "success"
                : withdrawReceipt.isError || Boolean(withdrawWrite.error)
                ? "error"
                : "idle"
            }
            hash={withdrawHash}
            error={(withdrawWrite.error ?? (withdrawReceipt.error as Error | null)) ?? undefined}
            chainId={CHAIN_IDS.baseSepolia}
          />
        ) : null}

        {claimHash ? (
          <TransactionStatus
            status={
              claimReceipt.isLoading || claimPending
                ? "pending"
                : claimReceipt.isSuccess
                ? "success"
                : claimReceipt.isError || Boolean(claimWrite.error)
                ? "error"
                : "idle"
            }
            hash={claimHash}
            error={(claimWrite.error ?? (claimReceipt.error as Error | null)) ?? undefined}
            chainId={CHAIN_IDS.baseSepolia}
          />
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
                    chainId={CHAIN_IDS.baseSepolia}
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
                <span
                  className={
                    res?.finalized ? "text-green-500 font-medium" : "text-muted-foreground"
                  }
                >
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
                <span className="font-medium">
                  {res?.totalVotes != null ? Number(res.totalVotes) : 0}
                </span>
              </div>

              {quorumEnabled ? (
                <>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Quorum</span>
                    <span
                      className={
                        quorumMet ? "text-green-500 font-medium" : "text-red-500 font-medium"
                      }
                    >
                      {quorumMet ? "Met" : "Not Met"}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Required Votes</span>
                    <span className="font-medium">{quorumRequired}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Eligible Voters</span>
                    <span className="font-medium">{Number(eligibleCountSnapshot)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Quorum</span>
                    <span className="font-medium">
                      {(Number(quorumBps) / 100).toFixed(2)}%
                    </span>
                  </div>
                </>
              ) : null}
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
