"use client"

import React, { useState, useEffect, useRef, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import {
  Globe, Play, RefreshCw, Download, Mail, Phone, Link2,
  ShieldCheck, Copy, AlertTriangle, Sparkles, Layers,
} from "lucide-react";
import { toast } from "sonner";

interface EnrichmentJob {
  id: number;
  status: string;
  total: number;
  processed: number;
  succeeded: number;
  failed: number;
  created_at?: string;
  completed_at?: string;
  error_message?: string;
}

const TERMINAL = ["completed", "failed", "stopped"];

function gradeColor(grade?: string) {
  switch (grade) {
    case "A": return "bg-green-500/15 text-green-600 dark:text-green-400 border-green-500/30";
    case "B": return "bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30";
    case "C": return "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30";
    default: return "bg-zinc-500/15 text-zinc-600 dark:text-zinc-400 border-zinc-500/30";
  }
}

export default function LeadEnrichmentPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    }>
      <LeadEnrichmentInner />
    </Suspense>
  );
}

function LeadEnrichmentInner() {
  const searchParams = useSearchParams();
  const idsParam = searchParams ? searchParams.get("ids") : null;

  const [current, setCurrent] = useState<EnrichmentJob | null>(null);
  const [recent, setRecent] = useState<EnrichmentJob[]>([]);
  const [starting, setStarting] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Advanced enrichment parameters
  const [scope, setScope] = useState<"all" | "selected" | "category">(idsParam ? "selected" : "all");
  const [selectedIds] = useState<number[]>(
    idsParam ? idsParam.split(",").map(id => parseInt(id)).filter(id => !isNaN(id)) : []
  );
  
  const [categories, setCategories] = useState<string[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>("");
  
  const [provider, setProvider] = useState<string>("local");
  const [model, setModel] = useState<string>("local");

  const fetchRecent = useCallback(async () => {
    try {
      const res = await fetch("/api/v2/enrichment/status");
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) setRecent(data);
      }
    } catch { /* ignore */ }
  }, []);

  const pollJob = useCallback(async (jobId: number) => {
    try {
      const res = await fetch(`/api/v2/enrichment/status?enrichment_job_id=${jobId}`);
      if (res.ok) {
        const job: EnrichmentJob = await res.json();
        setCurrent(job);
        if (TERMINAL.includes(job.status)) {
          if (pollRef.current) clearInterval(pollRef.current);
          pollRef.current = null;
          fetchRecent();
          if (job.status === "completed") {
            toast.success(`Enrichment done: ${job.succeeded} enriched, ${job.failed} failed.`);
          }
        }
      }
    } catch { /* ignore */ }
  }, [fetchRecent]);

  const startPolling = useCallback((jobId: number) => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollJob(jobId);
    pollRef.current = setInterval(() => pollJob(jobId), 2000);
  }, [pollJob]);

  useEffect(() => {
    fetchRecent();
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [fetchRecent]);

  // Fetch unique categories
  useEffect(() => {
    const fetchCategories = async () => {
      try {
        const res = await fetch("/api/v2/filters/options");
        if (res.ok) {
          const data = await res.json();
          if (data.success && data.options?.categories) {
            setCategories(data.options.categories);
            if (data.options.categories.length > 0) {
              setSelectedCategory(data.options.categories[0]);
            }
          }
        }
      } catch (e) {}
    };
    fetchCategories();
  }, []);

  const start = async (endpoint: "start" | "retry") => {
    setStarting(true);
    try {
      const body: any = {};
      if (endpoint === "start") {
        if (scope === "selected") {
          body.record_ids = selectedIds;
        } else if (scope === "category") {
          body.category = selectedCategory;
        }
        body.provider = provider;
        body.model = model;
      }

      const res = await fetch(`/api/v2/enrichment/${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        toast.success(`${data.message} (${data.total} record(s))`);
        if (data.enrichment_job_id) startPolling(data.enrichment_job_id);
      } else {
        toast.error(data.message || "Could not start enrichment.");
      }
    } catch {
      toast.error("Network error.");
    } finally {
      setStarting(false);
    }
  };

  const exportLeads = (format: "csv" | "json") => {
    window.open(`/api/v2/enrichment/export?format=${format}`, "_blank");
  };

  const pct = current && current.total > 0
    ? Math.round((current.processed / current.total) * 100)
    : 0;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Website Lead Enrichment"
        description="Crawl business websites to extract emails, phones, WhatsApp, socials, executive names, tech stack, and score leads."
      >
        <Button variant="outline" size="sm" onClick={() => exportLeads("csv")}>
          <Download className="size-4" /> CSV
        </Button>
        <Button variant="outline" size="sm" onClick={() => exportLeads("json")}>
          <Download className="size-4" /> JSON
        </Button>
      </PageHeader>

      {/* Control card */}
      <Card className="shadow-sm border-border/50 bg-card/60 backdrop-blur-xl">
        <CardHeader>
          <CardTitle className="text-md flex items-center gap-2">
            <Globe className="size-4 text-primary" /> Run Enrichment
          </CardTitle>
          <CardDescription>
            Configure the enrichment scope, provider settings, and kick off the crawler on the shared queue.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 border p-4 rounded-xl bg-zinc-50/30 dark:bg-zinc-900/30">
            {/* Scope Selection */}
            <div className="flex flex-col gap-2">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Enrichment Scope</label>
              <Select value={scope} onValueChange={(val: any) => setScope(val)}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="Select enrichment scope" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Unenriched Leads</SelectItem>
                  {selectedIds.length > 0 && (
                    <SelectItem value="selected">Selected Leads ({selectedIds.length} items)</SelectItem>
                  )}
                  {categories.length > 0 && (
                    <SelectItem value="category">Leads by Category</SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>

            {/* Category selection (if applicable) */}
            {scope === "category" && categories.length > 0 && (
              <div className="flex flex-col gap-2 animate-in fade-in slide-in-from-top-1 duration-200">
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Select Category</label>
                <Select value={selectedCategory} onValueChange={(val) => setSelectedCategory(val || "")}>
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder="Select Category" />
                  </SelectTrigger>
                  <SelectContent>
                    {categories.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Provider selection */}
            <div className="flex flex-col gap-2">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Enricher Provider</label>
              <Select value={provider} onValueChange={(val) => {
                if (!val) return;
                setProvider(val);
                if (val === "local") setModel("local");
                else if (val === "mix") setModel("mix");
                else if (val === "openrouter") setModel("google/gemini-2.5-flash");
                else if (val === "openai") setModel("gpt-4o-mini");
                else if (val === "claude") setModel("claude-3-haiku-20240307");
                else if (val === "groq") setModel("llama3-8b-8192");
              }}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="Select provider" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="local">Local Offline Parser</SelectItem>
                  <SelectItem value="mix">Hybrid (Local + AI)</SelectItem>
                  <SelectItem value="openrouter">OpenRouter (Gemini)</SelectItem>
                  <SelectItem value="openai">OpenAI (GPT)</SelectItem>
                  <SelectItem value="claude">Anthropic (Claude)</SelectItem>
                  <SelectItem value="groq">Groq (LLaMA)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Model input (if applicable) */}
            {provider !== "local" && (
              <div className="flex flex-col gap-2 animate-in fade-in slide-in-from-top-1 duration-200">
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Model Name</label>
                <Input
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder="e.g. gpt-4o-mini"
                  className="h-9 text-xs"
                />
              </div>
            )}
          </div>

          <div className="flex flex-wrap gap-2 mt-2">
            <Button onClick={() => start("start")} disabled={starting}>
              <Play className="size-4" /> {starting ? "Starting…" : "Start Enrichment"}
            </Button>
            <Button variant="outline" onClick={() => start("retry")} disabled={starting}>
              <RefreshCw className="size-4" /> Retry Failed / Unfinished
            </Button>
          </div>

          {current && (
            <div className="flex flex-col gap-2 border rounded-lg p-4 bg-zinc-50/50 dark:bg-zinc-900/40">
              <div className="flex items-center justify-between text-sm">
                <span className="font-semibold">
                  Job #{current.id}
                  <Badge variant="outline" className="ml-2 capitalize">{current.status}</Badge>
                </span>
                <span className="text-muted-foreground">
                  {current.processed}/{current.total} · {current.succeeded} ok · {current.failed} failed
                </span>
              </div>
              <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full bg-primary transition-all duration-500"
                  style={{ width: `${pct}%` }}
                />
              </div>
              {current.error_message && (
                <span className="text-xs text-destructive flex items-center gap-1">
                  <AlertTriangle className="size-3" /> {current.error_message}
                </span>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Legend of what gets extracted */}
      <Card className="shadow-sm border-border/50 bg-card/60 backdrop-blur-xl">
        <CardHeader>
          <CardTitle className="text-md">What we extract</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
          <div className="flex items-center gap-2"><Mail className="size-4 text-primary" /> Emails</div>
          <div className="flex items-center gap-2"><Phone className="size-4 text-primary" /> Phones (E.164)</div>
          <div className="flex items-center gap-2"><Link2 className="size-4 text-primary" /> Social profiles</div>
          <div className="flex items-center gap-2"><ShieldCheck className="size-4 text-primary" /> Validation + score</div>
        </CardContent>
      </Card>

      {/* Recent jobs */}
      <Card className="shadow-sm border-border/50 bg-card/60 backdrop-blur-xl">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-md">Recent Enrichment Jobs</CardTitle>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={fetchRecent}>
            <RefreshCw className="size-4" />
          </Button>
        </CardHeader>
        <CardContent>
          {recent.length === 0 ? (
            <div className="text-sm text-muted-foreground py-4 border rounded-lg border-dashed text-center">
              No enrichment jobs yet.
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {recent.map((j) => (
                <div key={j.id} className="flex items-center justify-between border p-3 rounded-lg text-sm bg-zinc-50/40 dark:bg-zinc-900/40">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">#{j.id}</span>
                    <Badge variant="outline" className="capitalize">{j.status}</Badge>
                  </div>
                  <span className="text-muted-foreground">
                    {j.succeeded}/{j.total} enriched · {j.failed} failed
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
