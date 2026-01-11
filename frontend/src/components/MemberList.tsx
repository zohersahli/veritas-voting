import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/Card";
import { Input } from "./ui/Input";
import { Button } from "./ui/Button";
import { UserPlus } from "lucide-react";
import {
  useConnection,
  useReadContract,
  useReadContracts,
  useSwitchChain,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import { veritasCoreAbi, veritasCoreAddress } from "@/lib/veritas";
import { toast } from "@/hooks/useToast";
import { isAddress, parseAbiItem, zeroAddress, type Address } from "viem";
import { CHAIN_IDS } from "@/config/contracts";
import { VERITASCORE_DEPLOY_BLOCK } from "@/config/deploy";
import { logsClient, fetchChunked, LOG_CHUNK_RANGE } from "@/lib/logsClient";

interface MemberListProps {
  groupId: bigint;
  isOwner: boolean;
  membershipType: number; // 0=Manual, 1=NFT, 2=ClaimCode
}

type GroupView =
  | {
      id: bigint;
      owner: Address;
      membershipType: number;
      name: string;
      description: string;
      createdAt: bigint;
    }
  | readonly [bigint, Address, number, string, string, bigint];

const MAX_MEMBERS_UI = 50;

const erc721Abi = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ name: "balance", type: "uint256" }],
  },
] as const;

