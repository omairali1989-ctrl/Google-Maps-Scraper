"use client"

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { navigationItems } from "./sidebar";

export function BottomTabBar() {
  const pathname = usePathname();

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 h-16 border-t bg-card/90 backdrop-blur-md text-card-foreground flex items-center justify-around px-2 z-40 shadow-lg pb-safe">
      {navigationItems.slice(0, 5).map((item) => {
        const isActive = pathname === item.href || pathname?.startsWith(item.href + "/");
        const Icon = item.icon;

        return (
          <Link
            key={item.name}
            href={item.href}
            className={cn(
              "flex flex-col items-center justify-center gap-1 flex-1 py-1 text-[10px] font-medium transition-all duration-150",
              isActive ? "text-primary font-semibold" : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Icon className={cn("size-5 shrink-0", isActive ? "text-primary" : "text-muted-foreground")} />
            <span className="truncate max-w-[64px]">{item.name.split(" ")[0]}</span>
          </Link>
        );
      })}
      {/* Settings link for mobile bottom tab fallback */}
      {(() => {
        const item = navigationItems[5];
        const isActive = pathname === item.href;
        const Icon = item.icon;
        return (
          <Link
            href={item.href}
            className={cn(
              "flex flex-col items-center justify-center gap-1 flex-1 py-1 text-[10px] font-medium transition-all duration-150",
              isActive ? "text-primary font-semibold" : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Icon className={cn("size-5 shrink-0", isActive ? "text-primary" : "text-muted-foreground")} />
            <span className="truncate max-w-[64px]">{item.name}</span>
          </Link>
        );
      })()}
    </nav>
  );
}
