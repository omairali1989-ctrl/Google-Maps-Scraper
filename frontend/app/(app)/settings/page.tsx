"use client"

import React, { useState, useEffect } from "react";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Settings,
  Database,
  Trash2,
  RefreshCw,
  Info,
  ExternalLink,
  ShieldAlert,
  Sliders,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { useTheme } from "next-themes";
import { AutomationSettings } from "./automation-settings";

interface DbStats {
  sizeBytes: number;
  recordsCount: number;
  jobsCount: number;
  exportsCount: number;
  path: string;
}

export default function SettingsPage() {
  const { theme, setTheme } = useTheme();
  const [dbStats, setDbStats] = useState<DbStats | null>(null);
  const [loadingStats, setLoadingStats] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);

  // Scraper Preference States (persisted in localStorage)
  const [headless, setHeadless] = useState(true);
  const [defaultFormat, setDefaultFormat] = useState("xlsx");
  const [autoEmailScan, setAutoEmailScan] = useState(true);

  const fetchDbStats = async () => {
    setLoadingStats(true);
    try {
      const res = await fetch("/api/v2/database");
      const data = await res.json();
      if (res.ok && data.success) {
        setDbStats(data.stats);
      }
    } catch (e) {
      // ignore
    } finally {
      setLoadingStats(false);
    }
  };

  // Load preferences from localStorage on mount
  useEffect(() => {
    if (typeof window !== "undefined") {
      const storedHeadless = localStorage.getItem("gms_headless");
      const storedFormat = localStorage.getItem("gms_default_format");
      const storedEmail = localStorage.getItem("gms_auto_email");

      if (storedHeadless !== null) setHeadless(storedHeadless === "true");
      if (storedFormat !== null) setDefaultFormat(storedFormat);
      if (storedEmail !== null) setAutoEmailScan(storedEmail === "true");
    }
    fetchDbStats();
  }, []);

  const handleSavePreference = (key: string, value: string | boolean) => {
    localStorage.setItem(key, value.toString());
    toast.success("Preference updated successfully.");
  };

  const handleDbAction = async (action: "vacuum" | "clear_records" | "clear_history" | "reset") => {
    let confirmMsg = "";
    if (action === "clear_records") {
      confirmMsg = "Are you sure you want to delete all scraped business records? This action cannot be undone.";
    } else if (action === "clear_history") {
      confirmMsg = "Are you sure you want to clear all scraping history logs and export logs? This will clean up the dashboard feed.";
    } else if (action === "reset") {
      confirmMsg = "DANGER! Are you sure you want to completely reset the application? This will wipe out all records, logs, history, and saved filters.";
    }

    if (confirmMsg && !confirm(confirmMsg)) {
      return;
    }

    setActionLoading(true);
    try {
      const res = await fetch("/api/v2/database", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        toast.success(data.message || "Database action completed successfully.");
        fetchDbStats();
      } else {
        toast.error(data.error || "Failed to perform database operation.");
      }
    } catch (e) {
      toast.error("Network error communicating with database API.");
    } finally {
      setActionLoading(false);
    }
  };

  const getFileSizeString = (bytes?: number) => {
    if (!bytes) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Settings"
        description="Configure browser scraper defaults, system preferences, and manage database footprints."
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Left: General Scraper & UI Settings */}
        <div className="flex flex-col gap-6">
          <Card className="shadow-sm border-zinc-200 dark:border-zinc-800">
            <CardHeader>
              <CardTitle className="text-md flex items-center gap-2">
                <Sliders className="size-4 text-primary" /> Scraper Preferences
              </CardTitle>
              <CardDescription>
                Set default behaviors for newly started scraping jobs.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {/* Headless mode */}
              <div className="flex items-center justify-between py-1">
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm font-semibold">Run Headless by Default</span>
                  <span className="text-xs text-muted-foreground">Launches browser in the background without UI window.</span>
                </div>
                <Switch
                  checked={headless}
                  onCheckedChange={(checked) => {
                    setHeadless(checked);
                    handleSavePreference("gms_headless", checked);
                  }}
                />
              </div>

              <Separator />

              {/* Email Extractor */}
              <div className="flex items-center justify-between py-1">
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm font-semibold">Deep Email Extraction</span>
                  <span className="text-xs text-muted-foreground">Scrape websites associated with Google Map listings to extract email addresses.</span>
                </div>
                <Switch
                  checked={autoEmailScan}
                  onCheckedChange={(checked) => {
                    setAutoEmailScan(checked);
                    handleSavePreference("gms_auto_email", checked);
                  }}
                />
              </div>

              <Separator />

              {/* Default Export Format */}
              <div className="flex items-center justify-between py-1">
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm font-semibold">Default Output Format</span>
                  <span className="text-xs text-muted-foreground">Primary flat file format generated by the Python scraper process.</span>
                </div>
                <Select
                  value={defaultFormat}
                  onValueChange={(val) => {
                    setDefaultFormat(val || "xlsx");
                    handleSavePreference("gms_default_format", val || "xlsx");
                  }}
                >
                  <SelectTrigger className="w-[140px] h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="xlsx">Excel (.xlsx)</SelectItem>
                    <SelectItem value="csv">CSV (.csv)</SelectItem>
                    <SelectItem value="json">JSON (.json)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          {/* Theme Preferences */}
          <Card className="shadow-sm border-zinc-200 dark:border-zinc-800">
            <CardHeader>
              <CardTitle className="text-md flex items-center gap-2">
                <Sparkles className="size-4 text-primary" /> Appearance
              </CardTitle>
              <CardDescription>
                Customize layout stylesheet and visualization theme.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="flex items-center justify-between py-1">
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm font-semibold">Color Scheme Theme</span>
                  <span className="text-xs text-muted-foreground">Toggle application theme or match your OS setting.</span>
                </div>
                <Select value={theme || "system"} onValueChange={(val) => setTheme(val || "system")}>
                  <SelectTrigger className="w-[140px] h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="light">Light Mode</SelectItem>
                    <SelectItem value="dark">Dark Mode</SelectItem>
                    <SelectItem value="system">System Default</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right: Database Layer & Administration */}
        <div className="flex flex-col gap-6">
          <Card className="shadow-sm border-zinc-200 dark:border-zinc-800 h-full">
            <CardHeader>
              <CardTitle className="text-md flex items-center gap-2">
                <Database className="size-4 text-primary" /> Database Storage
              </CardTitle>
              <CardDescription>
                Wrangle local SQLite file size and records storage tables.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
              {/* Database Stats info */}
              <div className="grid grid-cols-2 gap-3.5 text-xs">
                <div className="border p-3 rounded-lg bg-zinc-50/50 dark:bg-zinc-900/50 flex flex-col gap-1">
                  <span className="text-muted-foreground">Database Size</span>
                  <span className="text-base font-bold text-foreground">
                    {loadingStats ? "..." : getFileSizeString(dbStats?.sizeBytes)}
                  </span>
                </div>
                <div className="border p-3 rounded-lg bg-zinc-50/50 dark:bg-zinc-900/50 flex flex-col gap-1">
                  <span className="text-muted-foreground">Total Leads Saved</span>
                  <span className="text-base font-bold text-foreground">
                    {loadingStats ? "..." : dbStats?.recordsCount.toLocaleString()}
                  </span>
                </div>
                <div className="border p-3 rounded-lg bg-zinc-50/50 dark:bg-zinc-900/50 flex flex-col gap-1">
                  <span className="text-muted-foreground">Scrape Sessions logged</span>
                  <span className="text-base font-bold text-foreground">
                    {loadingStats ? "..." : dbStats?.jobsCount.toLocaleString()}
                  </span>
                </div>
                <div className="border p-3 rounded-lg bg-zinc-50/50 dark:bg-zinc-900/50 flex flex-col gap-1">
                  <span className="text-muted-foreground">Spreadsheet Exports</span>
                  <span className="text-base font-bold text-foreground">
                    {loadingStats ? "..." : dbStats?.exportsCount.toLocaleString()}
                  </span>
                </div>
              </div>

              {dbStats?.path && (
                <div className="text-[10px] text-muted-foreground border rounded p-2.5 truncate font-mono bg-zinc-50/20 dark:bg-zinc-900/10">
                  <span className="font-semibold block uppercase text-[8px] text-zinc-400 font-sans tracking-wide mb-0.5">Database File Path</span>
                  {dbStats.path}
                </div>
              )}

              <Separator />

              {/* Action operations buttons */}
              <div className="flex flex-col gap-3">
                <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                  <ShieldAlert className="size-3.5 text-amber-500" /> Database Administration Tasks
                </span>
                
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {/* Vacuum */}
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs cursor-pointer"
                    disabled={actionLoading}
                    onClick={() => handleDbAction("vacuum")}
                  >
                    <RefreshCw className="size-3.5 mr-1.5" /> Optimize Tables
                  </Button>
                  
                  {/* Clear Leads */}
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs cursor-pointer text-destructive hover:bg-destructive/5 hover:text-destructive border-zinc-200 dark:border-zinc-800"
                    disabled={actionLoading}
                    onClick={() => handleDbAction("clear_records")}
                  >
                    <Trash2 className="size-3.5 mr-1.5" /> Clear Scraped Leads
                  </Button>

                  {/* Clear History */}
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs cursor-pointer text-destructive hover:bg-destructive/5 hover:text-destructive border-zinc-200 dark:border-zinc-800"
                    disabled={actionLoading}
                    onClick={() => handleDbAction("clear_history")}
                  >
                    <Trash2 className="size-3.5 mr-1.5" /> Clear Logs History
                  </Button>

                  {/* Full Reset */}
                  <Button
                    variant="destructive"
                    size="sm"
                    className="h-8 text-xs cursor-pointer"
                    disabled={actionLoading}
                    onClick={() => handleDbAction("reset")}
                  >
                    <Trash2 className="size-3.5 mr-1.5" /> Wipe & Reset App
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Automation: anti-blocking (UA/rate/proxy) + scheduling */}
      <AutomationSettings />

      {/* Footer support card */}
      <Card className="shadow-sm border-zinc-200 dark:border-zinc-800 bg-zinc-50/10 dark:bg-zinc-900/5">
        <CardContent className="p-4 flex items-center gap-4 text-xs">
          <Info className="size-5 text-primary shrink-0" />
          <div className="flex-1 flex flex-col gap-0.5">
            <span className="font-semibold text-foreground">Extractrx Google Maps Scraper v2.0.0</span>
            <span className="text-muted-foreground">Democratizing lead generation and browser automation tools. Powered by Next.js and undetected-chromedriver.</span>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="cursor-pointer shrink-0 h-8 text-[11px]"
            onClick={() => window.open("https://www.buymeacoffee.com/extractrx", "_blank", "noopener,noreferrer")}
          >
            Fuel Us With Coffee ☕️ <ExternalLink className="size-3 ml-1" />
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
