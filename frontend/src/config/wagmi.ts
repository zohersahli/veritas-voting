import { createConfig, http, type Config } from "wagmi";
import { baseSepolia, sepolia } from "wagmi/chains";
import { injected, walletConnect } from "wagmi/connectors";

export const WALLETCONNECT_PROJECT_ID = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID as string | undefined;
export const HAS_WALLETCONNECT = Boolean(WALLETCONNECT_PROJECT_ID);

const BASE_RPC_URL = import.meta.env.VITE_BASE_RPC_URL as string | undefined;
const ETH_RPC_URL = import.meta.env.VITE_ETHEREUM_RPC_URL as string | undefined;

const chains = [baseSepolia, sepolia] as const;

const transports: Record<number, ReturnType<typeof http>> = {
  [baseSepolia.id]: BASE_RPC_URL ? http(BASE_RPC_URL) : http(),
  [sepolia.id]: ETH_RPC_URL ? http(ETH_RPC_URL) : http(),
};

function getAppUrl(): string {
  const envUrl = import.meta.env.VITE_APP_URL as string | undefined;
  if (envUrl && envUrl.trim().length > 0) return envUrl.trim();
  if (typeof window !== "undefined" && window.location?.origin) return window.location.origin;
  return "http://localhost:4173";
}

const connectors = HAS_WALLETCONNECT
  ? [
      injected(),
      walletConnect({
        projectId: WALLETCONNECT_PROJECT_ID!,
        metadata: {
          name: "Veritas",
          description: "Cross-chain voting and governance",
          url: getAppUrl(),
          icons: [],
        },
        showQrModal: true,
      }),
    ]
  : [injected()];

export const wagmiConfig: Config = createConfig({
  chains,
  connectors,
  transports,
});

export async function loadWagmiConfigWithWalletConnect(): Promise<Config> {
  return wagmiConfig;
}
