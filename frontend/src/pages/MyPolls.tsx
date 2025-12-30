import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useConnection } from "wagmi";
import type { ContractFunctionParameters } from "viem";
import { parseAbiItem, zeroAddress, createPublicClient, http } from "viem";
import { baseSepolia } from "viem/chains";

import { veritasCoreAbi, veritasCoreAddress, PollStatus } from "@/lib/veritas";
import { CHAIN_IDS } from "@/config/contracts";
import { VERITASCORE_DEPLOY_BLOCK } from "@/config/deploy";

import { Button } from "@/components/ui/Button";
import { PollCard } from "@/components/PollCard";
import { EmptyState } from "@/components/EmptyState";
import { CardSkeleton } from "@/components/LoadingSkeleton";
import { Plus, Vote, CheckCircle, Grid, List } from "lucide-react";
import { Badge } from "@/components/ui/Badge";

type StatusFilter = "all" | PollStatus;

type PollRawItem = {
  id: bigint;
  title: string;
  startTime: bigint;
  endTime: bigint;
  finalized: boolean;
  hasVoted: boolean;
};

type MulticallItem =
  | { status: "success"; result: unknown }
  | { status: "failure"; error: unknown };

type PollMetaResult = readonly [
  bigint, // id
  bigint, // groupId
  `0x${string}`, // creator
  string, // title
  string, // cid
  bigint, // startTime
  bigint, // endTime
  boolean, // quorumEnabled
  bigint | number, // quorumBps
  bigint, // eligibleCountSnapshot
  bigint, // createdAt
  bigint // optionsLength
];

function useNowSeconds() {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const t = window.setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => window.clearInterval(t);
  }, []);
  return now;
}

// Strong typed events (no ABI-name issues, no decodeEventLog needed)
const POLL_CREATED_EVENT = parseAbiItem(
  "event PollCreated(uint256 indexed pollId, uint256 indexed groupId, address indexed creator, string title, string cid, uint64 startTime, uint64 endTime, bool quorumEnabled, uint16 quorumBps, uint256 eligibleCountSnapshot)"
);

const VOTE_CAST_EVENT = parseAbiItem(
  "event VoteCast(uint256 indexed pollId, address indexed voter, uint256 optionIndex)"
);

// Use Base Sepolia Public RPC for event queries (supports 100k blocks vs Alchemy's 10)
const logsClient = createPublicClient({
  chain: baseSepolia,
  transport: http("https://sepolia.base.org"),
});

// Keep under provider max range (safer with 5k blocks)
const MAX_BLOCK_RANGE = 5_000n;

function uniqueBigints(ids: bigint[]) {
  const seen = new Set<string>();
  const out: bigint[] = [];
  for (const id of ids) {
    const k = id.toString();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(id);
  }
  return out;
}

function toBoolFinalized(result: unknown): boolean {
  if (!result) return false;

  if (typeof result === "object" && result !== null) {
    const r = result as Record<string, unknown>;
    if (typeof r.finalized === "boolean") return r.finalized;
  }

  if (Array.isArray(result) && typeof result[0] === "boolean") return result[0];

  return false;
}

function computeStatus(nowSec: number, startTime: bigint, endTime: bigint, finalized: boolean): PollStatus {
  const start = Number(startTime);
  const end = Number(endTime);

  if (Number.isFinite(start) && nowSec < start) return PollStatus.Upcoming;
  if (Number.isFinite(end) && nowSec < end) return PollStatus.Active;
  return finalized ? PollStatus.Finalized : PollStatus.Ended;
}

async function fetchPollIdsCreatedBy(creator: `0x${string}`): Promise<bigint[]> {
  const latestBlock = await logsClient.getBlockNumber();
  let fromBlock = VERITASCORE_DEPLOY_BLOCK;

  const ids: bigint[] = [];

  while (fromBlock <= latestBlock) {
    let toBlock = fromBlock + MAX_BLOCK_RANGE - 1n;
    if (toBlock > latestBlock) toBlock = latestBlock;

    const logs = await logsClient.getLogs({
      address: veritasCoreAddress,
      event: POLL_CREATED_EVENT,
      args: { creator },
      fromBlock,
      toBlock,
    });

    for (const l of logs) {
      const pollId = l.args?.pollId;
      if (typeof pollId === "bigint") ids.push(pollId);
    }

    fromBlock = toBlock + 1n;
  }

  return uniqueBigints(ids);
}

async function fetchPollIdsVotedBy(voter: `0x${string}`): Promise<bigint[]> {
  const latestBlock = await logsClient.getBlockNumber();
  let fromBlock = VERITASCORE_DEPLOY_BLOCK;

  const ids: bigint[] = [];

  while (fromBlock <= latestBlock) {
    let toBlock = fromBlock + MAX_BLOCK_RANGE - 1n;
    if (toBlock > latestBlock) toBlock = latestBlock;

    const logs = await logsClient.getLogs({
      address: veritasCoreAddress,
      event: VOTE_CAST_EVENT,
      args: { voter },
      fromBlock,
      toBlock,
    });

    for (const l of logs) {
      const pollId = l.args?.pollId;
      if (typeof pollId === "bigint") ids.push(pollId);
    }

    fromBlock = toBlock + 1n;
  }

  return uniqueBigints(ids);
}

