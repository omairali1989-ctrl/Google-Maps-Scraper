import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { LucideIcon } from "lucide-react";

interface MetricCardProps extends React.HTMLAttributes<HTMLDivElement> {
  title: string;
  value: string | number;
  description?: string;
  icon?: LucideIcon;
  trend?: {
    value: string | number;
    isPositive?: boolean;
  };
}

export function MetricCard({
  title,
  value,
  description,
  icon: Icon,
  trend,
  className,
  ...props
}: MetricCardProps) {
  return (
    <Card className={cn("overflow-hidden hover:-translate-y-1 hover:shadow-[0_8px_30px_rgb(0,0,0,0.12)] hover:ring-primary/30 transition-all duration-300", className)} {...props}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </CardTitle>
        {Icon && <Icon className="size-4 text-muted-foreground" data-icon="inline-end" />}
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold tracking-tight text-foreground">{value}</div>
        {(description || trend) && (
          <div className="text-xs text-muted-foreground mt-1 flex items-center gap-1.5 flex-wrap">
            {trend && (
              <span
                className={cn(
                  "font-semibold px-1 py-0.5 rounded",
                  trend.isPositive
                    ? "bg-green-500/10 text-green-600 dark:text-green-400"
                    : "bg-red-500/10 text-red-600 dark:text-red-400"
                )}
              >
                {trend.isPositive ? "+" : ""}{trend.value}%
              </span>
            )}
            {description && <span>{description}</span>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
