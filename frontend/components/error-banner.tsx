import React from "react";
import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

interface ErrorBannerProps {
  message: string;
  className?: string;
}

export function ErrorBanner({ message, className }: ErrorBannerProps) {
  if (!message) return null;

  return (
    <div
      className={cn(
        "flex items-start gap-3 p-4 border rounded-lg bg-destructive/10 text-destructive border-destructive/20 text-sm",
        className
      )}
      role="alert"
    >
      <AlertTriangle className="size-4 shrink-0 mt-0.5" data-icon="inline-start" />
      <div className="flex-1 font-medium">{message}</div>
    </div>
  );
}
