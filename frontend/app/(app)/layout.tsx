import React from "react";
import { Sidebar } from "@/components/sidebar";
import { Topbar } from "@/components/topbar";
import { BottomTabBar } from "@/components/bottom-tab-bar";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen bg-transparent text-foreground relative z-10">
      {/* Accessibility Skip Nav Link */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[9999] focus:px-4 focus:py-2 focus:bg-primary focus:text-primary-foreground focus:rounded-md focus:shadow-md focus:outline-none text-xs font-semibold"
      >
        Skip to main content
      </a>

      {/* Desktop Sidebar */}
      <Sidebar />

      {/* Main Container */}
      <div className="flex flex-col flex-1 min-w-0 pb-16 md:pb-0">
        {/* Header */}
        <Topbar />

        {/* Content Area */}
        <main id="main-content" className="flex-1 p-4 md:p-6 overflow-y-auto">
          <div className="mx-auto max-w-7xl">
            {children}
          </div>
        </main>
      </div>

      {/* Mobile Bottom Navigation Bar */}
      <BottomTabBar />
    </div>
  );
}