async function loadPollDetails(args: {
  pollIds: bigint[];
  viewer: `0x${string}`;
}): Promise<PollRawItem[]> {
  const { pollIds, viewer } = args;
  if (pollIds.length === 0) return [];

  const calls: ContractFunctionParameters[] = [];

  for (const pid of pollIds) {
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

    calls.push({
      address: veritasCoreAddress,
      abi: veritasCoreAbi,
      functionName: "hasVoted",
      args: [pid, viewer],
    } as ContractFunctionParameters);
  }

  const res = (await logsClient.multicall({
    contracts: calls,
    allowFailure: true,
  })) as readonly MulticallItem[];

  const out: PollRawItem[] = [];

  for (let i = 0; i < pollIds.length; i++) {
    const pid = pollIds[i];

    const metaRes = res[i * 3 + 0];
    const resultsRes = res[i * 3 + 1];
    const votedRes = res[i * 3 + 2];

    if (!metaRes || metaRes.status !== "success" || metaRes.result === undefined) continue;

    const meta = metaRes.result as PollMetaResult;

    const title = meta[3] ?? `Poll ${pid.toString()}`;
    const startTime = meta[5] ?? 0n;
    const endTime = meta[6] ?? 0n;

    const finalized = resultsRes && resultsRes.status === "success" ? toBoolFinalized(resultsRes.result) : false;
    const hasVoted = votedRes && votedRes.status === "success" ? Boolean(votedRes.result) : false;

    out.push({
      id: pid,
      title,
      startTime,
      endTime,
      finalized,
      hasVoted,
    });
  }

  out.sort((a, b) => (a.id > b.id ? -1 : a.id < b.id ? 1 : 0));
  return out;
}

