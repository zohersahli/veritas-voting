import { useCallback, useState } from "react";
import { useReadContracts } from "wagmi";
import { Link, useNavigate } from "react-router-dom";
import { Plus, Users, Vote, BarChart, Search } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { StatsCard } from "@/components/StatsCard";
import { veritasCoreAbi, veritasCoreAddress } from "@/lib/veritas";
import { CHAIN_IDS } from "@/config/contracts";

export function Dashboard() {
  const navigate = useNavigate();
  const [searchId, setSearchId] = useState("");

  const handleSearch = () => {
    const trimmed = searchId.trim();
    if (trimmed) {
      navigate(`/groups/${trimmed}`);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      handleSearch();
    }
  };

  const { data: stats, isLoading } = useReadContracts({
    contracts: [
      {
        chainId: CHAIN_IDS.baseSepolia,
        address: veritasCoreAddress,
        abi: veritasCoreAbi,
        functionName: "nextGroupId",
      },
      {
        chainId: CHAIN_IDS.baseSepolia,
        address: veritasCoreAddress,
        abi: veritasCoreAbi,
        functionName: "nextPollId",
      },
    ],
  });

  const totalGroups = stats?.[0]?.result ? Number(stats[0].result) : 0;
  const totalPolls = stats?.[1]?.result ? Number(stats[1].result) : 0;

  const prefetchCreateGroup = useCallback(() => {
    void import("@/pages/CreateGroup").catch(() => {});
  }, []);

  const prefetchCreatePoll = useCallback(() => {
    void import("@/pages/CreatePoll").catch(() => {});
  }, []);

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <section className="flex flex-col md:flex-row justify-between items-center gap-6 bg-gradient-to-r from-primary/10 via-purple-500/10 to-transparent p-8 rounded-2xl border border-primary/10">
        <div className="space-y-2">
          <h1 className="text-4xl font-bold tracking-tight">Welcome to Veritas</h1>
          <p className="text-xl text-muted-foreground max-w-2xl">
            The cross-chain voting platform for the decentralized future. Create
            groups, launch polls, and govern with transparency on Base.
          </p>
        </div>

        <div className="flex gap-4">
          <Button asChild size="lg" variant="neon">
            <Link
              to="/groups/create"
              onMouseEnter={prefetchCreateGroup}
              onFocus={prefetchCreateGroup}
              onTouchStart={prefetchCreateGroup}
            >
              <Plus className="mr-2 h-5 w-5" /> Create Group
            </Link>
          </Button>

          <Button asChild size="lg" variant="outline">
            <Link
              to="/polls/create"
              onMouseEnter={prefetchCreatePoll}
              onFocus={prefetchCreatePoll}
              onTouchStart={prefetchCreatePoll}
            >
              <Vote className="mr-2 h-5 w-5" /> Create Poll
            </Link>
          </Button>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        <StatsCard
          title="Total Groups"
          value={isLoading ? "..." : totalGroups}
          icon={Users}
          description="Communities on Veritas"
        />
        <StatsCard
          title="Total Polls"
          value={isLoading ? "..." : totalPolls}
          icon={Vote}
          description="Decisions made"
        />
        <StatsCard
          title="Active Votes"
          value="-"
          icon={BarChart}
          description="Live participation"
        />
      </section>

      <section className="bg-card border rounded-lg p-6">
        <div className="flex flex-col md:flex-row gap-4 items-center">
          <div className="flex-1 w-full">
            <Input
              placeholder="Search group by ID (e.g., 1, 2, 3...)"
              value={searchId}
              onChange={(e) => setSearchId(e.target.value)}
              onKeyPress={handleKeyPress}
              className="w-full"
            />
          </div>
          <Button
            onClick={handleSearch}
            disabled={!searchId.trim()}
            variant="neon"
            className="w-full md:w-auto"
          >
            <Search className="mr-2 h-4 w-4" />
            Search Group
          </Button>
        </div>
      </section>

      <div className="grid md:grid-cols-2 gap-8">
        <section className="space-y-4">
          <div className="flex justify-between items-center">
            <h2 className="text-2xl font-bold">Recent Groups</h2>
            <Button variant="link" asChild>
              <Link to="/my-groups">View All</Link>
            </Button>
          </div>

          <div className="text-muted-foreground text-sm">
            View your groups from <Link to="/my-groups" className="underline">My Groups</Link>
          </div>
        </section>

        <section className="space-y-4">
          <div className="flex justify-between items-center">
            <h2 className="text-2xl font-bold">Active Polls</h2>
            <Button variant="link" asChild>
              <Link to="/my-polls">View All</Link>
            </Button>
          </div>

          <div className="text-muted-foreground text-sm">
            View your polls from <Link to="/my-polls" className="underline">My Polls</Link>
          </div>
        </section>
      </div>
    </div>
  );
}
