"use client"

import React, { useState, useEffect, useRef } from "react";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { MetricCard } from "@/components/metric-card";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Play,
  Square,
  Terminal as ConsoleIcon,
  Cpu,
  Database,
  Sparkles,
  Activity,
  List,
  ChevronRight
} from "lucide-react";
import { toast } from "sonner";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";

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
}

interface ActiveJobState {
  is_running: boolean;
  is_queued?: boolean;
  queue_position?: number;
  messages: string[];
  scraped_count: number;
  query: string;
  format: string;
  total_items: number;
  processed_items: number;
  success_count: number;
  failure_count: number;
  current_step: string;
}

const DEFAULT_CATEGORIES = [
  "Restaurant", "Cafe", "Dentist", "Gym", "Spa", "Hotel", "Hair salon",
  "Real estate agency", "Bakery", "Boutique", "Supermarket", "Pharmacy",
  "Car wash", "Barber shop", "Coffee shop", "Pizza restaurant"
];

function ConsoleWindow({ messages, isRunning }: { messages: string[], isRunning: boolean }) {
  const endRef = useRef<HTMLDivElement>(null);
  
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  return (
    <CardContent className="flex-1 p-0 flex flex-col bg-zinc-950 text-zinc-300 font-mono text-xs rounded-b-xl overflow-hidden min-h-[350px] max-h-[500px]">
      <div className="flex-1 p-4 overflow-y-auto flex flex-col gap-1.5 selection:bg-zinc-800">
        {messages.length > 0 ? (
          messages.map((msg, i) => (
            <div key={i} className="leading-relaxed whitespace-pre-wrap">
              <span className="text-zinc-500 mr-2">[{i + 1}]</span>
              <span>{msg}</span>
            </div>
          ))
        ) : (
          <div className="text-zinc-500 italic h-full flex items-center justify-center min-h-[150px]">
            Console idle. Start a scraping job to view logs.
          </div>
        )}
        <div ref={endRef} />
      </div>
    </CardContent>
  );
}

