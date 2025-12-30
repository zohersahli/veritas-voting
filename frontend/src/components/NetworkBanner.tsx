import { useConnection, useSwitchChain } from "wagmi";
import { AlertTriangle } from "lucide-react";
import { Button } from "./ui/Button";
import { CHAIN_IDS } from "@/config/contracts";

export function NetworkBanner() {
  const { chainId, isConnected } = useConnection();
  const switchChain = useSwitchChain();
  const targetChainId = CHAIN_IDS.baseSepolia;

  if (!isConnected || chainId === targetChainId) return null;

  return (
    <div className="bg-yellow-500/10 border-b border-yellow-500/20 px-4 py-3">
      <div className="container mx-auto flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="flex items-center text-yellow-500">
          <AlertTriangle className="h-5 w-5 mr-2" />
          <span className="text-sm font-medium">
            You are on the wrong network. Please switch to Base Sepolia.
          </span>
        </div>

        <div className="flex flex-col sm:flex-row items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            className="border-yellow-500 text-yellow-500 hover:bg-yellow-500/10"
            onClick={() => switchChain.mutate({ chainId: targetChainId })}
            disabled={switchChain.isPending}
          >
            {switchChain.isPending ? "Switching..." : "Switch to Base Sepolia"}
          </Button>

          {switchChain.error ? (
            <span className="text-xs text-yellow-500/90">{switchChain.error.message}</span>
          ) : null}
        </div>
      </div>
    </div>
  );
}
