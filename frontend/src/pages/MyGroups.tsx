import { useMemo, useState } from "react";
import type { Abi } from "viem";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useReadContract, useReadContracts, useConnection } from "wagmi";
import { veritasCoreAbi, veritasCoreAddress } from "@/lib/veritas";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { GroupCard } from "@/components/GroupCard";
import { EmptyState } from "@/components/EmptyState";
import { CardSkeleton } from "@/components/LoadingSkeleton";
import { Plus, Search, Users, UserCheck } from "lucide-react";
import { useDebounce } from "@/hooks/useDebounce";
import { CHAIN_IDS } from "@/config/contracts";

type GroupTuple = readonly [
  bigint, // id
  `0x${string}`, // owner
  number, // membershipType
  string, // name
  string, // description
  bigint // createdAt
];

type UiGroup = {
  id: string; // groupId as string
  name: string;
  description: string;
  memberCount: number;
  membershipType: number;
  isMember: boolean;
  owner: `0x${string}`;
  nftAddress?: `0x${string}`;
};

type ExtraReadContract = {
  chainId: number;
  address: `0x${string}`;
  abi: Abi;
  functionName: string;
  args: readonly [bigint];
};

type MyGroupsNavState = {
  createdGroupId?: string;
};

const MAX_GROUPS_TO_FETCH = 200;

