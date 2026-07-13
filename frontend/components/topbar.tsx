"use client"

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { ThemeToggle } from "./theme-toggle";
import { Compass, Loader2, LogOut, User as UserIcon, ChevronRight } from "lucide-react";
import { cn, redirectUser } from "@/lib/utils";
import { usePathname } from "next/navigation";
import { navigationItems } from "./sidebar";

interface Me {
  id: number;
  username: string;
  role: string;
}

export function Topbar() {
  const pathname = usePathname();
  const [isScraping, setIsScraping] = useState(false);
  const [me, setMe] = useState<Me | null>(null);

  useEffect(() => {
    fetch("/api/v2/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.user) setMe(d.user);
      })
      .catch(() => {});
  }, []);

  const logout = async () => {
    try {
      await fetch("/api/v2/auth/logout", { method: "POST" });
    } catch {
      // ignore
    }
    redirectUser("/login");
  };

  // Poll for active scrape status to show an indicator in Topbar
  useEffect(() => {
    const checkScraping = async () => {
      try {
        const res = await fetch("/api/status");
        if (res.ok) {
          const data = await res.json();
          // The Flask api status is "running" or has active records
          setIsScraping(data.status === "scraping" || data.status === "running");
        }
      } catch (e) {
        // Ignore error
      }
    };

    checkScraping();
    const interval = setInterval(checkScraping, 5000);
    return () => clearInterval(interval);
  }, []);

  const currentNavItem = navigationItems.find((item) => item.href === pathname);
  const pageTitle = currentNavItem ? currentNavItem.name : "Extractrx";

  // Build breadcrumb segments from the path (e.g. /admin -> Home / Administration).
  const segments = (pathname || "/").split("/").filter(Boolean);

  return (
    <header className="sticky top-0 z-30 flex items-center justify-between h-16 px-6 border-b bg-card/85 backdrop-blur-md text-card-foreground">
      {/* Mobile brand logo */}
      <div className="flex items-center gap-2 md:hidden">
        <Compass className="size-5 text-primary" />
        <span className="text-base font-bold bg-gradient-to-r from-primary to-blue-500 bg-clip-text text-transparent">
          Extractrx
        </span>
      </div>

      {/* Breadcrumb (Desktop only) */}
      <nav aria-label="Breadcrumb" className="hidden md:block">
        <ol className="flex items-center gap-1.5 text-sm">
          <li>
            <Link href="/dashboard" className="text-muted-foreground hover:text-foreground transition-colors">
              Home
            </Link>
          </li>
          {segments.map((seg, i) => {
            const isLast = i === segments.length - 1;
            const label = seg.charAt(0).toUpperCase() + seg.slice(1).replace(/-/g, " ");
            return (
              <li key={i} className="flex items-center gap-1.5">
                <ChevronRight className="size-3.5 text-muted-foreground/60" aria-hidden="true" />
                <span
                  className={isLast ? "font-semibold text-foreground" : "text-muted-foreground"}
                  aria-current={isLast ? "page" : undefined}
                >
                  {isLast ? pageTitle : label}
                </span>
              </li>
            );
          })}
        </ol>
      </nav>
      <div className="hidden">
        {pageTitle}
      </div>

      {/* Topbar Actions */}
      <div className="flex items-center gap-3">
        {isScraping && (
          <div className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-semibold rounded-full bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20 animate-pulse">
            <Loader2 className="size-3 animate-spin shrink-0" data-icon="inline-start" />
            <span>Scraper Active</span>
          </div>
        )}
        <ThemeToggle />
        {me && (
          <div className="flex items-center gap-2 pl-2 border-l border-border/60">
            <div className="hidden sm:flex items-center gap-1.5 text-xs">
              <UserIcon className="size-3.5 text-muted-foreground" />
              <span className="font-medium">{me.username}</span>
              {me.role === "admin" && (
                <span className="px-1.5 py-0.5 rounded bg-primary/10 text-primary text-[10px] font-semibold uppercase">
                  admin
                </span>
              )}
            </div>
            <button
              onClick={logout}
              title="Sign out"
              aria-label="Sign out"
              className="flex items-center justify-center size-8 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
            >
              <LogOut className="size-4" />
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
