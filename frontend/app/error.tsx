"use client"

import React, { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { AlertTriangle, RotateCcw, Home } from "lucide-react";
import Link from "next/link";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log error to monitoring service
    console.error("Application Render Crash:", error);
  }, [error]);

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col items-center justify-center p-4">
      <div className="max-w-md w-full text-center flex flex-col items-center gap-6">
        {/* Warning Badge */}
        <div className="p-4 border rounded-full bg-destructive/10 border-destructive/20 text-destructive animate-pulse">
          <AlertTriangle className="size-10" />
        </div>
        
        <div className="flex flex-col gap-2">
          <h1 className="text-xl font-bold tracking-tight text-foreground">Application Crash</h1>
          <p className="text-xs text-muted-foreground leading-relaxed">
            An unexpected error occurred during rendering. The interface crashed.
          </p>
          {error.message && (
            <div className="mt-2 text-left font-mono text-[10px] p-3 border rounded-md bg-zinc-50 dark:bg-zinc-950/50 border-zinc-200 dark:border-zinc-800 text-destructive max-h-[120px] overflow-y-auto break-all">
              <span className="font-semibold block uppercase text-[8px] text-zinc-400 font-sans tracking-wide mb-1">Error Message</span>
              {error.message}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-2 w-full">
          <Button onClick={() => reset()} className="w-full cursor-pointer flex items-center justify-center gap-1.5">
            <RotateCcw className="size-4" /> Try Reloading Interface
          </Button>
          <Link href="/dashboard" className="w-full">
            <Button variant="outline" className="w-full cursor-pointer flex items-center justify-center gap-1.5">
              <Home className="size-4" /> Go to Dashboard
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
