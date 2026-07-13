import React from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type StatusType = "idle" | "running" | "completed" | "stopped" | "failed";

interface StatusBadgeProps {
  status: StatusType;
  className?: string;
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const config = {
    idle: {
      label: "Idle",
      variant: "secondary" as const,
      bg: "bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-300 border-transparent",
    },
    running: {
      label: "Running",
      variant: "default" as const,
      bg: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20 animate-pulse",
    },
    completed: {
      label: "Completed",
      variant: "outline" as const,
      bg: "bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/20",
    },
    stopped: {
      label: "Stopped",
      variant: "outline" as const,
      bg: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
    },
    failed: {
      label: "Failed",
      variant: "destructive" as const,
      bg: "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20",
    },
  };

  const current = config[status] || config.idle;

  return (
    <Badge
      variant={current.variant}
      className={cn("capitalize px-2 py-0.5 text-xs font-semibold rounded-full border", current.bg, className)}
    >
      {current.label}
    </Badge>
  );
}
