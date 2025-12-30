import { useToast } from "@/hooks/useToast";
import { cn } from "@/lib/utils";
import { X, CheckCircle, AlertCircle, Info, Loader2 } from "lucide-react";

export function ToastContainer() {
  const { toasts, dismiss } = useToast();

  return (
    <div
      className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 w-full max-w-sm pointer-events-none"
      aria-live="polite"
      aria-relevant="additions"
      aria-atomic="true"
    >
      {toasts.map((t) => {
        const isAlert = t.type === "error" || t.type === "success";
        const role = isAlert ? "alert" : "status";

        return (
          <div
            key={t.id}
            className={cn(
              "pointer-events-auto flex items-center w-full p-4 rounded-lg shadow-lg border transition-all transform translate-y-0 opacity-100",
              t.type === "success" && "bg-background border-green-500/50 text-foreground",
              t.type === "error" && "bg-background border-red-500/50 text-foreground",
              t.type === "info" && "bg-background border-blue-500/50 text-foreground",
              t.type === "loading" && "bg-background border-primary/50 text-foreground"
            )}
            role={role}
            aria-live={isAlert ? "assertive" : "polite"}
            aria-atomic="true"
          >
            <div className="mr-3" aria-hidden="true">
              {t.type === "success" && <CheckCircle className="h-5 w-5 text-green-500" />}
              {t.type === "error" && <AlertCircle className="h-5 w-5 text-red-500" />}
              {t.type === "info" && <Info className="h-5 w-5 text-blue-500" />}
              {t.type === "loading" && <Loader2 className="h-5 w-5 text-primary animate-spin" />}
            </div>

            <div className="flex-1 text-sm font-medium">{t.message}</div>

            <button
              type="button"
              onClick={() => dismiss(t.id)}
              className="ml-3 text-muted-foreground hover:text-foreground"
              aria-label="Close"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
