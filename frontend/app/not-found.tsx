"use client"

import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { HelpCircle, ChevronLeft } from "lucide-react";

export default function NotFound() {
  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col items-center justify-center p-4">
      <div className="max-w-md w-full text-center flex flex-col items-center gap-6">
        {/* Animated Icon */}
        <div className="p-4 border rounded-full bg-muted/30 border-zinc-200 dark:border-zinc-800 animate-bounce">
          <HelpCircle className="size-10 text-primary" />
        </div>
        
        <div className="flex flex-col gap-2">
          <h1 className="text-4xl font-extrabold tracking-tight">404</h1>
          <h2 className="text-xl font-bold tracking-tight text-zinc-700 dark:text-zinc-300">Page Not Found</h2>
          <p className="text-xs text-muted-foreground leading-relaxed">
            The page you are looking for doesn&apos;t exist or has been relocated to another workspace route.
          </p>
        </div>

        <Separator />

        <Link
          href="/dashboard"
          className={cn(buttonVariants({ variant: "default" }), "w-full cursor-pointer flex items-center justify-center gap-1.5")}
        >
          <ChevronLeft className="size-4" /> Back to Dashboard
        </Link>
      </div>
    </div>
  );
}

// Simple internal separator component to make the styling standalone
function Separator() {
  return <div className="h-px w-full bg-zinc-200 dark:bg-zinc-800" />;
}