export function MyPolls() {
  const navigate = useNavigate();
  const nowSec = useNowSeconds();

  const [activeTab, setActiveTab] = useState<"created" | "voted">("created");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");

  const { address, status, chainId } = useConnection();
  const isConnected = status === "connected";
  const isOnBaseSepolia = chainId === CHAIN_IDS.baseSepolia;

  const viewer = (address ?? zeroAddress) as `0x${string}`;

  const [createdRaw, setCreatedRaw] = useState<PollRawItem[]>([]);
  const [votedRaw, setVotedRaw] = useState<PollRawItem[]>([]);

  const [createdLoading, setCreatedLoading] = useState(false);
  const [votedLoading, setVotedLoading] = useState(false);

  const [createdError, setCreatedError] = useState<string | null>(null);
  const [votedError, setVotedError] = useState<string | null>(null);

  useEffect(() => {
    if (!isConnected || !address) {
      setCreatedRaw([]);
      setVotedRaw([]);
      setCreatedError(null);
      setVotedError(null);
      return;
    }
  
    const addr = address as `0x${string}`;
    let cancelled = false;
  
    async function runCreated() {
      try {
        setCreatedLoading(true);
        setCreatedError(null);
      
        const createdIds = await fetchPollIdsCreatedBy(addr);
        const createdDetails = await loadPollDetails({
          pollIds: createdIds,
          viewer,
        });
      
        if (!cancelled) setCreatedRaw(createdDetails);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (!cancelled) setCreatedError(msg);
      } finally {
        if (!cancelled) setCreatedLoading(false);
      }
    }
  
    async function runVoted() {
      try {
        setVotedLoading(true);
        setVotedError(null);
      
        const votedIds = await fetchPollIdsVotedBy(addr);
        const votedDetails = await loadPollDetails({
          pollIds: votedIds,
          viewer,
        });
      
        if (!cancelled) setVotedRaw(votedDetails);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (!cancelled) setVotedError(msg);
      } finally {
        if (!cancelled) setVotedLoading(false);
      }
    }
  
    void runCreated();
    void runVoted();
  
    return () => {
      cancelled = true;
    };
  }, [isConnected, address, viewer]);

  const createdPolls = useMemo(() => {
    return createdRaw.map((p) => ({
      id: p.id,
      title: p.title,
      status: computeStatus(nowSec, p.startTime, p.endTime, p.finalized),
      endTime: p.endTime,
      hasVoted: p.hasVoted,
    }));
  }, [createdRaw, nowSec]);

  const votedPolls = useMemo(() => {
    return votedRaw.map((p) => ({
      id: p.id,
      title: p.title,
      status: computeStatus(nowSec, p.startTime, p.endTime, p.finalized),
      endTime: p.endTime,
      hasVoted: true,
    }));
  }, [votedRaw, nowSec]);

  const displayPolls = activeTab === "created" ? createdPolls : votedPolls;

  const filteredPolls =
    statusFilter === "all" ? displayPolls : displayPolls.filter((p) => p.status === statusFilter);

  const statusOptions: Array<{ value: StatusFilter; label: string }> = [
    { value: "all", label: "All Status" },
    { value: PollStatus.Active, label: "Active" },
    { value: PollStatus.Ended, label: "Ended" },
    { value: PollStatus.Finalized, label: "Finalized" },
  ];

  const activeLoading = activeTab === "created" ? createdLoading : votedLoading;
  const activeError = activeTab === "created" ? createdError : votedError;

  const allActiveCount = useMemo(() => {
    return [...createdPolls, ...votedPolls].filter((p) => p.status === PollStatus.Active).length;
  }, [createdPolls, votedPolls]);

  return (
    <div className="space-y-8">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold">My Polls</h1>
          <p className="text-muted-foreground">Track polls you've created and voted in</p>
          {isConnected && !isOnBaseSepolia ? (
            <p className="text-xs text-yellow-500 mt-1">
              You are on the wrong network. Switch to Base Sepolia to load polls.
            </p>
          ) : null}
        </div>

        {isConnected ? (
          <Button asChild variant="neon">
            <Link to="/polls/create">
              <Plus className="mr-2 h-4 w-4" /> Create Poll
            </Link>
          </Button>
        ) : (
          <div className="text-sm text-muted-foreground">Connect your wallet to create polls</div>
        )}
      </div>

      <div className="flex space-x-1 border-b">
        <button
          onClick={() => setActiveTab("created")}
          className={`px-6 py-3 text-sm font-medium border-b-2 transition-colors ${
            activeTab === "created"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <Vote className="inline-block mr-2 h-4 w-4" />
          Created ({createdPolls.length})
        </button>

        <button
          onClick={() => setActiveTab("voted")}
          className={`px-6 py-3 text-sm font-medium border-b-2 transition-colors ${
            activeTab === "voted"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <CheckCircle className="inline-block mr-2 h-4 w-4" />
          Voted ({votedPolls.length})
        </button>
      </div>

      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div className="flex flex-wrap gap-2">
          {statusOptions.map((option) => (
            <Badge
              key={String(option.value)}
              variant={statusFilter === option.value ? "default" : "outline"}
              className="cursor-pointer"
              onClick={() => setStatusFilter(option.value)}
            >
              {option.label}
            </Badge>
          ))}
        </div>

        <div className="flex gap-2">
          <Button
            variant={viewMode === "grid" ? "default" : "outline"}
            size="icon"
            onClick={() => setViewMode("grid")}
            aria-label="Grid view"
          >
            <Grid className="h-4 w-4" />
          </Button>
          <Button
            variant={viewMode === "list" ? "default" : "outline"}
            size="icon"
            onClick={() => setViewMode("list")}
            aria-label="List view"
          >
            <List className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {activeError ? (
        <div className="p-4 rounded-md border border-destructive/40 text-sm text-destructive">
          Failed to load polls: {activeError}
        </div>
      ) : null}

      {activeLoading ? (
        <div className={viewMode === "grid" ? "grid gap-6 md:grid-cols-2 lg:grid-cols-3" : "space-y-4"}>
          <CardSkeleton />
          <CardSkeleton />
          <CardSkeleton />
        </div>
      ) : filteredPolls.length > 0 ? (
        <div className={viewMode === "grid" ? "grid gap-6 md:grid-cols-2 lg:grid-cols-3" : "space-y-4"}>
          {filteredPolls.map((poll) => (
            <PollCard
              key={typeof poll.id === "bigint" ? poll.id.toString() : String(poll.id)}
              id={poll.id}
              title={poll.title}
              status={poll.status}
              endTime={poll.endTime}
              hasVoted={poll.hasVoted}
            />
          ))}
        </div>
      ) : (
        <EmptyState
          icon={activeTab === "created" ? Vote : CheckCircle}
          title={`No ${activeTab} polls found`}
          description={
            statusFilter !== "all"
              ? "Try changing the status filter"
              : activeTab === "created"
              ? "Create your first poll to get started"
              : "Vote in polls to see them here"
          }
          actionLabel={activeTab === "created" && isConnected ? "Create Poll" : undefined}
          onAction={activeTab === "created" && isConnected ? () => navigate("/polls/create") : undefined}
        />
      )}

      {!activeLoading && (createdPolls.length > 0 || votedPolls.length > 0) ? (
        <div className="grid md:grid-cols-3 gap-4">
          <div className="bg-primary/5 border border-primary/20 rounded-lg p-6">
            <p className="text-sm text-muted-foreground">Total Created</p>
            <p className="text-3xl font-bold">{createdPolls.length}</p>
          </div>
          <div className="bg-green-500/5 border border-green-500/20 rounded-lg p-6">
            <p className="text-sm text-muted-foreground">Total Voted</p>
            <p className="text-3xl font-bold">{votedPolls.length}</p>
          </div>
          <div className="bg-purple-500/5 border border-purple-500/20 rounded-lg p-6">
            <p className="text-sm text-muted-foreground">Active Polls</p>
            <p className="text-3xl font-bold">{allActiveCount}</p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
