import { Children, isValidElement, useEffect, useMemo, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import type { Abi } from "viem";
import { createPublicClient, http, parseAbiItem, keccak256, toBytes } from "viem";
import { baseSepolia } from "viem/chains";
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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/LoadingSkeleton";
import { MemberList } from "@/components/MemberList";
import { Badge } from "@/components/ui/Badge";
import { Plus } from "lucide-react";

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

  //Sync internal active tab when defaultValue changes after async data loads.
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

const logsClient = createPublicClient({
  chain: baseSepolia,
  transport: http("https://sepolia.base.org"),
});

type Bytes32 = `0x${string}`;

// Convert claim code string to bytes32 using keccak256.
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
  //Simple random one-time claim code generator
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // avoid confusing chars (I,O,0,1)
  const bytes = new Uint8Array(length);
  window.crypto.getRandomValues(bytes);

  let out = "";
  for (let i = 0; i < length; i++) {
    out += alphabet[bytes[i] % alphabet.length];
  }
  return out;
}

// Keep under provider max range (100k)
const MAX_BLOCK_RANGE = 99_000n;

type PollCreatedDecodedLog = {
  args?: { pollId?: bigint };
  blockNumber?: bigint | null;
  logIndex?: number | null;
};

export function GroupDetails() {
  const { groupId } = useParams();
  const { address, status } = useConnection();
  const isConnected = status === "connected";

  const chainId = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();

  const { id, hasValidGroupId } = useMemo(() => {
    try {
      if (typeof groupId !== "string" || groupId.length === 0) return { id: 0n, hasValidGroupId: false };
      return { id: BigInt(groupId), hasValidGroupId: true };
    } catch {
      return { id: 0n, hasValidGroupId: false };
    }
  }, [groupId]);

  const extraAbi = veritasCoreAbi as unknown as Abi;

  const { data: group, isLoading: isGroupLoading } = useReadContract({
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
    address: veritasCoreAddress,
    abi: extraAbi,
    functionName: "_groupMemberCount",
    args: [id],
    query: { enabled: hasValidGroupId },
  });

  const { data: nftAddressData } = useReadContract({
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
    address: veritasCoreAddress,
    abi: veritasCoreAbi,
    functionName: "isMember",
    args: [id, (address ?? "0x0000000000000000000000000000000000000000") as `0x${string}`],
    query: { enabled: hasValidGroupId && isConnected && !!address },
  });

  const isMember = isMemberData === true;
  const isCorrectChain = chainId === CHAIN_IDS.baseSepolia;

  const [claimCode, setClaimCode] = useState("");
  const [claimLoading, setClaimLoading] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);

  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  async function copyToClipboard(text: string): Promise<boolean> {
    // English: Clipboard API
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
  const [copiedHash, setCopiedHash] = useState<string | null>(null);
  const [batchCount, setBatchCount] = useState(1);

  // Storage key for this group's claim codes
  const storageKey = useMemo(() => `claimCodes_${id.toString()}`, [id]);

  // Load saved codes from localStorage on mount
  useEffect(() => {
    if (!hasValidGroupId) return;
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const codes = JSON.parse(saved) as ClaimCodeItem[];
        setGeneratedCodes(codes);
      }
    } catch (e) {
      console.error("Failed to load saved codes:", e);
    }
  }, [storageKey, hasValidGroupId]);

  // Save codes to localStorage whenever they change
  useEffect(() => {
    if (!hasValidGroupId || generatedCodes.length === 0) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify(generatedCodes));
    } catch (e) {
      console.error("Failed to save codes:", e);
    }
  }, [generatedCodes, storageKey, hasValidGroupId]);

  // Download all codes as CSV
  function downloadAllCodesAsCSV() {
    if (generatedCodes.length === 0) return;

    const headers = ["Code", "Hash", "Created At"];
    const rows = generatedCodes.map((c) => [
      c.code,
      c.hash,
      new Date(c.createdAt).toISOString(),
    ]);

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

  const [pollIds, setPollIds] = useState<bigint[]>([]);
  const [pollIdsLoading, setPollIdsLoading] = useState(false);
  const [pollIdsError, setPollIdsError] = useState<string | null>(null);

  async function handleRegisterWithNft() {
    // Guard chain before write to prevent wrong-network tx.
    if (!isConnected || !address) return;

    try {
      if (!isCorrectChain) {
        await switchChainAsync({ chainId: CHAIN_IDS.baseSepolia });
      }

      await writeContractAsync({
        address: veritasCoreAddress,
        abi: veritasCoreAbi,
        functionName: "registerWithNft",
        args: [id],
      });

      await refetchIsMember();
    } catch (e) {
      console.error("registerWithNft failed:", e);
    }
  }

  async function handleClaimWithCode() {
    if (!isConnected || !address) return;

    try {
      setClaimLoading(true);
      setClaimError(null);

      if (!isCorrectChain) {
        await switchChainAsync({ chainId: CHAIN_IDS.baseSepolia });
      }

      const codeHash = claimCodeToHash(claimCode);

      await writeContractAsync({
        address: veritasCoreAddress,
        abi: veritasCoreAbi,
        functionName: "claimWithCode",
        args: [id, codeHash],
      });

      await refetchIsMember();
      setClaimCode("");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("claimWithCode failed:", e);
      setClaimError(msg);
    } finally {
      setClaimLoading(false);
    }
  }

  async function handleOwnerCreateClaimCode() {
    // Owner-only action for ClaimCode groups
    if (!isConnected || !address) return;
    if (!isOwner) return;
    if (membershipTypeFinal !== 2) return;
    if (batchCount < 1 || batchCount > 1000) {
      setOwnerCreateError("Batch count must be between 1 and 1000");
      return;
    }

    try {
      setOwnerCreateLoading(true);
      setOwnerCreateError(null);

      if (!isCorrectChain) {
        await switchChainAsync({ chainId: CHAIN_IDS.baseSepolia });
      }

      // Generate codes locally (off-chain)
      const newCodes: ClaimCodeItem[] = [];
      for (let i = 0; i < batchCount; i++) {
        const code = generateClaimCode(12);
        const hash = claimCodeToHash(code);
        newCodes.push({ code, hash, createdAt: Date.now() });
      }

      // Upload hashes to blockchain (one transaction per hash)
      // Note: This might take time for large batches
      for (const { hash } of newCodes) {
        await writeContractAsync({
          address: veritasCoreAddress,
          abi: veritasCoreAbi,
          functionName: "createClaimCode",
          args: [id, hash],
        });
      }

      // Add all codes to state (localStorage will be updated via useEffect)
      setGeneratedCodes((prev) => [...newCodes, ...prev]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("createClaimCode failed:", e);
      setOwnerCreateError(msg);
    } finally {
      setOwnerCreateLoading(false);
    }
  }

  useEffect(() => {
    if (!hasValidGroupId) return;

    let cancelled = false;

    (async () => {
      setPollIdsLoading(true);
      setPollIdsError(null);

      try {
        const latestBlock = await logsClient.getBlockNumber();

        const allLogs: Awaited<ReturnType<typeof logsClient.getLogs>> = [];
        let fromBlock = VERITASCORE_DEPLOY_BLOCK;

        while (fromBlock <= latestBlock) {
          if (cancelled) break;

          let toBlock = fromBlock + MAX_BLOCK_RANGE - 1n;
          if (toBlock > latestBlock) toBlock = latestBlock;

          const chunk = await logsClient.getLogs({
            address: veritasCoreAddress,
            event: POLL_CREATED_EVENT,
            args: { groupId: id },
            fromBlock,
            toBlock,
          });

          allLogs.push(...chunk);
          fromBlock = toBlock + 1n;
        }

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
          const pid = (l as unknown as PollCreatedDecodedLog).args?.pollId;
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
                            if (!isNaN(val) && val >= 1 && val <= 1000) {
                              setBatchCount(val);
                            }
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
                          <div
                            key={c.hash}
                            className="rounded-md border bg-background/40 p-3 space-y-2"
                          >
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
                                  const ok = await copyToClipboard(c.code);
                                  setCopiedCode(ok ? c.code : null);
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
                                  const ok = await copyToClipboard(c.hash);
                                  setCopiedHash(ok ? c.hash : null);
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

            {pollIdsError ? (
              <div className="p-4 rounded-md border border-destructive/40 text-sm text-destructive">
                Failed to load polls: {pollIdsError}
              </div>
            ) : null}

            {pollIdsLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-14 w-full" />
                <Skeleton className="h-14 w-full" />
                <Skeleton className="h-14 w-full" />
              </div>
            ) : pollIds.length === 0 ? (
              <div className="text-center py-12 border border-dashed rounded-lg text-muted-foreground">
                No polls found for this group yet.
              </div>
            ) : (
              <div className="space-y-2">
                {pollIds.map((pid) => (
                  <Card key={pid.toString()}>
                    <CardContent className="py-4 flex items-center justify-between">
                      <div className="space-y-1">
                        <div className="text-sm font-medium">Poll ID: {pid.toString()}</div>
                        <div className="text-xs text-muted-foreground">From PollCreated logs</div>
                      </div>

                      <Button asChild variant="ghost">
                        <Link to={`/polls/${pid.toString()}`}>Open</Link>
                      </Button>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
        </TabContent>
      </SimpleTabs>
    </div>
  );
}
