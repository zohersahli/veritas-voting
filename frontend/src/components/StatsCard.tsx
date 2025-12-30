import type { LucideIcon } from "lucide-react";
import { Card, CardContent } from "./ui/Card";

interface StatsCardProps {
  title: string;
  value: string | number;
  icon: LucideIcon;
  description?: string;
  subtitle?: string;
}

export function StatsCard({ title, value, icon: Icon, description, subtitle }: StatsCardProps) {
  const text = description ?? subtitle;

  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">{title}</p>
            <p className="text-2xl font-bold">{String(value)}</p>
            {text ? <p className="text-xs text-muted-foreground">{text}</p> : null}
          </div>
          <div className="bg-muted p-2 rounded-lg">
            <Icon className="h-4 w-4 text-muted-foreground" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