export function MyGroups() {
  const navigate = useNavigate();
  const location = useLocation();

  const [activeTab, setActiveTab] = useState<"owned" | "member">("owned");
  const [searchQuery, setSearchQuery] = useState("");
  const debouncedSearch = useDebounce(searchQuery, 300);

  const { address, status } = useConnection();
  const isConnected = status === "connected" && Boolean(address);

  const navState = location.state as MyGroupsNavState | null;
  const hintedNextGroupId = useMemo(() => {
    // If CreateGroup navigated here, it passes createdGroupId. We use it as a minimum list bound.
    if (!navState?.createdGroupId) return null;

    try {
      const id = BigInt(navState.createdGroupId);
      return id + 1n;
    } catch {
      return null;
    }
  }, [navState]);

  const { data: nextGroupId, isLoading: isNextGroupIdLoading } = useReadContract({
    chainId: CHAIN_IDS.baseSepolia,
    address: veritasCoreAddress,
    abi: veritasCoreAbi,
    functionName: "nextGroupId",
    query: {
      enabled: true,
      staleTime: 0,
      refetchOnMount: "always",
      refetchOnWindowFocus: "always",
    },
  });

  const totalGroups = useMemo(() => {
    const fromChain = typeof nextGroupId === "bigint" ? nextGroupId : 0n;
    const fromHint = hintedNextGroupId ?? 0n;
    const best = fromChain > fromHint ? fromChain : fromHint;

    const asNumber = Number(best);
    if (!Number.isFinite(asNumber) || asNumber < 0) return 0;
    return asNumber;
  }, [nextGroupId, hintedNextGroupId]);

  const groupIds = useMemo(() => {
    const safeTotal = Number.isFinite(totalGroups) ? totalGroups : 0;
    const count = Math.min(Math.max(safeTotal, 0), MAX_GROUPS_TO_FETCH);
    return Array.from({ length: count }, (_, i) => BigInt(i));
  }, [totalGroups]);

  const groupContracts = useMemo(() => {
    return groupIds.map((gid) => ({
      chainId: CHAIN_IDS.baseSepolia,
      address: veritasCoreAddress,
      abi: veritasCoreAbi,
      functionName: "groups" as const,
      args: [gid] as const,
    }));
  }, [groupIds]);

  const { data: groupsData, isLoading: isGroupsLoading } = useReadContracts({
    contracts: groupContracts,
    query: {
      enabled: groupContracts.length > 0,
      staleTime: 0,
      refetchOnMount: "always",
      refetchOnWindowFocus: "always",
    },
  });

  const baseGroups = useMemo(() => {
    if (!groupsData || groupsData.length === 0) return [];

    const out: Array<{
      groupId: bigint;
      owner: `0x${string}`;
      membershipType: number;
      name: string;
      description: string;
    }> = [];

    for (let i = 0; i < groupsData.length; i++) {
      const item = groupsData[i];
      const result = item?.result as unknown as GroupTuple | undefined;
      if (!result) continue;

      const [id, owner, membershipType, name, description] = result;

      if (!name || name.trim().length === 0) continue;

      out.push({
        groupId: id,
        owner,
        membershipType,
        name,
        description,
      });
    }

    return out;
  }, [groupsData]);

  const extraAbi = veritasCoreAbi as unknown as Abi;

  const metaContracts = useMemo((): ExtraReadContract[] => {
    if (baseGroups.length === 0) return [];

    const contracts: ExtraReadContract[] = [];

    for (const g of baseGroups) {
      contracts.push({
        chainId: CHAIN_IDS.baseSepolia,
        address: veritasCoreAddress,
        abi: extraAbi,
        functionName: "groupNft",
        args: [g.groupId],
      });

      contracts.push({
        chainId: CHAIN_IDS.baseSepolia,
        address: veritasCoreAddress,
        abi: extraAbi,
        functionName: "_groupMemberCount",
        args: [g.groupId],
      });
    }

    return contracts;
  }, [baseGroups, extraAbi]);

  const { data: metaData, isLoading: isMetaLoading } = useReadContracts({
    contracts: metaContracts,
    query: {
      enabled: metaContracts.length > 0,
      staleTime: 0,
      refetchOnMount: "always",
      refetchOnWindowFocus: "always",
    },
  });

  const metaByGroupId = useMemo(() => {
    const nftById = new Map<string, `0x${string}` | undefined>();
    const countById = new Map<string, bigint>();

    if (!metaData || metaData.length === 0) return { nftById, countById };

    for (let i = 0; i < metaData.length; i += 2) {
      const nftItem = metaData[i];
      const cntItem = metaData[i + 1];

      const groupIndex = Math.floor(i / 2);
      const g = baseGroups[groupIndex];
      if (!g) continue;

      const gid = g.groupId.toString();

      const nft = nftItem?.result;
      if (typeof nft === "string") nftById.set(gid, nft as `0x${string}`);
      else nftById.set(gid, undefined);

      const cnt = cntItem?.result;
      if (typeof cnt === "bigint") countById.set(gid, cnt);
      else countById.set(gid, 0n);
    }

    return { nftById, countById };
  }, [metaData, baseGroups]);

  const allGroups: UiGroup[] = useMemo(() => {
    if (baseGroups.length === 0) return [];

    const out: UiGroup[] = [];

    for (const g of baseGroups) {
      const gid = g.groupId.toString();
      const memberCountBig = metaByGroupId.countById.get(gid) ?? 0n;
      const nftAddress = metaByGroupId.nftById.get(gid);

      out.push({
        id: gid,
        name: g.name,
        description: g.description,
        membershipType: g.membershipType,
        memberCount: Number(memberCountBig),
        owner: g.owner,
        nftAddress,
        isMember: Boolean(address && g.owner.toLowerCase() === address.toLowerCase()),
      });
    }

    return out;
  }, [baseGroups, metaByGroupId, address]);

  const displayGroups = useMemo(() => {
    if (!address) return activeTab === "owned" ? [] : allGroups;

    const isOwner = (g: UiGroup) => g.owner.toLowerCase() === address.toLowerCase();
    return activeTab === "owned" ? allGroups.filter(isOwner) : allGroups.filter((g) => !isOwner(g));
  }, [activeTab, allGroups, address]);

  const filteredGroups = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    if (!q) return displayGroups;
    
    // Check if search is numeric (potential ID)
    const isNumeric = /^\d+$/.test(q);
    
    return displayGroups.filter((g) => {
      // Exact ID match (case-insensitive comparison)
      if (isNumeric && g.id === q) return true;
      // Name or description search (existing logic)
      return g.name.toLowerCase().includes(q) || g.description.toLowerCase().includes(q);
    });
  }, [displayGroups, debouncedSearch]);

  const isLoading = isNextGroupIdLoading || isGroupsLoading || isMetaLoading;

  const ownedCount = useMemo(() => {
    if (!address) return 0;
    return allGroups.filter((g) => g.owner.toLowerCase() === address.toLowerCase()).length;
  }, [allGroups, address]);

  const memberCount = useMemo(() => {
    if (!address) return allGroups.length;
    return allGroups.filter((g) => g.owner.toLowerCase() !== address.toLowerCase()).length;
  }, [allGroups, address]);

  return (
    <div className="space-y-8">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold">My Groups</h1>
          <p className="text-muted-foreground">Manage your groups and memberships</p>
        </div>

        {isConnected ? (
          <Button asChild variant="neon">
            <Link to="/groups/create">
              <Plus className="mr-2 h-4 w-4" /> Create Group
            </Link>
          </Button>
        ) : (
          <div className="text-sm text-muted-foreground">Connect your wallet to create groups</div>
        )}
      </div>

      <div className="flex space-x-1 border-b">
        <button
          onClick={() => setActiveTab("owned")}
          className={`px-6 py-3 text-sm font-medium border-b-2 transition-colors ${
            activeTab === "owned"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <Users className="inline-block mr-2 h-4 w-4" />
          Owned ({ownedCount})
        </button>

        <button
          onClick={() => setActiveTab("member")}
          className={`px-6 py-3 text-sm font-medium border-b-2 transition-colors ${
            activeTab === "member"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <UserCheck className="inline-block mr-2 h-4 w-4" />
          Member ({memberCount})
        </button>
      </div>

      <div className="max-w-md">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search groups..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>
      </div>

      {isLoading ? (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          <CardSkeleton />
          <CardSkeleton />
          <CardSkeleton />
        </div>
      ) : filteredGroups.length > 0 ? (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {filteredGroups.map((group) => (
            <GroupCard
              key={group.id}
              id={group.id}
              name={group.name}
              description={group.description}
              memberCount={group.memberCount}
              membershipType={group.membershipType}
              isMember={group.isMember}
            />
          ))}
        </div>
      ) : (
        <EmptyState
          icon={activeTab === "owned" ? Users : UserCheck}
          title={`No ${activeTab} groups found`}
          description={
            !address && activeTab === "owned"
              ? "Connect your wallet to view groups you own"
              : searchQuery
              ? "Try adjusting your search query"
              : activeTab === "owned"
              ? "Create your first group to get started"
              : "No groups found"
          }
          actionLabel={activeTab === "owned" && isConnected ? "Create Group" : undefined}
          onAction={activeTab === "owned" && isConnected ? () => navigate("/groups/create") : undefined}
        />
      )}

      {!isLoading && totalGroups > 0 && (
        <div className="bg-primary/5 border border-primary/20 rounded-lg p-6">
          <h3 className="font-semibold mb-2">About Groups</h3>
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li>
              • <strong>Owned:</strong> Groups you created and manage
            </li>
            <li>
              • <strong>Member:</strong> Currently shows groups you do not own (membership detection can be added next)
            </li>
            <li>• Group owners can create polls and manage members</li>
            <li>• Members can vote in polls created for the group</li>
          </ul>
        </div>
      )}
    </div>
  );
}
