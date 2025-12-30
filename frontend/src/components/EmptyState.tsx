import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { FolderOpen } from "lucide-react";
import { Button } from "./ui/Button";

type EmptyStateProps = {
  title: string;
  description?: string;
  icon?: LucideIcon;

  // New props to match MyGroups/MyPolls
  actionLabel?: string;
  onAction?: () => void | string;

  // Optional custom action
  action?: ReactNode;
};

export function EmptyState({
  title,
  description,
  icon,
  actionLabel,
  onAction,
  action,
}: EmptyStateProps) {
  const Icon = icon ?? FolderOpen;

  return (
    <div className="w-full rounded-xl border border-white/10 bg-white/5 p-6 text-center">
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-white/10">
        <Icon className="h-6 w-6 opacity-80" />
      </div>

      <h3 className="text-lg font-semibold">{title}</h3>

      {description ? (
        <p className="mt-2 text-sm text-white/70">{description}</p>
      ) : null}

      {action ? (
        <div className="mt-4 flex justify-center">{action}</div>
      ) : actionLabel && onAction ? (
        <div className="mt-4 flex justify-center">
          <Button type="button" onClick={() => void onAction()}>
            {actionLabel}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
