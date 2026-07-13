"use client"

import React, { useState, useEffect, useRef } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Sparkles,
  Key,
  Trash2,
  TrendingUp,
  Activity,
  Coins
} from "lucide-react";
import { toast } from "sonner";

interface ApiKey {
  id: number;
  provider: string;
  api_key: string;
  is_active: boolean;
  created_at: string;
}

interface UsageRow {
  provider: string;
  model: string;
  prompt_tokens: number;
  completion_tokens: number;
  total_requests: number;
}

export default function EnrichmentPage() {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [usage, setUsage] = useState<UsageRow[]>([]);
  const [loading, setLoading] = useState(true);
  
  const containerRef = useRef<HTMLDivElement>(null);

  useGSAP(() => {
    gsap.from(".stagger-elem", {
      y: 20,
      opacity: 0,
      duration: 0.6,
      stagger: 0.05,
      ease: "power3.out",
      clearProps: "all"
    });
  }, { scope: containerRef });

  // Form states
  const [provider, setProvider] = useState("openrouter");
  const [apiKey, setApiKey] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);

  // Independent Enrichment
  const [jobs, setJobs] = useState<any[]>([]);
  const [selectedJob, setSelectedJob] = useState("");
  const [enrichmentProvider, setEnrichmentProvider] = useState("openrouter");
  const [enrichmentModel, setEnrichmentModel] = useState("google/gemini-2.5-flash");
  const [isEnriching, setIsEnriching] = useState(false);

  const fetchJobs = async () => {
    try {
      const res = await fetch("/api/v2/jobs");
      if (res.ok) {
        const data = await res.json();
        setJobs(data);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleStartEnrichment = async () => {
    if (!selectedJob) {
      toast.error("Please select a job first.");
      return;
    }
    setIsEnriching(true);
    try {
      const res = await fetch("/api/v2/enrich_job", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          job_id: selectedJob,
          provider: enrichmentProvider,
          model: enrichmentModel,
        }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        toast.success("Independent enrichment started! You can track its progress on the Scraper tab.");
        setSelectedJob("");
      } else {
        toast.error(data.message || "Failed to start enrichment.");
      }
    } catch (e) {
      toast.error("Network error.");
    } finally {
      setIsEnriching(false);
    }
  };


  const fetchKeys = async () => {
    try {
      const res = await fetch("/api/v2/keys");
      if (res.ok) {
        const data = await res.json();
        setKeys(data);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const fetchUsage = async () => {
    try {
      const res = await fetch("/api/v2/billing");
      if (res.ok) {
        const data = await res.json();
        setUsage(data);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const refreshData = async () => {
    setLoading(true);
    await Promise.all([fetchKeys(), fetchUsage(), fetchJobs()]);
    setLoading(false);
  };

  useEffect(() => {
    refreshData();
  }, []);

  const handleSaveKey = async () => {
    if (!apiKey) {
      toast.error("Please enter an API key.");
      return;
    }
    setIsSaving(true);
    try {
      const res = await fetch("/api/v2/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, api_key: apiKey }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        toast.success("API Key saved successfully.");
        setApiKey("");
        refreshData();
      } else {
        toast.error(data.error || "Failed to save API key.");
      }
    } catch (e) {
      toast.error("Network error.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleVerifyKey = async () => {
    if (!apiKey) {
      toast.error("Please enter an API key to verify.");
      return;
    }
    setIsVerifying(true);
    try {
      const res = await fetch("/api/v2/keys/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, api_key: apiKey }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        toast.success(data.message || "API Key verified successfully.");
      } else {
        toast.error(data.error || "Failed to verify API key.");
      }
    } catch (e) {
      toast.error("Network error during verification.");
    } finally {
      setIsVerifying(false);
    }
  };

  const handleDeleteKey = async (providerToDelete: string) => {
    if (!confirm(`Are you sure you want to delete the active ${providerToDelete} API key?`)) return;
    try {
      const res = await fetch(`/api/v2/keys/${providerToDelete}`, {
        method: "DELETE",
      });
      if (res.ok) {
        toast.success("API Key deleted.");
        refreshData();
      }
    } catch (e) {
      toast.error("Failed to delete key.");
    }
  };

  const calculateTotalTokens = () => {
    let totalPrompt = 0;
    let totalCompletion = 0;
    let totalReq = 0;
    usage.forEach(row => {
      totalPrompt += row.prompt_tokens;
      totalCompletion += row.completion_tokens;
      totalReq += row.total_requests;
    });
    return { prompt: totalPrompt, completion: totalCompletion, requests: totalReq };
  };

  const totals = calculateTotalTokens();
  
  // Very rough estimation just for UI demo ($0.075 per 1M prompt, $0.3 per 1M completion)
  // Assuming mostly gemini-2.5-flash-8b on OpenRouter
  const estCost = ((totals.prompt / 1_000_000) * 0.075 + (totals.completion / 1_000_000) * 0.3).toFixed(4);

  return (
    <div ref={containerRef} className="flex flex-col gap-6">
      <PageHeader
        title="AI Enrichment & Billing"
        description="Manage API keys, monitor token usage, and track enrichment costs."
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Left: API Keys */}
        <div className="flex flex-col gap-6">
          <Card className="stagger-elem shadow-sm border-border/50 bg-card/60 backdrop-blur-xl">
            <CardHeader>
              <CardTitle className="text-md flex items-center gap-2">
                <Key className="size-4 text-primary" /> Provider API Keys
              </CardTitle>
              <CardDescription>
                Add or replace API keys for OpenRouter, Groq, or OpenAI compatible providers.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="flex gap-2 items-center">
                <div className="flex-1 flex flex-col gap-1">
                  <label className="text-xs font-semibold">Provider</label>
                  <Select value={provider} onValueChange={(val) => setProvider(val || "")}>
                    <SelectTrigger className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="openrouter">OpenRouter (Recommended)</SelectItem>
                      <SelectItem value="groq">Groq</SelectItem>
                      <SelectItem value="openai">OpenAI</SelectItem>
                      <SelectItem value="claude">Claude (Anthropic)</SelectItem>
                      <SelectItem value="gemini">Gemini (Google AI)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex-[2] flex flex-col gap-1">
                  <label className="text-xs font-semibold">API Key</label>
                  <Input 
                    placeholder="sk-..." 
                    type="password"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    className="h-9"
                  />
                </div>
                <div className="flex gap-2 self-end">
                  <Button className="h-9" variant="outline" onClick={handleVerifyKey} disabled={isVerifying || !apiKey}>
                    {isVerifying ? "Verifying..." : "Verify Key"}
                  </Button>
                  <Button className="h-9" onClick={handleSaveKey} disabled={isSaving || !apiKey}>
                    {isSaving ? "Saving..." : "Save Key"}
                  </Button>
                </div>
              </div>
              
              <Separator className="my-2" />
              
              <div className="flex flex-col gap-2">
                <span className="text-xs font-semibold uppercase text-muted-foreground tracking-wider mb-1">
                  Active Keys
                </span>
                {loading ? (
                  <div className="text-sm text-muted-foreground py-2">Loading keys...</div>
                ) : keys.length === 0 ? (
                  <div className="text-sm text-muted-foreground py-2 border rounded-lg border-dashed text-center">
                    No active API keys found.
                  </div>
                ) : (
                  <div className="flex flex-col gap-2">
                    {keys.map((k) => (
                      <div key={k.id} className="flex items-center justify-between border p-3 rounded-lg bg-zinc-50/50 dark:bg-zinc-900/50">
                        <div className="flex flex-col">
                          <span className="text-sm font-bold capitalize">{k.provider}</span>
                          <span className="text-xs font-mono text-muted-foreground">{k.api_key}</span>
                        </div>
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                          onClick={() => handleDeleteKey(k.provider)}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right: Usage & Analytics */}
        <div className="flex flex-col gap-6">
          <Card className="stagger-elem shadow-sm border-border/50 bg-card/60 backdrop-blur-xl h-full">
            <CardHeader>
              <CardTitle className="text-md flex items-center gap-2">
                <TrendingUp className="size-4 text-primary" /> Token Usage & Analytics
              </CardTitle>
              <CardDescription>
                Overview of tokens processed during scraping enrichment.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
              
              <div className="grid grid-cols-2 gap-3">
                <div className="border p-3 rounded-lg bg-zinc-50/50 dark:bg-zinc-900/50 flex flex-col gap-1">
                  <span className="text-xs text-muted-foreground flex items-center gap-1"><Activity className="size-3" /> Total Requests</span>
                  <span className="text-xl font-bold text-foreground">
                    {loading ? "..." : totals.requests.toLocaleString()}
                  </span>
                </div>
                <div className="border p-3 rounded-lg bg-zinc-50/50 dark:bg-zinc-900/50 flex flex-col gap-1">
                  <span className="text-xs text-muted-foreground flex items-center gap-1"><Coins className="size-3" /> Est. Cost (USD)</span>
                  <span className="text-xl font-bold text-foreground">
                    {loading ? "..." : `$${estCost}`}
                  </span>
                </div>
                <div className="border p-3 rounded-lg bg-zinc-50/50 dark:bg-zinc-900/50 flex flex-col gap-1">
                  <span className="text-xs text-muted-foreground">Prompt Tokens</span>
                  <span className="text-lg font-bold text-foreground">
                    {loading ? "..." : totals.prompt.toLocaleString()}
                  </span>
                </div>
                <div className="border p-3 rounded-lg bg-zinc-50/50 dark:bg-zinc-900/50 flex flex-col gap-1">
                  <span className="text-xs text-muted-foreground">Completion Tokens</span>
                  <span className="text-lg font-bold text-foreground">
                    {loading ? "..." : totals.completion.toLocaleString()}
                  </span>
                </div>
              </div>

              <Separator />

              <div className="flex flex-col gap-2">
                <span className="text-xs font-semibold uppercase text-muted-foreground tracking-wider mb-1">
                  Breakdown by Model
                </span>
                {loading ? (
                  <div className="text-sm text-muted-foreground py-2">Loading usage...</div>
                ) : usage.length === 0 ? (
                  <div className="text-sm text-muted-foreground py-2 border rounded-lg border-dashed text-center">
                    No usage data recorded yet.
                  </div>
                ) : (
                  <div className="flex flex-col gap-2">
                    {usage.map((u, i) => (
                      <div key={i} className="flex flex-col border p-2.5 rounded-lg bg-zinc-50/30 dark:bg-zinc-900/30 text-xs">
                        <div className="flex justify-between items-center mb-1">
                          <span className="font-bold text-sm truncate pr-2" title={u.model}>{u.model}</span>
                          <span className="font-semibold uppercase text-[10px] text-muted-foreground bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 rounded">{u.provider}</span>
                        </div>
                        <div className="flex justify-between text-muted-foreground">
                          <span>Reqs: {u.total_requests.toLocaleString()}</span>
                          <span>In: {u.prompt_tokens.toLocaleString()} | Out: {u.completion_tokens.toLocaleString()}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

            </CardContent>
          </Card>
        </div>
      </div>

      {/* Bottom: Independent Enrichment */}
      <Card className="stagger-elem shadow-sm border-border/50 bg-card/60 backdrop-blur-xl mt-2">
        <CardHeader>
          <CardTitle className="text-md flex items-center gap-2">
            <Sparkles className="size-4 text-primary" /> Independent Job Enrichment
          </CardTitle>
          <CardDescription>
            Select a previously completed scraping job to run AI enrichment independently.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 md:flex-row md:items-end">
          <div className="flex-1 flex flex-col gap-1">
            <label className="text-xs font-semibold">Select Job</label>
            <Select value={selectedJob} onValueChange={(val) => setSelectedJob(val || "")}>
              <SelectTrigger className="h-9">
                <SelectValue placeholder="Select a job..." />
              </SelectTrigger>
              <SelectContent>
                {jobs.map((job) => (
                  <SelectItem key={job.id} value={job.id}>
                    {job.query || "Unknown"} ({job.success_count} records) - {new Date(job.created_at).toLocaleDateString()}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          
          <div className="flex-1 flex flex-col gap-1">
            <label className="text-xs font-semibold">Provider</label>
            <Select
              value={enrichmentProvider}
              onValueChange={(val) => {
                const p = val || "";
                setEnrichmentProvider(p);
                if (p === "local") {
                  setEnrichmentModel("local");
                } else if (p === "mix") {
                  setEnrichmentModel("mix");
                } else if (enrichmentModel === "local" || enrichmentModel === "mix") {
                  setEnrichmentModel("google/gemini-2.5-flash");
                }
              }}
            >
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="local">Local Python Enricher (Offline)</SelectItem>
                <SelectItem value="mix">Hybrid / Mixed (Local + AI)</SelectItem>
                <SelectItem value="openrouter">OpenRouter</SelectItem>
                <SelectItem value="groq">Groq</SelectItem>
                <SelectItem value="openai">OpenAI</SelectItem>
                <SelectItem value="claude">Claude (Anthropic)</SelectItem>
                <SelectItem value="gemini">Gemini (Google AI)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex-[2] flex flex-col gap-1">
            <label className="text-xs font-semibold">Model Name</label>
            <Input 
              placeholder={enrichmentProvider === "local" ? "local" : enrichmentProvider === "mix" ? "mix" : "e.g. google/gemini-2.5-flash"} 
              value={enrichmentModel}
              onChange={(e) => {
                if (enrichmentProvider !== "local" && enrichmentProvider !== "mix") {
                  setEnrichmentModel(e.target.value);
                }
              }}
              disabled={enrichmentProvider === "local" || enrichmentProvider === "mix"}
              className="h-9"
            />
          </div>

          <div className="flex flex-col gap-1">
            <Button className="h-9" onClick={handleStartEnrichment} disabled={isEnriching || !selectedJob}>
              {isEnriching ? "Starting..." : "Start Enrichment"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
