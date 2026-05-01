import { Children, isValidElement, useEffect, useMemo, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import type { Abi } from "viem";
import { parseAbiItem, keccak256, toBytes, zeroAddress } from "viem";
import { useParams, Link } from "react-router-dom";
import {
  useReadContract,
  useConnection,
  useChainId,
  useSwitchChain,
  useWriteContract,
} from "wagmi";

import { veritasCoreAbi, veritasCoreAddress } from "@/lib/veritas";

import { VERITASCORE_DEPLOY_BLOCK } from "@/config/deploy";
import { CHAIN_IDS } from "@/config/contracts";
import { logsClient, fetchChunked } from "@/lib/logsClient";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/LoadingSkeleton";
import { MemberList } from "@/components/MemberList";
import { PollCard } from "@/components/PollCard";
import { Badge } from "@/components/ui/Badge";
import { Plus } from "lucide-react";
import { computeStatus } from "@/lib/polls/pollStatus";
import { useNowSeconds } from "@/hooks/useNowSeconds";
import { loadPollDetails } from "@/lib/polls/loadPollDetails";
import type { PollRawItem } from "@/lib/polls/loadPollDetails";
import { toast } from "@/hooks/useToast";

const TABS = ["info", "members", "polls"] as const;
type TabKey = (typeof TABS)[number];

type TabContentProps = {
  value: TabKey;
  children: ReactNode;
};

function SimpleTabs({
  children,
  defaultValue,
}: {
  children: ReactNode;
  defaultValue: TabKey;
}) {
  const [activeTab, setActiveTab] = useState<TabKey>(defaultValue);

  useEffect(() => {
    setActiveTab(defaultValue);
  }, [defaultValue]);

  const items = useMemo(() => {
    return Children.toArray(children).filter(isValidElement) as ReactElement<TabContentProps>[];
  }, [children]);

  const active = useMemo(() => {
    return items.find((child) => child.props.value === activeTab) ?? items[0] ?? null;
  }, [items, activeTab]);

  return (
    <div className="space-y-4">
      <div className="flex space-x-2 border-b">
        {TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>

      {active}
    </div>
  );
}

function TabContent({ value, children }: TabContentProps) {
  return (
    <div data-tab={value} className="animate-in fade-in slide-in-from-bottom-2 duration-300">
      {children}
    </div>
  );
}

type GroupTuple = readonly [
  bigint, // id
  `0x${string}`, // owner
  number, // membershipType
  string, // name
  string, // description
  bigint // createdAt
];

const POLL_CREATED_EVENT = parseAbiItem(
  "event PollCreated(uint256 indexed pollId, uint256 indexed groupId, address indexed creator, string title, string cid, uint64 startTime, uint64 endTime, bool quorumEnabled, uint16 quorumBps, uint256 eligibleCountSnapshot)"
);

const LOG_CHUNK_RANGE = 5_000n;

type Bytes32 = `0x${string}`;

function claimCodeToHash(code: string): Bytes32 {
  const trimmed = code.trim();
  if (!trimmed) return `0x${"0".repeat(64)}` as Bytes32;
  return keccak256(toBytes(trimmed)) as Bytes32;
}

type ClaimCodeItem = {
  code: string;
  hash: Bytes32;
  createdAt: number;
};

function generateClaimCode(length = 12): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = new Uint8Array(length);
  window.crypto.getRandomValues(bytes);

  let out = "";
  for (let i = 0; i < length; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

export function GroupDetails() {
  const { groupId } = useParams();
  const nowSec = useNowSeconds();

  const { address, status } = useConnection();
  const isConnected = status === "connected";

  const chainId = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();

  const isCorrectChain = chainId === CHAIN_IDS.baseSepolia;

  // AR: Centralized safe chain switch to avoid unhandled promise rejections.
  // EN: Centralized safe chain switch to avoid unhandled promise rejections.
  const ensureBaseSepolia = async (): Promise<boolean> => {
    if (isCorrectChain) return true;

    try {
      await switchChainAsync({ chainId: CHAIN_IDS.baseSepolia });
      return true;
    } catch (err) {
      console.error("switchChainAsync failed:", err);
      toast.error("Please switch to Base Sepolia in your wallet");
      return false;
    }
  };

  const { id, hasValidGroupId } = useMemo(() => {
    try {
      if (typeof groupId !== "string" || groupId.length === 0) {
        return { id: 0n, hasValidGroupId: false };
      }
      return { id: BigInt(groupId), hasValidGroupId: true };
    } catch {
      return { id: 0n, hasValidGroupId: false };
    }
  }, [groupId]);

  const extraAbi = veritasCoreAbi as unknown as Abi;

  const { data: group, isLoading: isGroupLoading } = useReadContract({
    chainId: CHAIN_IDS.baseSepolia,
    address: veritasCoreAddress,
    abi: veritasCoreAbi,
    functionName: "groups",
    args: [id],
    query: { enabled: hasValidGroupId },
  });

  const groupTuple = useMemo(() => {
    return group as unknown as GroupTuple | undefined;
  }, [group]);

  const membershipType = groupTuple?.[2];

  const defaultTab = useMemo<TabKey>(() => {
    if (membershipType === 1 || membershipType === 2) return "members";
    return "polls";
  }, [membershipType]);

  const { data: memberCountData } = useReadContract({
    chainId: CHAIN_IDS.baseSepolia,
    address: veritasCoreAddress,
    abi: extraAbi,
    functionName: "_groupMemberCount",
    args: [id],
    query: { enabled: hasValidGroupId },
  });

  const { data: nftAddressData } = useReadContract({
    chainId: CHAIN_IDS.baseSepolia,
    address: veritasCoreAddress,
    abi: extraAbi,
    functionName: "groupNft",
    args: [id],
    query: { enabled: hasValidGroupId && membershipType === 1 },
  });

  const memberCount = typeof memberCountData === "bigint" ? memberCountData : 0n;
  const nftAddress = typeof nftAddressData === "string" ? (nftAddressData as `0x${string}`) : undefined;

  const {
    data: isMemberData,
    isLoading: isMemberLoading,
    refetch: refetchIsMember,
  } = useReadContract({
    chainId: CHAIN_IDS.baseSepolia,
    address: veritasCoreAddress,
    abi: veritasCoreAbi,
    functionName: "isMember",
    args: [id, (address ?? zeroAddress) as `0x${string}`],
    query: { enabled: hasValidGroupId && isConnected && !!address },
  });

  const isMember = isMemberData === true;

  const [claimCode, setClaimCode] = useState("");
  const [claimLoading, setClaimLoading] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);

  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [copiedHash, setCopiedHash] = useState<string | null>(null);

  async function copyToClipboard(text: string): Promise<boolean> {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedCode(text);
      window.setTimeout(() => setCopiedCode(null), 1200);
      return true;
    } catch {
      return false;
    }
  }

  const [ownerCreateLoading, setOwnerCreateLoading] = useState(false);
  const [ownerCreateError, setOwnerCreateError] = useState<string | null>(null);
  const [generatedCodes, setGeneratedCodes] = useState<ClaimCodeItem[]>([]);
  const [batchCount, setBatchCount] = useState(1);

  const storageKey = useMemo(() => `claimCodes_${id.toString()}`, [id]);

  useEffect(() => {
    if (!hasValidGroupId) return;
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) setGeneratedCodes(JSON.parse(saved) as ClaimCodeItem[]);
    } catch (e) {
      console.error("Failed to load saved codes:", e);
    }
  }, [storageKey, hasValidGroupId]);

  useEffect(() => {
    if (!hasValidGroupId || generatedCodes.length === 0) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify(generatedCodes));
    } catch (e) {
      console.error("Failed to save codes:", e);
    }
  }, [generatedCodes, storageKey, hasValidGroupId]);

  function downloadAllCodesAsCSV() {
    if (generatedCodes.length === 0) return;

    const headers = ["Code", "Hash", "Created At"];
    const rows = generatedCodes.map((c) => [c.code, c.hash, new Date(c.createdAt).toISOString()]);
    const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `claim-codes-group-${id.toString()}-${Date.now()}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  /**
   * Polls tab data
   */
  const [pollIds, setPollIds] = useState<bigint[]>([]);
  const [pollIdsLoading, setPollIdsLoading] = useState(false);
  const [pollIdsError, setPollIdsError] = useState<string | null>(null);

  const [pollRaw, setPollRaw] = useState<PollRawItem[]>([]);
  const [pollDetailsLoading, setPollDetailsLoading] = useState(false);
  const [pollDetailsError, setPollDetailsError] = useState<string | null>(null);

  useEffect(() => {
    if (!hasValidGroupId) return;

    let cancelled = false;

    (async () => {
      setPollIdsLoading(true);
      setPollIdsError(null);
      setPollIds([]);
      setPollRaw([]);
      setPollDetailsError(null);

      try {
        const latestBlock = await logsClient.getBlockNumber({ cacheTime: 0 });

        const allLogs = await fetchChunked(
          VERITASCORE_DEPLOY_BLOCK,
          latestBlock,
          LOG_CHUNK_RANGE,
          (fb, tb) =>
            logsClient.getLogs({
              address: veritasCoreAddress,
              event: POLL_CREATED_EVENT,
              args: { groupId: id },
              fromBlock: fb,
              toBlock: tb,
            })
        );

        const sortedLogs = [...allLogs].sort((a, b) => {
          const ab = a.blockNumber ?? 0n;
          const bb = b.blockNumber ?? 0n;
          if (ab < bb) return -1;
          if (ab > bb) return 1;

          const ai = BigInt(a.logIndex ?? 0);
          const bi = BigInt(b.logIndex ?? 0);
          if (ai < bi) return -1;
          if (ai > bi) return 1;
          return 0;
        });

        const seen = new Set<string>();
        const orderedIds: bigint[] = [];

        for (const l of sortedLogs) {
          const pid = (l as unknown as { args?: { pollId?: bigint } }).args?.pollId;
          if (pid === undefined || typeof pid !== "bigint") continue;

          const key = pid.toString();
          if (seen.has(key)) continue;

          seen.add(key);
          orderedIds.push(pid);
        }

        if (!cancelled) setPollIds(orderedIds);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error("Failed to fetch PollCreated logs:", e);
        if (!cancelled) setPollIdsError(msg);
      } finally {
        if (!cancelled) setPollIdsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [hasValidGroupId, id]);

  useEffect(() => {
    if (!hasValidGroupId) return;

    let cancelled = false;

    (async () => {
      if (pollIds.length === 0) {
        setPollRaw([]);
        return;
      }

      setPollDetailsLoading(true);
      setPollDetailsError(null);

      try {
        const viewer = (address ?? zeroAddress) as `0x${string}`;
        const details = await loadPollDetails({
          publicClient: logsClient,
          pollIds,
          viewer,
          pollBatchSize: 50,
        });
        if (!cancelled) setPollRaw(details);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error("Failed to fetch poll details:", e);
        if (!cancelled) setPollDetailsError(msg);
      } finally {
        if (!cancelled) setPollDetailsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [hasValidGroupId, pollIds, address]);

  const groupPolls = useMemo(() => {
    return pollRaw.map((p) => ({
      id: p.id,
      title: p.title,
      startTime: p.startTime,
      status: computeStatus(nowSec, p.startTime, p.endTime, p.finalized),
      endTime: p.endTime,
      hasVoted: p.hasVoted,
      voteCount: Number(p.totalVotes),
    }));
  }, [pollRaw, nowSec]);

  if (!hasValidGroupId) return <div>Missing or invalid group id</div>;

  if (isGroupLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (!groupTuple) return <div>Group not found</div>;

  const [onchainId, owner, membershipTypeFinal, name, description] = groupTuple;

  const isOwner = isConnected && address ? address.toLowerCase() === owner.toLowerCase() : false;

  const membershipLabel =
    membershipTypeFinal === 0
      ? "Manual"
      : membershipTypeFinal === 1
      ? "NFT"
      : membershipTypeFinal === 2
      ? "Claim Code"
      : "Unknown";

  async function handleRegisterWithNft() {
    if (!isConnected || !address) {
      toast.error("Connect your wallet first");
      return;
    }

    const ok = await ensureBaseSepolia();
    if (!ok) return;

    try {
      await writeContractAsync({
        chainId: CHAIN_IDS.baseSepolia,
        address: veritasCoreAddress,
        abi: veritasCoreAbi,
        functionName: "registerWithNft",
        args: [id],
      });

      await refetchIsMember();
      toast.success("Registered successfully");
    } catch (e) {
      console.error("registerWithNft failed:", e);
      toast.error("Transaction failed");
    }
  }

  async function handleClaimWithCode() {
    if (!isConnected || !address) {
      toast.error("Connect your wallet first");
      return;
    }

    setClaimLoading(true);
    setClaimError(null);

    const ok = await ensureBaseSepolia();
    if (!ok) {
      setClaimLoading(false);
      return;
    }

    try {
      const codeHash = claimCodeToHash(claimCode);

      await writeContractAsync({
        chainId: CHAIN_IDS.baseSepolia,
        address: veritasCoreAddress,
        abi: veritasCoreAbi,
        functionName: "claimWithCode",
        args: [id, codeHash],
      });

      await refetchIsMember();
      setClaimCode("");
      toast.success("Claim successful");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("claimWithCode failed:", e);
      setClaimError(msg);
      toast.error("Claim failed");
    } finally {
      setClaimLoading(false);
    }
  }

  async function handleOwnerCreateClaimCode() {
    if (!isConnected || !address) {
      toast.error("Connect your wallet first");
      return;
    }
    if (!isOwner) return;
    if (membershipTypeFinal !== 2) return;

    if (batchCount < 1 || batchCount > 1000) {
      setOwnerCreateError("Batch count must be between 1 and 1000");
      return;
    }

    const ok = await ensureBaseSepolia();
    if (!ok) return;

    try {
      setOwnerCreateLoading(true);
      setOwnerCreateError(null);

      const newCodes: ClaimCodeItem[] = [];
      for (let i = 0; i < batchCount; i++) {
        const code = generateClaimCode(12);
        const hash = claimCodeToHash(code);
        newCodes.push({ code, hash, createdAt: Date.now() });
      }

      for (const { hash } of newCodes) {
        await writeContractAsync({
          chainId: CHAIN_IDS.baseSepolia,
          address: veritasCoreAddress,
          abi: veritasCoreAbi,
          functionName: "createClaimCode",
          args: [id, hash],
        });
      }

      setGeneratedCodes((prev) => [...newCodes, ...prev]);
      toast.success("Codes created");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("createClaimCode failed:", e);
      setOwnerCreateError(msg);
      toast.error("Failed to create codes");
    } finally {
      setOwnerCreateLoading(false);
    }
  }

  const pollsLoading = pollIdsLoading || pollDetailsLoading;
  const pollsError = pollIdsError ?? pollDetailsError;

  return (
    <div className="space-y-8">
      <div className="flex flex-col md:flex-row justify-between items-start gap-4">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <h1 className="text-3xl font-bold">{name}</h1>
            <Badge variant="outline">ID: {onchainId.toString()}</Badge>
          </div>

          <p className="text-muted-foreground max-w-2xl">{description}</p>

          <div className="flex gap-4 text-sm text-muted-foreground">
            <span>
              Owner: {owner.slice(0, 6)}...{owner.slice(-4)}
            </span>
            <span>Members: {memberCount.toString()}</span>
          </div>

          {!isConnected && (
            <p className="text-sm text-muted-foreground">Connect your wallet to create a poll.</p>
          )}
        </div>

        {isConnected && isOwner && (
          <Button asChild variant="neon">
            <Link to={`/polls/create?groupId=${onchainId.toString()}`}>
              <Plus className="mr-2 h-4 w-4" /> Create Poll
            </Link>
          </Button>
        )}
      </div>

      <SimpleTabs defaultValue={defaultTab}>
        <TabContent value="info">
          <Card>
            <CardHeader>
              <CardTitle>Group Information</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium text-muted-foreground">Membership Type</label>
                  <p>{membershipLabel}</p>
                </div>

                {membershipTypeFinal === 1 && (
                  <div>
                    <label className="text-sm font-medium text-muted-foreground">NFT Address</label>
                    <p className="font-mono text-sm">{nftAddress ?? "Not set"}</p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </TabContent>

        <TabContent value="members">
          {membershipTypeFinal === 1 && isConnected && (
            <Card>
              <CardHeader>
                <CardTitle>NFT Membership</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {isMember ? (
                  <div className="text-sm text-muted-foreground">
                    You are already registered for this NFT group.
                  </div>
                ) : (
                  <>
                    <div className="text-sm text-muted-foreground">
                      You need to own the group NFT to register.
                    </div>
                    <Button
                      type="button"
                      variant="neon"
                      disabled={isMemberLoading}
                      onClick={handleRegisterWithNft}
                    >
                      Register with NFT
                    </Button>
                  </>
                )}
              </CardContent>
            </Card>
          )}

          {membershipTypeFinal === 2 && isConnected && (
            <Card>
              <CardHeader>
                <CardTitle>Claim Code Membership</CardTitle>
              </CardHeader>

              <CardContent className="space-y-3">
                {isOwner ? (
                  <>
                    <div className="text-sm text-muted-foreground">
                      Owner tools: generate claim codes and share them with users. Only the hash is stored on-chain.
                    </div>

                    <div className="flex gap-2 items-end">
                      <div className="flex-1">
                        <label className="text-xs text-muted-foreground mb-1 block">
                          Number of codes to generate (1-1000)
                        </label>
                        <input
                          type="number"
                          min="1"
                          max="1000"
                          value={batchCount}
                          onChange={(e) => {
                            const val = parseInt(e.target.value, 10);
                            if (!isNaN(val) && val >= 1 && val <= 1000) setBatchCount(val);
                          }}
                          className="w-full h-10 rounded-md border bg-background px-3 text-sm"
                          disabled={ownerCreateLoading}
                        />
                      </div>

                      <Button
                        type="button"
                        variant="neon"
                        onClick={handleOwnerCreateClaimCode}
                        disabled={ownerCreateLoading || batchCount < 1 || batchCount > 1000}
                      >
                        {ownerCreateLoading
                          ? `Creating ${batchCount}...`
                          : `Create ${batchCount === 1 ? "code" : `${batchCount} codes`}`}
                      </Button>
                    </div>

                    {ownerCreateError ? (
                      <div className="text-sm text-destructive">
                        Failed to create code: {ownerCreateError}
                      </div>
                    ) : null}

                    {generatedCodes.length > 0 ? (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <div className="text-sm font-medium">
                            Generated codes ({generatedCodes.length} total)
                          </div>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={downloadAllCodesAsCSV}
                          >
                            Download All ({generatedCodes.length}) CSV
                          </Button>
                        </div>

                        <div className="text-xs text-muted-foreground">
                          Showing first {Math.min(5, generatedCodes.length)} codes. Download CSV to see all.
                        </div>

                        {generatedCodes.slice(0, 5).map((c) => (
                          <div key={c.hash} className="rounded-md border bg-background/40 p-3 space-y-2">
                            <div className="flex items-center justify-between gap-2">
                              <div className="text-sm">
                                <span className="text-muted-foreground">Code:</span>{" "}
                                <span className="font-mono">{c.code}</span>
                              </div>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={async () => {
                                  const ok2 = await copyToClipboard(c.code);
                                  setCopiedCode(ok2 ? c.code : null);
                                  setTimeout(() => setCopiedCode(null), 1200);
                                }}
                              >
                                {copiedCode === c.code ? "Copied!" : "Copy code"}
                              </Button>
                            </div>

                            <div className="flex items-center justify-between gap-2">
                              <div className="text-xs">
                                <span className="text-muted-foreground">Hash:</span>{" "}
                                <span className="font-mono">{c.hash}</span>
                              </div>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={async () => {
                                  const ok2 = await copyToClipboard(c.hash);
                                  setCopiedHash(ok2 ? c.hash : null);
                                  setTimeout(() => setCopiedHash(null), 1200);
                                }}
                              >
                                {copiedHash === c.hash ? "Copied!" : "Copy hash"}
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </>
                ) : isMember ? (
                  <div className="text-sm text-muted-foreground">
                    You are already registered for this claim-code group.
                  </div>
                ) : (
                  <>
                    <div className="text-sm text-muted-foreground">
                      Enter your claim code to register.
                    </div>

                    <div className="flex gap-2">
                      <input
                        value={claimCode}
                        onChange={(e) => setClaimCode(e.target.value)}
                        placeholder="Enter claim code"
                        className="flex-1 h-10 rounded-md border bg-background px-3 text-sm"
                      />
                      <Button
                        type="button"
                        variant="neon"
                        onClick={handleClaimWithCode}
                        disabled={claimLoading || claimCode.trim().length === 0}
                      >
                        {claimLoading ? "Claiming..." : "Claim"}
                      </Button>
                    </div>

                    {claimError ? (
                      <div className="text-sm text-destructive">Failed to claim: {claimError}</div>
                    ) : null}
                  </>
                )}
              </CardContent>
            </Card>
          )}

          <MemberList groupId={id} isOwner={isOwner} membershipType={membershipTypeFinal} />
        </TabContent>

        <TabContent value="polls">
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="text-lg font-semibold">Polls in this Group</h3>
            </div>

            {pollsError ? (
              <div className="p-4 rounded-md border border-destructive/40 text-sm text-destructive">
                Failed to load polls: {pollsError}
              </div>
            ) : null}

            {pollsLoading ? (
              <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                <Skeleton className="h-28 w-full" />
                <Skeleton className="h-28 w-full" />
                <Skeleton className="h-28 w-full" />
              </div>
            ) : groupPolls.length === 0 ? (
              <div className="text-center py-12 border border-dashed rounded-lg text-muted-foreground">
                No polls found for this group yet.
              </div>
            ) : (
              <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                {groupPolls.map((poll) => (
                  <PollCard
                    key={poll.id.toString()}
                    id={poll.id}
                    title={poll.title}
                    status={poll.status}
                    endTime={poll.endTime}
                    hasVoted={poll.hasVoted}
                    voteCount={poll.voteCount}
                    startTime={poll.startTime}
                    nowSec={nowSec}
                  />
                ))}
              </div>
            )}
          </div>
        </TabContent>
      </SimpleTabs>
    </div>
  );
}