export default function ScraperPage() {
  const containerRef = useRef<HTMLDivElement>(null);

  useGSAP(() => {
    gsap.from(".stagger-card", {
      y: 40,
      opacity: 0,
      duration: 0.8,
      stagger: 0.1,
      ease: "power3.out",
      clearProps: "all"
    });
  }, { scope: containerRef });

  const [query, setQuery] = useState("");
  const [format, setFormat] = useState("excel");
  const [headless, setHeadless] = useState(true);
  const [enableEnrichment, setEnableEnrichment] = useState(false);
  const [skipPreviouslyScraped, setSkipPreviouslyScraped] = useState(false);
  const [enrichmentModel, setEnrichmentModel] = useState("openrouter|google/gemini-2.5-flash");
  
  const [activeJobs, setActiveJobs] = useState<Record<string, ActiveJobState>>({});
  const [history, setHistory] = useState<ScrapeJob[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [dbCategories, setDbCategories] = useState<string[]>([]);

  // UI State
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);

  // In-dashboard alerts (failed jobs / critical errors)
  interface AlertItem {
    id: number;
    job_id: string | null;
    severity: string;
    title: string;
    detail: string | null;
    created_at: string;
  }
  const [alerts, setAlerts] = useState<AlertItem[]>([]);

  const fetchAlerts = async () => {
    try {
      const res = await fetch("/api/v2/alerts?unread_only=true&limit=20");
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) setAlerts(data);
      }
    } catch {
      // ignore
    }
  };

  const dismissAlerts = async () => {
    setAlerts([]);
    try {
      await fetch("/api/v2/alerts/read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    fetchAlerts();
    const id = setInterval(fetchAlerts, 10000);
    return () => clearInterval(id);
  }, []);

  const translateLog = (msg: string): string => {
    if (!msg) return "";
    if (msg.includes("chromedriver unexpectedly exited") || msg.includes("Status code was: -11") || msg.includes("WebBridge Exception")) {
      return "⚠️ [Browser Crash]: The browser process unexpectedly shut down.";
    }
    if (msg.includes("timeout") || msg.includes("loader has changed")) {
      return "🕒 [Sync Delay]: Page took longer than expected to load. Retrying...";
    }
    if (msg.includes("ds0") || msg.includes("NO_RECORD_TO_SAVE")) {
      return "❌ [Empty Result]: No leads were found for this query.";
    }
    return msg;
  };

  const fetchHistory = async () => {
    try {
      const res = await fetch("/api/v2/jobs?limit=10");
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          setHistory(data.jobs);
        }
      }
    } catch (e) {
      // ignore
    } finally {
      setHistoryLoading(false);
    }
  };

  useEffect(() => {
    fetchHistory();

    // Fetch unique categories for suggestions
    fetch("/api/v2/filters/options")
      .then((res) => res.json())
      .then((data) => {
        if (data.success && data.options?.categories) {
          const cats = data.options.categories.filter(
            (c: any) => typeof c === "string" && c.trim() !== ""
          );
          setDbCategories(cats);
        }
      })
      .catch((err) => console.error("Error fetching categories:", err));
    
    let eventSource: EventSource;
    let reconnectTimeoutId: NodeJS.Timeout;
    let reconnectAttempt = 0;

    const connectSSE = () => {
      eventSource = new EventSource("/api/v2/stream");

      eventSource.onopen = () => {
        reconnectAttempt = 0;
      };

      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          
          setActiveJobs(prev => {
              const newActiveJobs: Record<string, ActiveJobState> = {};
              for (const [jid, job] of Object.entries(data)) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const typedJob = job as any;
              if (typedJob.is_running || typedJob.is_queued) {
                newActiveJobs[jid] = {
                  is_running: typedJob.is_running,
                  is_queued: typedJob.is_queued || false,
                  queue_position: typedJob.queue_position,
                  messages: typedJob.messages ? typedJob.messages.map(translateLog) : [],
              scraped_count: typedJob.scraped_count || 0,
              query: typedJob.query || typedJob.current_query || "",
              format: typedJob.format || "excel",
              total_items: typedJob.total_items || 0,
              processed_items: typedJob.processed_items || 0,
              success_count: typedJob.success_count || 0,
              failure_count: typedJob.failure_count || 0,
              current_step: typedJob.is_queued ? "queued" : (typedJob.current_step || "idle")
                };
              } else if (prev[jid]) {
                 // Job finished, fetch history once
                 fetchHistory();
              }
            }
            return newActiveJobs;
        });

      } catch (e) {
        console.error("Error parsing SSE data", e);
      }
    };

    eventSource.onerror = () => {
        eventSource.close();
        // Exponential backoff
        const timeout = Math.min(1000 * Math.pow(2, reconnectAttempt), 30000);
        reconnectAttempt++;
        reconnectTimeoutId = setTimeout(connectSSE, timeout);
    };
  };

  connectSSE();

  return () => {
    if (eventSource) eventSource.close();
    if (reconnectTimeoutId) clearTimeout(reconnectTimeoutId);
  };
}, []); // Run once on mount

  const startScrape = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) {
      toast.error("Please enter a search query.");
      return;
    }

    try {
      // Go through /api/v2/jobs so a scrape_jobs row is created and we get the
      // integer job_id the backend/SSE/history all key off of. Posting to
      // /api/scrape directly skips that row, leaving progress and history empty.
      const res = await fetch("/api/v2/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query,
          format,
          headless,
          enable_enrichment: enableEnrichment,
          enrichment_model: enrichmentModel,
          skip_previously_scraped: skipPreviouslyScraped,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        toast.error(data.message || "Failed to start scraping job.");
        return;
      }

      setQuery(""); // Clear input on success
      toast.success("Scraper started successfully!");
      if (data.job_id) {
          setSelectedJobId(data.job_id);
      }
      fetchHistory();
    } catch (err) {
      toast.error("Error starting scraper.");
    }
  };

  const stopScrape = async (jobId: string) => {
    try {
      const res = await fetch("/api/stop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ job_id: jobId })
      });
      const data = await res.json();
      
      if (res.ok && data.success) {
        toast.success(`Stop signal sent to job ${jobId}.`);
      } else {
        toast.error(data.message || "Failed to stop scraper.");
      }
    } catch (e) {
      toast.error("Error sending stop command.");
    }
  };

  const resumeScrape = async (jobId: string) => {
    try {
      const res = await fetch(`/api/v2/jobs/${jobId}/resume`, {
        method: "POST",
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        toast.error(data.error || "Failed to resume scraping job.");
        return;
      }

      toast.success(`Scraper job ${jobId} resumed successfully!`);
      setSelectedJobId(jobId);
      fetchHistory();
    } catch (err) {
      toast.error("Error resuming scraper.");
    }
  };

  const runningJobIds = Object.keys(activeJobs).sort((a,b) => b.localeCompare(a));
  
  // If selected job is done, clear selection eventually, or keep showing it from state
  const selectedJob = selectedJobId ? activeJobs[selectedJobId] : null;

  // Auto-select first job if none selected and jobs exist
  useEffect(() => {
      if (!selectedJobId && runningJobIds.length > 0) {
          setSelectedJobId(runningJobIds[0]);
      } else if (selectedJobId && !activeJobs[selectedJobId]) {
          // If the selected job finishes, select another one or null
          if (runningJobIds.length > 0) {
            setSelectedJobId(runningJobIds[0]);
          } else {
            setSelectedJobId(null);
          }
      }
  }, [runningJobIds.length, activeJobs, selectedJobId]);

  return (
    <div ref={containerRef} className="flex flex-col gap-6">
      <PageHeader
        title="Scraper Panel"
        description="Configure, start, and monitor Google Maps scraper processes."
      />

      {alerts.length > 0 && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3">
          <div className="flex items-start justify-between gap-4">
            <div className="flex flex-col gap-1">
              <span className="text-sm font-semibold text-red-500">
                {alerts.length} alert{alerts.length > 1 ? "s" : ""} — job failures / errors
              </span>
              <ul className="text-xs text-muted-foreground list-disc pl-4 space-y-0.5">
                {alerts.slice(0, 4).map((a) => (
                  <li key={a.id}>
                    <span className="font-medium">{a.title}</span>
                    {a.detail ? ` — ${a.detail.slice(0, 120)}` : ""}
                  </li>
                ))}
              </ul>
            </div>
            <button
              onClick={dismissAlerts}
              className="text-xs font-medium text-muted-foreground hover:text-foreground shrink-0"
            >
              Dismiss all
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Form Config & Active Jobs List */}
        <div className="flex flex-col gap-6">
          <Card className="stagger-card shadow-sm border-border/50">
            <CardHeader>
              <CardTitle className="text-base font-semibold">Configuration</CardTitle>
              <CardDescription>Start a new scraping process</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={startScrape} className="flex flex-col gap-4">
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="query" className="text-xs font-semibold text-muted-foreground">
                    Search Queries
                  </label>
                  <Input
                    id="query"
                    list="category-suggestions"
                    placeholder="e.g. Cafes in Gulberg Lahore"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    required
                  />
                  <datalist id="category-suggestions">
                    {(dbCategories.length > 0 ? dbCategories : DEFAULT_CATEGORIES).map((category, idx) => (
                      <option key={idx} value={category.toLowerCase().endsWith(" in") || category.includes(" in ") ? category : `${category} in `} />
                    ))}
                  </datalist>
                  <div className="flex flex-wrap gap-1.5 mt-1">
                    {(dbCategories.length > 0 ? dbCategories : DEFAULT_CATEGORIES).slice(0, 12).map(category => (
                      <button
                        key={category}
                        type="button"
                        onClick={() => setQuery(prev => prev ? `${prev}, ${category}` : category)}
                        className="text-[10px] px-2 py-0.5 rounded-full bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 transition-colors text-muted-foreground hover:text-foreground cursor-pointer"
                      >
                        {category}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                    <div className="flex flex-col gap-1.5">
                      <label htmlFor="format" className="text-[10px] font-semibold text-muted-foreground uppercase">
                        Format
                      </label>
                      <Select value={format} onValueChange={(val) => setFormat(val || "excel")}>
                        <SelectTrigger id="format" className="w-full h-8 text-xs">
                          <SelectValue placeholder="Select format" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="excel">Excel</SelectItem>
                          <SelectItem value="csv">CSV</SelectItem>
                          <SelectItem value="json">JSON</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="flex flex-col gap-1.5">
                      <label className="text-[10px] font-semibold text-muted-foreground uppercase">
                        Headless
                      </label>
                      <div className="flex items-center h-8">
                        <Switch checked={headless} onCheckedChange={setHeadless} aria-label="Toggle Headless Mode" />
                      </div>
                    </div>
                </div>

                <div className="flex flex-col gap-2 border p-3 rounded-lg bg-zinc-50/50 dark:bg-zinc-900/50 mt-1">
                  <div className="flex items-center justify-between">
                    <div className="flex flex-col gap-0.5">
                      <span className="text-xs font-semibold flex items-center gap-1.5"><Sparkles className="size-3.5 text-primary" /> Enable AI Enrichment</span>
                    </div>
                    <Switch checked={enableEnrichment} onCheckedChange={setEnableEnrichment} aria-label="Toggle AI Enrichment" />
                  </div>
                  
                  {enableEnrichment && (
                    <div className="flex flex-col gap-1.5 mt-2 pt-2 border-t">
                      <Select value={enrichmentModel} onValueChange={(val) => setEnrichmentModel(val || "")}>
                        <SelectTrigger className="w-full h-8 text-xs">
                          <SelectValue placeholder="Select model" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="local|local">Local Python Enricher (Offline)</SelectItem>
                          <SelectItem value="mix|mix">Hybrid / Mixed (Local + AI)</SelectItem>
                          <SelectItem value="openrouter|google/gemini-2.5-flash">Gemini 2.5 Flash</SelectItem>
                          <SelectItem value="openrouter|anthropic/claude-3-haiku">Claude 3 Haiku</SelectItem>
                          <SelectItem value="groq|llama3-8b-8192">Groq LLaMA 3</SelectItem>
                          <SelectItem value="openai|gpt-4o-mini">GPT-4o Mini</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </div>

                <div className="flex items-center justify-between border p-3 rounded-lg bg-zinc-50/50 dark:bg-zinc-900/50 mt-1">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-xs font-semibold">Skip previously scraped</span>
                    <span className="text-[10px] text-muted-foreground">
                      Don&apos;t re-scrape businesses already in your results.
                    </span>
                  </div>
                  <Switch
                    checked={skipPreviouslyScraped}
                    onCheckedChange={setSkipPreviouslyScraped}
                    aria-label="Skip previously scraped businesses"
                  />
                </div>

                <div className="flex flex-col gap-2 mt-2">
                  <Button type="submit" className="w-full cursor-pointer h-9 text-xs">
                    <Play className="size-3 mr-2" data-icon="inline-start" /> Launch Scraper
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>

          {/* Active Jobs Sidebar List */}
          <Card className="stagger-card shadow-sm border-border/50">
            <CardHeader className="py-4 border-b">
              <CardTitle className="text-sm font-semibold flex justify-between items-center">
                 <span className="flex items-center gap-2"><Activity className="size-4 text-blue-500" /> Active Processes</span>
                 <span className="bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-400 px-2 rounded-full text-xs">{runningJobIds.length}</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0 flex flex-col max-h-[300px] overflow-y-auto">
                {runningJobIds.length === 0 ? (
                    <div className="p-6 text-center text-xs text-muted-foreground flex flex-col items-center gap-2">
                        <List className="size-6 text-zinc-300 dark:text-zinc-700" />
                        No active processes.
                    </div>
                ) : (
                    runningJobIds.map(jid => {
                        const j = activeJobs[jid];
                        const isSelected = selectedJobId === jid;
                        return (
                            <button
                                key={jid}
                                onClick={() => setSelectedJobId(jid)}
                                className={`flex flex-col text-left p-3 border-b transition-colors cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-900/50 ${isSelected ? 'bg-blue-50/50 dark:bg-blue-900/20 border-l-4 border-l-blue-500' : 'border-l-4 border-l-transparent'}`}
                            >
                                <div className="flex justify-between items-center w-full">
                                    <span className="font-semibold text-xs truncate max-w-[150px]">{j.query}</span>
                                    <ChevronRight className={`size-3 text-muted-foreground transition-transform ${isSelected ? 'translate-x-1' : ''}`} />
                                </div>
                                <div className="flex justify-between items-center w-full mt-1">
                                    <span className="text-[10px] text-muted-foreground uppercase">{j.current_step}</span>
                                    <span className="text-xs font-mono font-medium">{j.scraped_count} leads</span>
                                </div>
                            </button>
                        );
                    })
                )}
            </CardContent>
          </Card>
        </div>

        {/* Right Column: Live Job Details */}
        <div className="lg:col-span-2 flex flex-col gap-6">
          {!selectedJob ? (
             <div className="stagger-card border border-dashed rounded-xl p-12 flex flex-col items-center justify-center text-center text-muted-foreground bg-zinc-50/50 dark:bg-zinc-900/20 h-full min-h-[400px]">
               <Cpu className="size-8 text-zinc-300 dark:text-zinc-700 mb-4" />
               <p className="font-semibold text-zinc-600 dark:text-zinc-400">Select a process</p>
               <p className="text-xs mt-1 max-w-sm">Launch a new process from the sidebar or click an active one to view its telemetry.</p>
             </div>
          ) : (
             <div className="flex flex-col gap-4 animate-in fade-in zoom-in-95 duration-200 h-full">
                <div className="flex items-center justify-between pb-2">
                <h3 className="font-semibold text-lg flex items-center gap-2">
                    Job #{selectedJobId} <span className="flex h-2 w-2 rounded-full bg-blue-500 animate-ping" />
                </h3>
                <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    onClick={() => stopScrape(selectedJobId!)}
                    className="cursor-pointer h-8 text-xs px-3"
                >
                    <Square className="size-3 mr-1.5" data-icon="inline-start" /> Terminate Job
                </Button>
                </div>
                
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <MetricCard
                    title="Active Search"
                    value={selectedJob.query || "Initializing..."}
                    description="currently scraping"
                    icon={Cpu}
                />
                <MetricCard
                    className="border-blue-500/20"
                    title="Records Extracted"
                    value={selectedJob.scraped_count}
                    description="leads saved to database"
                    icon={Database}
                />
                </div>
                
                <Card className="shadow-sm border-blue-500/20 bg-blue-50/5 dark:bg-blue-950/5">
                <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-semibold flex items-center justify-between">
                    <span>Execution Progress</span>
                    <span className="text-xs text-muted-foreground capitalize px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300 font-normal">
                        {selectedJob.current_step === 'scrolling' ? 'Scrolling Google Maps...' : selectedJob.current_step === 'scraping' ? 'Extracting details...' : selectedJob.current_step}
                    </span>
                    </CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-4">
                    <div className="grid grid-cols-4 gap-2 text-center">
                    <div className="bg-zinc-50 dark:bg-zinc-900/50 p-2 rounded-lg border">
                        <div className="text-[10px] font-semibold text-muted-foreground uppercase">Discovered</div>
                        <div className="text-lg font-bold">{selectedJob.total_items}</div>
                    </div>
                    <div className="bg-green-50/50 dark:bg-green-950/10 p-2 rounded-lg border border-green-500/10">
                        <div className="text-[10px] font-semibold text-green-600 dark:text-green-400 uppercase font-mono">Success</div>
                        <div className="text-lg font-bold text-green-600 dark:text-green-400">{selectedJob.success_count}</div>
                    </div>
                    <div className="bg-red-50/50 dark:bg-red-950/10 p-2 rounded-lg border border-red-500/10">
                        <div className="text-[10px] font-semibold text-red-600 dark:text-red-400 uppercase font-mono">Failed</div>
                        <div className="text-lg font-bold text-red-600 dark:text-red-400">{selectedJob.failure_count}</div>
                    </div>
                    <div className="bg-zinc-50 dark:bg-zinc-900/50 p-2 rounded-lg border">
                        <div className="text-[10px] font-semibold text-muted-foreground uppercase">Remaining</div>
                        <div className="text-lg font-bold">{Math.max(0, selectedJob.total_items - selectedJob.processed_items)}</div>
                    </div>
                    </div>

                    {selectedJob.total_items > 0 && (
                    <div className="flex flex-col gap-1.5 mt-1">
                        <div className="flex justify-between text-xs font-mono text-muted-foreground">
                        <span>Progress: {selectedJob.processed_items} / {selectedJob.total_items} listings</span>
                        <span>{Math.round((selectedJob.processed_items / selectedJob.total_items) * 100)}%</span>
                        </div>
                        <div className="w-full bg-zinc-200 dark:bg-zinc-800 rounded-full h-2 overflow-hidden">
                        <div 
                            className="bg-blue-600 dark:bg-blue-500 h-2 rounded-full transition-all duration-500 ease-out"
                            style={{ width: `${(selectedJob.processed_items / selectedJob.total_items) * 100}%` }}
                        />
                        </div>
                    </div>
                    )}
                </CardContent>
                </Card>
    
                <Card className="shadow-sm flex-1 flex flex-col">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3 border-b py-3">
                    <CardTitle className="text-sm font-semibold flex items-center gap-2">
                        <ConsoleIcon className="size-4 text-primary" /> Live Console Stream
                    </CardTitle>
                </CardHeader>
                <ConsoleWindow messages={selectedJob.messages} isRunning={selectedJob.is_running} />
                </Card>
            </div>
          )}
        </div>
      </div>
 
      {/* Scraper History Section */}
      <Card className="stagger-card shadow-sm mt-4">
        <CardHeader>
          <CardTitle className="text-base font-semibold">Scraper Execution History</CardTitle>
          <CardDescription>History logs of your previous scraping requests</CardDescription>
        </CardHeader>
        <CardContent>
          {historyLoading ? (
            <div className="flex flex-col gap-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : history.length > 0 ? (
            <div className="border rounded-lg overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Query</TableHead>
                    <TableHead className="hidden md:table-cell">Format</TableHead>
                    <TableHead className="hidden md:table-cell">Mode</TableHead>
                    <TableHead>Records</TableHead>
                    <TableHead>Started At</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {history.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell className="font-semibold text-foreground truncate max-w-[150px] sm:max-w-xs" title={item.query}>
                        {item.query}
                      </TableCell>
                      <TableCell className="hidden md:table-cell capitalize">{item.format}</TableCell>
                      <TableCell className="hidden md:table-cell">
                        {item.headless ? "Headless" : "Windowed"}
                      </TableCell>
                      <TableCell>{item.record_count} leads</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {new Date(item.started_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={item.status} />
                      </TableCell>
                      <TableCell className="text-right">
                        {(item.status === "stopped" || item.status === "failed") && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="cursor-pointer hover:bg-green-50 hover:text-green-600 dark:hover:bg-green-950/20 text-xs px-2.5 h-7"
                            onClick={() => resumeScrape(String(item.id))}
                            disabled={runningJobIds.includes(String(item.id))}
                          >
                            <Play className="size-3 mr-1" /> Resume
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="text-center text-muted-foreground p-8 text-sm">
              No previous scraper jobs in history.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
