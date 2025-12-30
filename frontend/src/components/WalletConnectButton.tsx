import { useMemo } from "react";
import { useConnect, useConnection, useDisconnect } from "wagmi";
import { Button } from "@/components/ui/Button";
import { shortenAddress } from "@/utils/format";
import { Wallet, LogOut, Smartphone } from "lucide-react";

export function WalletConnectButton() {
  const { address, status } = useConnection();
  const isConnected = status === "connected";

  const connect = useConnect();
  const disconnect = useDisconnect();

  const { injectedConnector, walletConnectConnector, fallbackConnector } = useMemo(() => {
    const connectors = connect.connectors ?? [];

    const injected =
      connectors.find((c) => c.id === "injected") ??
      connectors.find((c) => c.type === "injected");

    const wc =
      connectors.find((c) => c.id === "walletConnect") ??
      connectors.find((c) => c.type === "walletConnect");

    return {
      injectedConnector: injected,
      walletConnectConnector: wc,
      // keep as a general fallback (not used for WalletConnect button)
      fallbackConnector: wc ?? injected ?? connectors[0],
    };
  }, [connect.connectors]);

  if (isConnected && address) {
    return (
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm">
          <Wallet className="mr-2 h-4 w-4" />
          {shortenAddress(address)}
        </Button>

        <Button
          variant="destructive"
          size="sm"
          onClick={() => disconnect.mutate()}
          disabled={disconnect.isPending}
          title="Disconnect"
        >
          <LogOut className="h-4 w-4" />
        </Button>
      </div>
    );
  }

  const connectWith = (connectorId: "injected" | "walletconnect") => {
    if (connectorId === "injected") {
      const target = injectedConnector ?? fallbackConnector;
      if (!target) return;
      connect.mutate({ connector: target });
      return;
    }

    // WalletConnect: NO fallback to injected
    if (!walletConnectConnector) return;
    connect.mutate({ connector: walletConnectConnector });
  };

  const canWalletConnect = Boolean(walletConnectConnector);
  const canInjected = Boolean(injectedConnector ?? fallbackConnector);

  return (
    <div className="flex items-center gap-2">
      {/* Desktop: Browser wallet option */}
      <Button
        size="sm"
        variant="outline"
        className="hidden md:inline-flex"
        onClick={() => connectWith("injected")}
        disabled={!canInjected || connect.isPending}
        title="Browser wallet"
      >
        <Wallet className="mr-2 h-4 w-4" />
        Browser Wallet
      </Button>

      {/* Mobile-first: WalletConnect only, and no fallback */}
      <Button
        size="sm"
        variant="neon"
        onClick={() => connectWith("walletconnect")}
        disabled={!canWalletConnect || connect.isPending}
        title={!canWalletConnect ? "WalletConnect is not configured" : "WalletConnect"}
      >
        <Smartphone className="mr-2 h-4 w-4" />
        {connect.isPending ? "Connecting..." : "WalletConnect"}
      </Button>

      {connect.error ? <span className="text-xs text-red-400">{connect.error.message}</span> : null}

      {!canWalletConnect ? (
        <span className="text-xs text-muted-foreground hidden sm:inline">
          WalletConnect unavailable
        </span>
      ) : null}
    </div>
  );
}
