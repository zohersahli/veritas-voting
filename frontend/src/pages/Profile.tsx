import { useBalance, useConnection, useDisconnect } from "wagmi";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { CopyButton } from "@/components/CopyButton";
import { Badge } from "@/components/ui/Badge";
import { shortenAddress, formatWeiToEth } from "@/utils/format";
import { ExternalLink, Wallet, LogOut, Settings, Bell, Palette } from "lucide-react";

function getChainName(id: number) {
  switch (id) {
    case 84532:
      return "Base Sepolia";
    case 11155111:
      return "Ethereum Sepolia";
    case 1:
      return "Ethereum Mainnet";
    case 8453:
      return "Base";
    default:
      return `Chain ${id}`;
  }
}

function getExplorerUrl(addr: string, chainId: number) {
  if (chainId === 84532) return `https://sepolia.basescan.org/address/${addr}`;
  if (chainId === 11155111) return `https://sepolia.etherscan.io/address/${addr}`;
  return "#";
}

export function Profile() {
  const { address, chainId, isConnected } = useConnection();
  const disconnect = useDisconnect();

  const { data: balance } = useBalance({
    address,
    query: { enabled: isConnected && Boolean(address) },
  });

  if (!isConnected || !address) {
    return (
      <div className="max-w-2xl mx-auto">
        <Card>
          <CardContent className="pt-6 text-center py-12">
            <Wallet className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
            <h2 className="text-xl font-semibold mb-2">Connect Your Wallet</h2>
            <p className="text-muted-foreground">Please connect your wallet to view your profile</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const chainIdSafe = chainId ?? 84532;

  const handleDisconnect = () => {
    // wagmi v3: useDisconnect is a mutation. variables object is optional but accepted.
    disconnect.mutate({});
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div>
        <h1 className="text-3xl font-bold">Profile</h1>
        <p className="text-muted-foreground">Manage your wallet and preferences</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wallet className="h-5 w-5" />
            Wallet Information
          </CardTitle>
        </CardHeader>

        <CardContent className="space-y-6">
          <div className="space-y-2">
            <label className="text-sm font-medium text-muted-foreground">Wallet Address</label>
            <div className="flex items-center justify-between p-4 bg-secondary/20 rounded-lg">
              <span className="font-mono text-sm">{shortenAddress(address)}</span>
              <div className="flex gap-2">
                <CopyButton value={address} />
                <Button variant="ghost" size="sm" asChild>
                  <a href={getExplorerUrl(address, chainIdSafe)} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="h-4 w-4" />
                  </a>
                </Button>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-muted-foreground">Balance</label>
            <div className="p-4 bg-secondary/20 rounded-lg">
              <p className="text-2xl font-bold">
                {balance ? `${formatWeiToEth(balance.value)} ${balance.symbol}` : "Loading..."}
              </p>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-muted-foreground">Connected Network</label>
            <div className="flex items-center justify-between p-4 bg-secondary/20 rounded-lg">
              <div className="flex items-center gap-2">
                <div className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
                <span className="font-medium">{getChainName(chainIdSafe)}</span>
              </div>
              <Badge variant="outline">Chain ID: {chainIdSafe}</Badge>
            </div>
          </div>

          <Button
            variant="destructive"
            className="w-full"
            disabled={disconnect.isPending}
            onClick={handleDisconnect}
          >
            <LogOut className="mr-2 h-4 w-4" />
            {disconnect.isPending ? "Disconnecting..." : "Disconnect Wallet"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            Preferences
          </CardTitle>
        </CardHeader>

        <CardContent className="space-y-4">
          <div className="flex items-center justify-between p-4 border rounded-lg">
            <div className="flex items-center gap-3">
              <Bell className="h-5 w-5 text-muted-foreground" />
              <div>
                <p className="font-medium">Notifications</p>
                <p className="text-sm text-muted-foreground">Get notified about poll updates</p>
              </div>
            </div>
            <Badge variant="outline">Coming Soon</Badge>
          </div>

          <div className="flex items-center justify-between p-4 border rounded-lg">
            <div className="flex items-center gap-3">
              <Palette className="h-5 w-5 text-muted-foreground" />
              <div>
                <p className="font-medium">Theme</p>
                <p className="text-sm text-muted-foreground">Customize your interface</p>
              </div>
            </div>
            <Badge variant="outline">Coming Soon</Badge>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Activity Summary</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="text-center p-4 bg-secondary/20 rounded-lg">
              <p className="text-2xl font-bold">-</p>
              <p className="text-sm text-muted-foreground">Groups Joined</p>
            </div>
            <div className="text-center p-4 bg-secondary/20 rounded-lg">
              <p className="text-2xl font-bold">-</p>
              <p className="text-sm text-muted-foreground">Polls Created</p>
            </div>
            <div className="text-center p-4 bg-secondary/20 rounded-lg">
              <p className="text-2xl font-bold">-</p>
              <p className="text-sm text-muted-foreground">Votes Cast</p>
            </div>
            <div className="text-center p-4 bg-secondary/20 rounded-lg">
              <p className="text-2xl font-bold">-</p>
              <p className="text-sm text-muted-foreground">Delegations</p>
            </div>
          </div>

          <p className="text-xs text-muted-foreground text-center mt-4">
            Activity tracking requires subgraph integration
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