function shorten(addr: Address): string {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function extractOwner(group: GroupView | undefined): Address | null {
  if (!group) return null;

  if (typeof group === "object" && group !== null && "owner" in group) {
    return group.owner as Address;
  }

  if (Array.isArray(group) && typeof group[1] === "string") {
    return group[1] as Address;
  }

  return null;
}

export function MemberList({ groupId, isOwner, membershipType }: MemberListProps) {
  const [newMember, setNewMember] = useState("");
  const [candidates, setCandidates] = useState<Address[]>([]);
  const [isIndexing, setIsIndexing] = useState(false);
  const [indexError, setIndexError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const { isConnected, chainId } = useConnection();
  const isCorrectChain = chainId === CHAIN_IDS.baseSepolia;

  const { switchChainAsync } = useSwitchChain();

  const { data: groupData } = useReadContract({
    chainId: CHAIN_IDS.baseSepolia,
    address: veritasCoreAddress,
    abi: veritasCoreAbi,
    functionName: "groups",
    args: [groupId],
  });

  const group = groupData as unknown as GroupView | undefined;
  const ownerAddress = extractOwner(group);

  const { data: groupNftData } = useReadContract({
    chainId: CHAIN_IDS.baseSepolia,
    address: veritasCoreAddress,
    abi: veritasCoreAbi,
    functionName: "groupNft",
    args: [groupId],
    query: { enabled: membershipType === 1 },
  });

  const groupNft = (groupNftData as Address | undefined) ?? (zeroAddress as Address);

  const write = useWriteContract();
  const txHash = write.data;

  const receipt = useWaitForTransactionReceipt({
    hash: txHash,
    chainId: CHAIN_IDS.baseSepolia,
    query: { enabled: Boolean(txHash) },
  });

  const isConfirming = receipt.isLoading;
  const isPending = write.isPending;

  const canManageMembers = membershipType === 0 && isOwner;

  // Important: do NOT block writes on wrong chain here.
  // We want the user to click, then we request a chain switch.
  const canWrite = isConnected && canManageMembers && !isPending && !isConfirming;

  useEffect(() => {
    let cancelled = false;

    async function run() {
      setIndexError(null);
      setIsIndexing(true);

      try {
        const fromBlock = VERITASCORE_DEPLOY_BLOCK;
        const latest = await logsClient.getBlockNumber({ cacheTime: 0 });

        if (membershipType === 0) {
          const ev = parseAbiItem(
            "event ManualMemberSet(uint256 indexed groupId, address indexed member, bool isMember)"
          );

          const logs = await fetchChunked(
            fromBlock,
            latest,
            LOG_CHUNK_RANGE,
            (fb, tb) =>
              logsClient.getLogs({
                address: veritasCoreAddress,
                event: ev,
                args: { groupId },
                fromBlock: fb,
                toBlock: tb,
              })
          );

          const state = new Map<Address, boolean>();
          for (const l of logs) {
            const member = (l.args?.member ?? zeroAddress) as Address;
            const isMem = Boolean(l.args?.isMember ?? false);
            state.set(member, isMem);
          }

          const list: Address[] = [];
          for (const [m, ok] of state.entries()) if (ok) list.push(m);

          if (!cancelled) setCandidates(list);
          return;
        }

        if (membershipType === 2) {
          const claimedEv = parseAbiItem(
            "event ClaimCodeClaimed(uint256 indexed groupId, bytes32 indexed codeHash, address indexed member)"
          );
          const manualEv = parseAbiItem(
            "event ManualMemberSet(uint256 indexed groupId, address indexed member, bool isMember)"
          );

          const claimed = await fetchChunked(
            fromBlock,
            latest,
            LOG_CHUNK_RANGE,
            (fb, tb) =>
              logsClient.getLogs({
                address: veritasCoreAddress,
                event: claimedEv,
                args: { groupId },
                fromBlock: fb,
                toBlock: tb,
              })
          );

          const manual = await fetchChunked(
            fromBlock,
            latest,
            LOG_CHUNK_RANGE,
            (fb, tb) =>
              logsClient.getLogs({
                address: veritasCoreAddress,
                event: manualEv,
                args: { groupId },
                fromBlock: fb,
                toBlock: tb,
              })
          );

          const state = new Map<Address, boolean>();

          for (const l of claimed) {
            const member = (l.args?.member ?? zeroAddress) as Address;
            state.set(member, true);
          }

          for (const l of manual) {
            const member = (l.args?.member ?? zeroAddress) as Address;
            const isMem = Boolean(l.args?.isMember ?? false);
            state.set(member, isMem);
          }

          const list: Address[] = [];
          for (const [m, ok] of state.entries()) if (ok) list.push(m);

          if (!cancelled) setCandidates(list);
          return;
        }

        if (membershipType === 1) {
          const regEv = parseAbiItem(
            "event NftMemberRegistered(uint256 indexed groupId, address indexed member)"
          );
          const unregEv = parseAbiItem(
            "event NftMemberUnregistered(uint256 indexed groupId, address indexed member)"
          );

          const regs = await fetchChunked(
            fromBlock,
            latest,
            LOG_CHUNK_RANGE,
            (fb, tb) =>
              logsClient.getLogs({
                address: veritasCoreAddress,
                event: regEv,
                args: { groupId },
                fromBlock: fb,
                toBlock: tb,
              })
          );

          const unregs = await fetchChunked(
            fromBlock,
            latest,
            LOG_CHUNK_RANGE,
            (fb, tb) =>
              logsClient.getLogs({
                address: veritasCoreAddress,
                event: unregEv,
                args: { groupId },
                fromBlock: fb,
                toBlock: tb,
              })
          );

          const set = new Set<Address>();
          for (const l of regs) set.add((l.args?.member ?? zeroAddress) as Address);
          for (const l of unregs) set.delete((l.args?.member ?? zeroAddress) as Address);

          if (!cancelled) setCandidates(Array.from(set));
          return;
        }

        if (!cancelled) setCandidates([]);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Failed to index members";
        if (!cancelled) setIndexError(msg);
      } finally {
        if (!cancelled) setIsIndexing(false);
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [groupId, membershipType, refreshKey]);

  const nftCandidates = useMemo(() => {
    if (membershipType !== 1) return [];
    return candidates.slice(0, MAX_MEMBERS_UI);
  }, [candidates, membershipType]);

  const nftVerification = useReadContracts({
    contracts:
      membershipType === 1 && groupNft !== zeroAddress && nftCandidates.length > 0
        ? [
            ...nftCandidates.map((m) => ({
              chainId: CHAIN_IDS.baseSepolia,
              address: veritasCoreAddress,
              abi: veritasCoreAbi,
              functionName: "nftRegistered" as const,
              args: [groupId, m] as const,
            })),
            ...nftCandidates.map((m) => ({
              chainId: CHAIN_IDS.baseSepolia,
              address: groupNft,
              abi: erc721Abi,
              functionName: "balanceOf" as const,
              args: [m] as const,
            })),
          ]
        : [],
    query: {
      enabled: membershipType === 1 && groupNft !== zeroAddress && nftCandidates.length > 0,
    },
  });

  const verifiedNftMembers = useMemo(() => {
    if (membershipType !== 1) return [] as Address[];
    if (groupNft === zeroAddress) return [] as Address[];

    const half = nftCandidates.length;
    const out: Address[] = [];

    for (let i = 0; i < half; i++) {
      const reg = Boolean(nftVerification.data?.[i]?.result ?? false);
      const balRaw = nftVerification.data?.[half + i]?.result;
      const bal = typeof balRaw === "bigint" ? balRaw : 0n;

      if (reg && bal > 0n) out.push(nftCandidates[i]);
    }

    return out;
  }, [membershipType, groupNft, nftCandidates, nftVerification.data]);

  const members = useMemo(() => {
    const list =
      membershipType === 1 ? verifiedNftMembers : (candidates.slice(0, MAX_MEMBERS_UI) as Address[]);

    const dedup = new Set<Address>();
    const out: Address[] = [];

    if (ownerAddress) {
      dedup.add(ownerAddress);
      out.push(ownerAddress);
    }

    for (const m of list) {
      if (!dedup.has(m)) {
        dedup.add(m);
        out.push(m);
      }
    }

    return out;
  }, [candidates, membershipType, ownerAddress, verifiedNftMembers]);

  const helperText = useMemo(() => {
    if (membershipType === 1) return "NFT membership (registered + must hold NFT now)";
    if (membershipType === 2) return "Claim Codes (claimed + manual overrides)";
    return "Manual membership (owner managed)";
  }, [membershipType]);

  const handleCopy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Copied");
    } catch {
      toast.error("Copy failed");
    }
  };

  const handleAddMember = async () => {
    const trimmed = newMember.trim();

    if (!isConnected) return toast.error("Connect your wallet first");
    if (!isOwner) return toast.error("Only group owner can add members");
    if (membershipType !== 0) return toast.error("This group is not manual");
    if (!isAddress(trimmed)) return toast.error("Invalid address");

    if (ownerAddress && trimmed.toLowerCase() === ownerAddress.toLowerCase()) {
      return toast.error("Cannot add the owner");
    }

    if (!isCorrectChain) {
      try {
        await switchChainAsync({ chainId: CHAIN_IDS.baseSepolia });
      } catch (err) {
        console.error("Failed to switch chain:", err);
        return toast.error("Network switch rejected");
      }
    }

    write.mutate(
      {
        chainId: CHAIN_IDS.baseSepolia,
        address: veritasCoreAddress,
        abi: veritasCoreAbi,
        functionName: "setManualMember",
        args: [groupId, trimmed as Address, true],
      },
      {
        onSuccess: () => {
          toast.success("Transaction sent");
          setNewMember("");
        },
        onError: (err) => {
          toast.error(err?.message ?? "Transaction failed");
        },
      }
    );
  };

  const handleRemoveMember = async (member: Address) => {
    if (!isConnected) return toast.error("Connect your wallet first");
    if (!isOwner) return toast.error("Only group owner can remove members");
    if (membershipType !== 0) return toast.error("This group is not manual");

    if (ownerAddress && member.toLowerCase() === ownerAddress.toLowerCase()) {
      return toast.error("Cannot remove the owner");
    }

    const ok = window.confirm(`Remove member ${shorten(member)}?`);
    if (!ok) return;

    if (!isCorrectChain) {
      try {
        await switchChainAsync({ chainId: CHAIN_IDS.baseSepolia });
      } catch (err) {
        console.error("Failed to switch chain:", err);
        return toast.error("Network switch rejected");
      }
    }

    write.mutate(
      {
        chainId: CHAIN_IDS.baseSepolia,
        address: veritasCoreAddress,
        abi: veritasCoreAbi,
        functionName: "setManualMember",
        args: [groupId, member, false],
      },
      {
        onSuccess: () => {
          toast.success("Member removed");
        },
        onError: (err) => {
          toast.error(err?.message ?? "Transaction failed");
        },
      }
    );
  };

  useEffect(() => {
    if (receipt.isSuccess) {
      setRefreshKey((x) => x + 1);
    }
  }, [receipt.isSuccess]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Members</CardTitle>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="text-sm text-muted-foreground">{helperText}</div>

        {membershipType === 0 ? (
          <>
            {!isConnected ? (
              <div className="text-sm text-muted-foreground">Connect your wallet to manage members.</div>
            ) : !isCorrectChain ? (
              <div className="text-sm text-muted-foreground">
                Wrong network. Switching will be requested when you click an action.
              </div>
            ) : null}

            {isOwner ? (
              <div className="flex gap-2">
                <Input placeholder="0x..." value={newMember} onChange={(e) => setNewMember(e.target.value)} />
                <Button onClick={handleAddMember} disabled={!canWrite}>
                  {isPending || isConfirming ? (
                    "Adding..."
                  ) : (
                    <>
                      <UserPlus className="mr-2 h-4 w-4" /> Add
                    </>
                  )}
                </Button>
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">Only the group owner can add members.</div>
            )}
          </>
        ) : null}

        <div className="flex items-center justify-between">
          <div className="text-sm font-medium">
            List ({members.length}
            {candidates.length > MAX_MEMBERS_UI ? ` shown of ${candidates.length}+` : ""})
          </div>

          <Button variant="outline" size="sm" onClick={() => setRefreshKey((x) => x + 1)} disabled={isIndexing}>
            {isIndexing ? "Refreshing..." : "Refresh"}
          </Button>
        </div>

        {indexError ? (
          <div className="text-sm text-red-500">Failed to load members: {indexError}</div>
        ) : isIndexing ? (
          <div className="text-sm text-muted-foreground">Loading members...</div>
        ) : members.length === 0 ? (
          <div className="text-sm text-muted-foreground">No members found yet.</div>
        ) : (
          <div className="space-y-2">
            {members.map((m) => {
              const isOwnerRow = ownerAddress != null && m.toLowerCase() === ownerAddress.toLowerCase();
              const showRemove = membershipType === 0 && isOwner && !isOwnerRow;
              const disableActions = isPending || isConfirming;

              return (
                <div key={m} className="flex items-center justify-between rounded-md border p-2">
                  <div className="flex items-center gap-2">
                    <code className="text-sm">{shorten(m)}</code>
                    {isOwnerRow ? (
                      <span className="text-xs rounded-full px-2 py-0.5 bg-primary/10 text-primary">
                        Owner
                      </span>
                    ) : null}
                  </div>

                  <div className="flex items-center gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => void handleCopy(m)}
                      disabled={disableActions}
                    >
                      Copy
                    </Button>

                    {showRemove ? (
                      <Button
                        variant="outline"
                        size="sm"
                        className="border-red-500/40 text-red-500 hover:bg-red-500/10"
                        onClick={() => void handleRemoveMember(m)}
                        disabled={disableActions || !canWrite}
                      >
                        Remove
                      </Button>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="text-xs text-muted-foreground">
          Note: There is no getMembers() in the contract, so this list is reconstructed from events.
        </div>
      </CardContent>
    </Card>
  );
}
