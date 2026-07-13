"use client"

import React, { useState, useEffect, useRef, useCallback } from "react";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { MetricCard } from "@/components/metric-card";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  History,
  Search,
  Play,
  Square,
  Pause,
  Download,
  Trash2,
  Eye,
  X,
  Clock,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Activity,
  BarChart3,
  Terminal,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  FileText,
  Zap,
  Timer,
  ArrowUpRight,
} from "lucide-react";
import { toast } from "sonner";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";

// ─── Types ───────────────────────────────────────────────────────────────────
interface ScrapeJob {
  id: number;
  query: string;
  status: "running" | "completed" | "stopped" | "failed";
  format: string;
  headless: number;
  started_at: string;
  completed_at?: string;
  record_count: number;
  error_message?: string;
  current_step?: string;
  total_items?: number;
  processed_items?: number;
  success_count?: number;
  failure_count?: number;
  current_query?: string;
}

interface ScrapeItem {
  id: number;
  job_id: number;
  query: string;
  url: string;
  status: string;
  error_message?: string;
  scraped_at: string;
}

interface StatusCounts {
  all: number;
  running: number;
  completed: number;
  stopped: number;
  failed: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function formatDuration(started: string, completed?: string): string {
  const start = new Date(started).getTime();
  const end = completed ? new Date(completed).getTime() : Date.now();
  const diffMs = Math.max(0, end - start);

  const hours = Math.floor(diffMs / 3_600_000);
  const minutes = Math.floor((diffMs % 3_600_000) / 60_000);
  const seconds = Math.floor((diffMs % 60_000) / 1000);

  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleString([], {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

// ─── Status Filter Tabs ──────────────────────────────────────────────────────
const STATUS_TABS: { key: string; label: string; icon: React.ElementType; color: string }[] = [
  { key: "all", label: "All Jobs", icon: BarChart3, color: "text-foreground" },
  { key: "running", label: "Running", icon: Activity, color: "text-blue-500" },
  { key: "completed", label: "Completed", icon: CheckCircle2, color: "text-green-500" },
  { key: "stopped", label: "Stopped", icon: Pause, color: "text-amber-500" },
  { key: "failed", label: "Failed", icon: XCircle, color: "text-red-500" },
];

// ─── Console Log Window ──────────────────────────────────────────────────────
function JobConsole({ messages, isLive }: { messages: string[]; isLive: boolean }) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  return (
    <div className="flex flex-col bg-zinc-950 text-zinc-300 font-mono text-xs rounded-xl overflow-hidden border border-zinc-800/60">
      <div className="flex items-center justify-between px-4 py-2 bg-zinc-900/80 border-b border-zinc-800/50">
        <span className="flex items-center gap-2 text-[11px] font-semibold text-zinc-400">
          <Terminal className="size-3.5" />
          Execution Console
        </span>
        {isLive && (
          <span className="flex items-center gap-1.5 text-[10px] text-green-400">
            <span className="flex h-1.5 w-1.5 rounded-full bg-green-400 animate-pulse" />
            LIVE
          </span>
        )}
      </div>
      <div className="p-4 overflow-y-auto max-h-[400px] flex flex-col gap-1 selection:bg-zinc-800 min-h-[200px]">
        {messages.length > 0 ? (
          messages.map((msg, i) => (
            <div key={i} className="leading-relaxed whitespace-pre-wrap">
              <span className="text-zinc-600 mr-2 select-none">{String(i + 1).padStart(3, " ")}</span>
              <span className={msg.includes("Error") || msg.includes("Exception") || msg.includes("Failed")
                ? "text-red-400"
                : msg.includes("Success") || msg.includes("complete")
                  ? "text-green-400"
                  : ""
              }>{msg}</span>
            </div>
          ))
        ) : (
          <div className="text-zinc-600 italic flex items-center justify-center h-[160px]">
            No log output available for this job.
          </div>
        )}
        <div ref={endRef} />
      </div>
    </div>
  );
}

// ─── Job Detail Drawer ───────────────────────────────────────────────────────
function JobDetailDrawer({
  job,
  onClose,
  onStop,
  onResume,
  onDownload,
  onDelete,
  liveMessages,
}: {
  job: ScrapeJob;
  onClose: () => void;
  onStop: (id: number) => void;
  onResume: (id: number) => void;
  onDownload: (id: number) => void;
  onDelete: (id: number) => void;
  liveMessages: string[];
}) {
  const [items, setItems] = useState<ScrapeItem[]>([]);
  const [itemsLoading, setItemsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"overview" | "items" | "console">("overview");

  useEffect(() => {
    async function fetchItems() {
      try {
        const res = await fetch(`/api/v2/history/${job.id}/items`);
        if (res.ok) {
          const data = await res.json();
          if (data.success) setItems(data.items);
        }
      } catch {
        // ignore
      } finally {
        setItemsLoading(false);
      }
    }
    fetchItems();
  }, [job.id]);

  const successRate =
    job.total_items && job.total_items > 0
      ? Math.round(((job.success_count || 0) / job.total_items) * 100)
      : 0;

  const drawerTabs = [
    { id: "overview" as const, label: "Overview", icon: Eye },
    { id: "items" as const, label: "Scraped Items", icon: FileText },
    { id: "console" as const, label: "Console Log", icon: Terminal },
  ];

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />

      {/* Drawer */}
      <div className="absolute right-0 top-0 bottom-0 w-full max-w-2xl bg-card border-l shadow-2xl flex flex-col animate-in slide-in-from-right duration-300">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b bg-gradient-to-r from-card to-card/80">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-3">
              <h2 className="text-lg font-bold">Job #{job.id}</h2>
              <StatusBadge status={job.status} />
            </div>
            <p className="text-xs text-muted-foreground truncate max-w-md">{job.query}</p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} className="shrink-0">
            <X className="size-5" />
          </Button>
        </div>

        {/* Tab Navigation */}
        <div className="flex border-b bg-zinc-50/50 dark:bg-zinc-900/30">
          {drawerTabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex-1 flex items-center justify-center gap-2 py-3 text-xs font-semibold transition-all border-b-2 ${
                  activeTab === tab.id
                    ? "border-primary text-primary bg-primary/5"
                    : "border-transparent text-muted-foreground hover:text-foreground hover:bg-zinc-100 dark:hover:bg-zinc-800/50"
                }`}
              >
                <Icon className="size-3.5" />
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5">
          {activeTab === "overview" && (
            <div className="flex flex-col gap-5 animate-in fade-in duration-200">
              {/* Stats Grid */}
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-zinc-50 dark:bg-zinc-900/50 p-4 rounded-xl border flex flex-col gap-1">
                  <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Duration</span>
                  <span className="text-xl font-bold font-mono flex items-center gap-2">
                    <Timer className="size-4 text-blue-500" />
                    {formatDuration(job.started_at, job.completed_at)}
                  </span>
                </div>
                <div className="bg-zinc-50 dark:bg-zinc-900/50 p-4 rounded-xl border flex flex-col gap-1">
                  <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Success Rate</span>
                  <span className="text-xl font-bold font-mono flex items-center gap-2">
                    <Zap className={`size-4 ${successRate >= 80 ? "text-green-500" : successRate >= 50 ? "text-amber-500" : "text-red-500"}`} />
                    {successRate}%
                  </span>
                </div>
              </div>

              {/* Progress Detail */}
              <div className="bg-zinc-50 dark:bg-zinc-900/50 p-4 rounded-xl border">
                <h4 className="text-xs font-semibold mb-3 text-muted-foreground uppercase tracking-wider">Progress Breakdown</h4>
                <div className="grid grid-cols-4 gap-2 text-center">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[10px] text-muted-foreground font-medium">Discovered</span>
                    <span className="text-lg font-bold">{job.total_items || 0}</span>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[10px] text-green-600 dark:text-green-400 font-medium">Success</span>
                    <span className="text-lg font-bold text-green-600 dark:text-green-400">{job.success_count || 0}</span>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[10px] text-red-600 dark:text-red-400 font-medium">Failed</span>
                    <span className="text-lg font-bold text-red-600 dark:text-red-400">{job.failure_count || 0}</span>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[10px] text-muted-foreground font-medium">Processed</span>
                    <span className="text-lg font-bold">{job.processed_items || 0}</span>
                  </div>
                </div>

                {(job.total_items || 0) > 0 && (
                  <div className="mt-4 flex flex-col gap-1.5">
                    <div className="flex justify-between text-[10px] font-mono text-muted-foreground">
                      <span>{job.processed_items || 0} / {job.total_items} listings processed</span>
                      <span>{Math.round(((job.processed_items || 0) / (job.total_items || 1)) * 100)}%</span>
                    </div>
                    <div className="w-full bg-zinc-200 dark:bg-zinc-800 rounded-full h-2 overflow-hidden">
                      <div
                        className="bg-gradient-to-r from-blue-500 to-blue-600 h-2 rounded-full transition-all duration-700 ease-out"
                        style={{ width: `${((job.processed_items || 0) / (job.total_items || 1)) * 100}%` }}
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Metadata */}
              <div className="bg-zinc-50 dark:bg-zinc-900/50 p-4 rounded-xl border">
                <h4 className="text-xs font-semibold mb-3 text-muted-foreground uppercase tracking-wider">Job Details</h4>
                <div className="grid grid-cols-2 gap-y-3 gap-x-6 text-sm">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[10px] text-muted-foreground uppercase">Format</span>
                    <span className="font-semibold capitalize">{job.format}</span>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[10px] text-muted-foreground uppercase">Mode</span>
                    <span className="font-semibold">{job.headless ? "Headless" : "Windowed"}</span>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[10px] text-muted-foreground uppercase">Started</span>
                    <span className="font-semibold text-xs">{formatDate(job.started_at)}</span>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[10px] text-muted-foreground uppercase">Completed</span>
                    <span className="font-semibold text-xs">{job.completed_at ? formatDate(job.completed_at) : "—"}</span>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[10px] text-muted-foreground uppercase">Records</span>
                    <span className="font-semibold">{job.record_count} leads</span>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[10px] text-muted-foreground uppercase">Step</span>
                    <span className="font-semibold capitalize">{job.current_step || "idle"}</span>
                  </div>
                </div>
              </div>

              {/* Error Message */}
              {job.error_message && (
                <div className="bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900/40 rounded-xl p-4">
                  <h4 className="text-xs font-semibold text-red-600 dark:text-red-400 flex items-center gap-2 mb-2">
                    <AlertTriangle className="size-3.5" /> Error Details
                  </h4>
                  <p className="text-sm text-red-700 dark:text-red-300 font-mono whitespace-pre-wrap">{job.error_message}</p>
                </div>
              )}
            </div>
          )}

          {activeTab === "items" && (
            <div className="animate-in fade-in duration-200">
              {itemsLoading ? (
                <div className="flex flex-col gap-2">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Skeleton key={i} className="h-8 w-full" />
                  ))}
                </div>
              ) : items.length > 0 ? (
                <div className="border rounded-lg overflow-hidden">
                  <div className="max-h-[500px] overflow-y-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="text-[11px]">URL</TableHead>
                          <TableHead className="text-[11px] w-[80px]">Status</TableHead>
                          <TableHead className="text-[11px] w-[130px]">Scraped At</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {items.map((item) => (
                          <TableRow key={item.id}>
                            <TableCell className="text-xs font-mono truncate max-w-[300px]" title={item.url}>
                              <a
                                href={item.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1"
                              >
                                {item.url.replace("https://www.google.com/maps/place/", "").slice(0, 50)}...
                                <ArrowUpRight className="size-3 shrink-0" />
                              </a>
                            </TableCell>
                            <TableCell>
                              <StatusBadge status={item.status as "completed" | "failed" | "running" | "stopped"} />
                            </TableCell>
                            <TableCell className="text-[11px] text-muted-foreground">
                              {formatDate(item.scraped_at)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                  <div className="p-3 border-t bg-zinc-50/50 dark:bg-zinc-900/30 text-xs text-muted-foreground">
                    Showing {items.length} scraped items
                  </div>
                </div>
              ) : (
                <div className="text-center text-muted-foreground py-12 text-sm">
                  No individual items recorded for this job.
                </div>
              )}
            </div>
          )}

          {activeTab === "console" && (
            <div className="animate-in fade-in duration-200">
              <JobConsole messages={liveMessages} isLive={job.status === "running"} />
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="flex items-center gap-2 p-4 border-t bg-zinc-50/50 dark:bg-zinc-900/30">
          {job.status === "running" && (
            <Button variant="destructive" size="sm" onClick={() => onStop(job.id)} className="cursor-pointer text-xs">
              <Square className="size-3 mr-1.5" /> Stop Job
            </Button>
          )}
          {(job.status === "stopped" || job.status === "failed") && (
            <Button variant="outline" size="sm" onClick={() => onResume(job.id)} className="cursor-pointer text-xs hover:bg-green-50 hover:text-green-600 dark:hover:bg-green-950/20">
              <Play className="size-3 mr-1.5" /> Resume
            </Button>
          )}
          {job.status === "completed" && (
            <Button variant="outline" size="sm" onClick={() => onDownload(job.id)} className="cursor-pointer text-xs">
              <Download className="size-3 mr-1.5" /> Download
            </Button>
          )}
          <div className="flex-1" />
          <Button
            variant="ghost"
            size="sm"
            className="cursor-pointer text-xs text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/20"
            onClick={() => {
              onDelete(job.id);
              onClose();
            }}
          >
            <Trash2 className="size-3 mr-1.5" /> Delete
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────
export default function HistoryPage() {
  const containerRef = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      gsap.from(".stagger-card", {
        y: 40,
        opacity: 0,
        duration: 0.8,
        stagger: 0.1,
        ease: "power3.out",
        clearProps: "all",
      });
    },
    { scope: containerRef }
  );

  const [jobs, setJobs] = useState<ScrapeJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [counts, setCounts] = useState<StatusCounts>({ all: 0, running: 0, completed: 0, stopped: 0, failed: 0 });
  const [activeFilter, setActiveFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [selectedJob, setSelectedJob] = useState<ScrapeJob | null>(null);
  const [liveMessages, setLiveMessages] = useState<string[]>([]);
  const PAGE_SIZE = 15;

  const fetchHistory = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        status: activeFilter,
        limit: String(PAGE_SIZE),
        offset: String(page * PAGE_SIZE),
      });
      if (search) params.set("search", search);

      const res = await fetch(`/api/v2/history?${params}`);
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          setJobs(data.jobs);
          setTotal(data.total);
          setCounts(data.counts);
        }
      }
    } catch {
      toast.error("Failed to fetch execution history.");
    } finally {
      setLoading(false);
    }
  }, [activeFilter, page, search]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  // Poll for updates if there are running jobs
  useEffect(() => {
    if (counts.running > 0) {
      const interval = setInterval(fetchHistory, 3000);
      return () => clearInterval(interval);
    }
  }, [counts.running, fetchHistory]);

  // SSE for live messages when a job is selected
  useEffect(() => {
    if (!selectedJob || selectedJob.status !== "running") return;

    const eventSource = new EventSource("/api/v2/stream");
    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        const jobData = data[String(selectedJob.id)];
        if (jobData?.messages) {
          setLiveMessages(jobData.messages);
        }
      } catch {
        // ignore
      }
    };

    return () => eventSource.close();
  }, [selectedJob?.id, selectedJob?.status]);

  const stopJob = async (jobId: number) => {
    try {
      const res = await fetch("/api/stop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ job_id: jobId }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        toast.success(`Stop signal sent to job #${jobId}`);
        fetchHistory();
      } else {
        toast.error(data.message || "Failed to stop job.");
      }
    } catch {
      toast.error("Error stopping job.");
    }
  };

  const resumeJob = async (jobId: number) => {
    try {
      const res = await fetch(`/api/v2/jobs/${jobId}/resume`, { method: "POST" });
      const data = await res.json();
      if (res.ok && data.success) {
        toast.success(`Job #${jobId} resumed successfully!`);
        fetchHistory();
      } else {
        toast.error(data.error || "Failed to resume job.");
      }
    } catch {
      toast.error("Error resuming job.");
    }
  };

  const downloadJob = async (jobId: number) => {
    const job = jobs.find((j) => j.id === jobId);
    if (!job) return;

    try {
      const filesRes = await fetch("/api/files");
      if (filesRes.ok) {
        const files = await filesRes.json();
        // Find the latest file matching the job query
        const matchingFile = files.find((f: { name: string }) =>
          f.name.toLowerCase().includes(job.query.toLowerCase().replace(/\s+/g, "_").slice(0, 20))
        );
        if (matchingFile) {
          window.open(`/api/download/${encodeURIComponent(matchingFile.name)}`, "_blank");
          return;
        }
      }
    } catch {
      // fallback
    }
    toast.info("Navigate to Export History to download output files.");
  };

  const deleteJob = async (jobId: number) => {
    try {
      const res = await fetch(`/api/v2/history/${jobId}`, { method: "DELETE" });
      const data = await res.json();
      if (res.ok && data.success) {
        toast.success(`Job #${jobId} deleted.`);
        fetchHistory();
      } else {
        toast.error("Failed to delete job.");
      }
    } catch {
      toast.error("Error deleting job.");
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div ref={containerRef} className="flex flex-col gap-6">
      <PageHeader
        title="Execution History"
        description="Monitor, review, and manage all scraping job executions."
      />

      {/* Summary Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 stagger-card">
        {STATUS_TABS.map((tab) => {
          const Icon = tab.icon;
          const count = counts[tab.key as keyof StatusCounts] || 0;
          return (
            <button
              key={tab.key}
              onClick={() => {
                setActiveFilter(tab.key);
                setPage(0);
              }}
              className={`group relative flex flex-col items-center justify-center p-4 rounded-xl border transition-all duration-200 cursor-pointer ${
                activeFilter === tab.key
                  ? "bg-primary/5 border-primary/30 shadow-sm shadow-primary/10"
                  : "bg-card border-border/50 hover:bg-zinc-50 dark:hover:bg-zinc-900/50 hover:border-border"
              }`}
            >
              <Icon
                className={`size-5 mb-1.5 transition-colors ${
                  activeFilter === tab.key ? "text-primary" : tab.color + " group-hover:scale-110 transition-transform"
                }`}
              />
              <span className="text-2xl font-bold font-mono">{count}</span>
              <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mt-0.5">
                {tab.label}
              </span>
              {activeFilter === tab.key && (
                <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-8 h-0.5 bg-primary rounded-full" />
              )}
            </button>
          );
        })}
      </div>

      {/* Search & Controls */}
      <div className="flex items-center gap-3 stagger-card">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            placeholder="Search by query..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(0);
            }}
            className="pl-10 h-9 text-sm"
          />
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={fetchHistory}
          className="cursor-pointer h-9 text-xs gap-1.5"
        >
          <RefreshCw className="size-3.5" />
          Refresh
        </Button>
      </div>

      {/* Job Table */}
      <Card className="stagger-card shadow-sm border-border/50">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <History className="size-4 text-primary" />
            Execution Log
          </CardTitle>
          <CardDescription>
            {total} job{total !== 1 ? "s" : ""} found
            {activeFilter !== "all" && ` with status "${activeFilter}"`}
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-6 flex flex-col gap-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : jobs.length > 0 ? (
            <>
              <div className="border-t overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-zinc-50/50 dark:bg-zinc-900/30">
                      <TableHead className="text-[11px] font-semibold w-[50px]">#</TableHead>
                      <TableHead className="text-[11px] font-semibold">Query</TableHead>
                      <TableHead className="text-[11px] font-semibold hidden md:table-cell">Format</TableHead>
                      <TableHead className="text-[11px] font-semibold text-center">Records</TableHead>
                      <TableHead className="text-[11px] font-semibold hidden lg:table-cell">Duration</TableHead>
                      <TableHead className="text-[11px] font-semibold hidden md:table-cell">Started</TableHead>
                      <TableHead className="text-[11px] font-semibold text-center">Status</TableHead>
                      <TableHead className="text-[11px] font-semibold text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {jobs.map((job) => (
                      <TableRow
                        key={job.id}
                        className="group cursor-pointer hover:bg-zinc-50/80 dark:hover:bg-zinc-900/40 transition-colors"
                        onClick={() => {
                          setSelectedJob(job);
                          setLiveMessages([]);
                        }}
                      >
                        <TableCell className="font-mono text-xs text-muted-foreground">{job.id}</TableCell>
                        <TableCell className="font-semibold text-sm truncate max-w-[200px] lg:max-w-xs" title={job.query}>
                          {job.query}
                        </TableCell>
                        <TableCell className="hidden md:table-cell capitalize text-xs">{job.format}</TableCell>
                        <TableCell className="text-center">
                          <span className="font-mono font-semibold text-sm">
                            {job.success_count || job.record_count || 0}
                          </span>
                        </TableCell>
                        <TableCell className="hidden lg:table-cell text-xs text-muted-foreground font-mono">
                          {formatDuration(job.started_at, job.completed_at)}
                        </TableCell>
                        <TableCell className="hidden md:table-cell text-xs text-muted-foreground">
                          {formatDate(job.started_at)}
                        </TableCell>
                        <TableCell className="text-center">
                          <StatusBadge status={job.status} />
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity" onClick={(e) => e.stopPropagation()}>
                            {job.status === "running" && (
                              <Button variant="ghost" size="icon" className="size-7 cursor-pointer text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20" onClick={() => stopJob(job.id)}>
                                <Square className="size-3" />
                              </Button>
                            )}
                            {(job.status === "stopped" || job.status === "failed") && (
                              <Button variant="ghost" size="icon" className="size-7 cursor-pointer text-green-600 hover:bg-green-50 dark:hover:bg-green-950/20" onClick={() => resumeJob(job.id)}>
                                <Play className="size-3" />
                              </Button>
                            )}
                            {job.status === "completed" && (
                              <Button variant="ghost" size="icon" className="size-7 cursor-pointer" onClick={() => downloadJob(job.id)}>
                                <Download className="size-3" />
                              </Button>
                            )}
                            <Button variant="ghost" size="icon" className="size-7 cursor-pointer text-muted-foreground hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20" onClick={() => deleteJob(job.id)}>
                              <Trash2 className="size-3" />
                            </Button>
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-7 cursor-pointer group-hover:hidden"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedJob(job);
                              setLiveMessages([]);
                            }}
                          >
                            <Eye className="size-3.5 text-muted-foreground" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Pagination */}
              <div className="flex items-center justify-between p-4 border-t bg-zinc-50/50 dark:bg-zinc-900/30">
                <span className="text-xs text-muted-foreground">
                  Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of {total}
                </span>
                <div className="flex items-center gap-1.5">
                  <Button
                    variant="outline"
                    size="icon"
                    className="size-8 cursor-pointer"
                    disabled={page === 0}
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                  >
                    <ChevronLeft className="size-4" />
                  </Button>
                  <span className="text-xs font-mono px-2">
                    {page + 1} / {totalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="icon"
                    className="size-8 cursor-pointer"
                    disabled={page >= totalPages - 1}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    <ChevronRight className="size-4" />
                  </Button>
                </div>
              </div>
            </>
          ) : (
            <div className="flex flex-col items-center justify-center text-center p-12 text-muted-foreground">
              <Clock className="size-10 text-zinc-300 dark:text-zinc-700 mb-4" />
              <p className="font-semibold text-zinc-600 dark:text-zinc-400">No execution history</p>
              <p className="text-xs mt-1 max-w-xs">
                {activeFilter !== "all"
                  ? `No jobs with status "${activeFilter}" found.`
                  : "Start a scraping job from the Scraper Panel to see it here."}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Job Detail Drawer */}
      {selectedJob && (
        <JobDetailDrawer
          job={selectedJob}
          onClose={() => setSelectedJob(null)}
          onStop={stopJob}
          onResume={resumeJob}
          onDownload={downloadJob}
          onDelete={deleteJob}
          liveMessages={liveMessages}
        />
      )}
    </div>
  );
}
