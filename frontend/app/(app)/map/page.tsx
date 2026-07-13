"use client"

import dynamic from "next/dynamic";
import { PageHeader } from "@/components/page-header";

const MapContainerComponent = dynamic(
  () => import("@/components/map-container"),
  {
    ssr: false,
    loading: () => (
      <div className="h-[600px] w-full bg-zinc-100 dark:bg-zinc-900 animate-pulse rounded-xl flex flex-col items-center justify-center gap-3 text-muted-foreground border border-zinc-200 dark:border-zinc-800">
        <div className="text-sm font-medium">Loading interactive map...</div>
        <div className="text-xs text-zinc-400">Initializing Leaflet viewport and markers</div>
      </div>
    ),
  }
);

export default function MapPage() {
  return (
    <div className="flex flex-col gap-6 h-full">
      <PageHeader
        title="Map View"
        description="Geographic distribution and interactive maps of scraped leads."
      />
      <div className="flex-grow min-h-[500px] rounded-xl overflow-hidden border border-zinc-200 dark:border-zinc-800 bg-card shadow-sm">
        <MapContainerComponent />
      </div>
    </div>
  );
}
