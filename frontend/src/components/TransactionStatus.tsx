import { ExternalLink, Loader2, CheckCircle, XCircle } from "lucide-react";
import { Card, CardContent } from "./ui/Card";
import { shortenAddress } from "@/utils/format";

interface TransactionStatusProps {
  hash?: string;
  status: "idle" | "pending" | "success" | "error";
  error?: Error | null;
  chainId?: number;
}

export function TransactionStatus({
  hash,
  status,
  error,
  chainId = 84532,
}: TransactionStatusProps) {
  if (status === "idle") return null;

  const getExplorerUrl = (txHash: string) => {
    if (chainId === 84532) return `https://sepolia.basescan.org/tx/${txHash}`;
    if (chainId === 11155111) return `https://sepolia.etherscan.io/tx/${txHash}`;
    return null;
  };

  const explorerUrl = hash ? getExplorerUrl(hash) : null;

  const errorText =
    status === "error" && error
      ? error.message.length > 120
        ? `${error.message.slice(0, 120)}...`
        : error.message
      : null;

  return (
    <Card className="mt-4 border-l-4 border-l-primary">
      <CardContent className="pt-6 flex items-start space-x-4">
        {status === "pending" && <Loader2 className="h-6 w-6 animate-spin text-primary" aria-hidden="true" />}
        {status === "success" && <CheckCircle className="h-6 w-6 text-green-500" aria-hidden="true" />}
        {status === "error" && <XCircle className="h-6 w-6 text-destructive" aria-hidden="true" />}

        <div className="flex-1 space-y-1">
          <p className="font-medium">
            {status === "pending" && "Transaction Pending..."}
            {status === "success" && "Transaction Successful!"}
            {status === "error" && "Transaction Failed"}
          </p>

          {errorText ? <p className="text-sm text-destructive">{errorText}</p> : null}

          {hash && explorerUrl ? (
            <a
              href={explorerUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-primary hover:underline flex items-center mt-1"
            >
              View on Explorer: {shortenAddress(hash)}
              <ExternalLink className="ml-1 h-3 w-3" aria-hidden="true" />
            </a>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
