"use client"

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  Terminal,
  Database,
  Map,
  Download,
  Settings,
  Menu,
  X,
  Compass,
  Sparkles,
  Globe,
  History,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";

export const navigationItems = [
  { name: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { name: "Scraper Panel", href: "/scraper", icon: Terminal },
  { name: "Data Explorer", href: "/explorer", icon: Database },
  { name: "Map View", href: "/map", icon: Map },
  { name: "Export History", href: "/exports", icon: Download },
  { name: "Exec History", href: "/history", icon: History },
  { name: "Settings", href: "/settings", icon: Settings },
  { name: "AI Enrichment", href: "/enrichment", icon: Sparkles },
  { name: "Lead Enrichment", href: "/lead-enrichment", icon: Globe },
  { name: "Administration", href: "/admin", icon: ShieldCheck, adminOnly: true },
];

export function Sidebar({ className }: { className?: string }) {
  const pathname = usePathname();
  const [role, setRole] = React.useState<string | null>(null);

  React.useEffect(() => {
    fetch("/api/v2/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setRole(d?.user?.role ?? null))
      .catch(() => {});
  }, []);

  const visibleItems = navigationItems.filter(
    (item) => !("adminOnly" in item && item.adminOnly) || role === "admin"
  );

  return (
    <aside
      className={cn(
        "hidden md:flex flex-col w-60 border-r border-border/50 bg-card/60 backdrop-blur-xl text-card-foreground shrink-0 h-screen sticky top-0",
        className
      )}
    >
      {/* Sidebar Header */}
      <div className="flex items-center gap-2 px-6 h-16 border-b">
        <Compass className="size-6 text-primary" />
        <span className="text-lg font-bold tracking-tight bg-gradient-to-r from-primary to-blue-500 bg-clip-text text-transparent">
          Extractrx
        </span>
      </div>

      {/* Navigation Links */}
      <nav
        className="flex-1 px-4 py-6 flex flex-col gap-1.5 overflow-y-auto"
        aria-label="Primary navigation"
      >
        {visibleItems.map((item) => {
          const isActive = pathname === item.href || pathname?.startsWith(item.href + "/");
          const Icon = item.icon;

          return (
            <Link
              key={item.name}
              href={item.href}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-lg transition-all duration-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer",
                isActive
                  ? "bg-primary/10 text-primary hover:bg-primary/15"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Icon
                className={cn("size-4 shrink-0", isActive ? "text-primary" : "text-muted-foreground")}
                aria-hidden="true"
              />
              {item.name}
            </Link>
          );
        })}
      </nav>

      {/* Sidebar Footer */}
      <div className="p-4 border-t flex flex-col gap-2">
        <div className="flex items-center gap-3 px-2">
          <div className="size-8 rounded-full bg-primary/20 flex items-center justify-center text-primary font-bold text-xs">
            ZD
          </div>
          <div className="flex flex-col min-w-0">
            <span className="text-xs font-semibold text-foreground truncate">Extractrx Admin</span>
            <span className="text-[10px] text-muted-foreground truncate">v2.0 (Next.js)</span>
          </div>
        </div>
      </div>
    </aside>
  );
}
