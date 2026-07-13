"use client";

import React, { useEffect, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Globe, Timer, Server, CalendarClock, Trash2 } from "lucide-react";
import { toast } from "sonner";

interface Proxy {
  id: number;
  url: string;
  is_active: boolean;
  fail_count: number;
  last_used_at: string | null;
}

interface Schedule {
  id: number;
  query: string;
  run_at: string;
  interval_minutes: number;
  is_active: number;
  run_count: number;
  last_run_at: string | null;
}

export function AutomationSettings() {
  const [uaRotation, setUaRotation] = useState(true);
  const [rateLimit, setRateLimit] = useState<number>(0);
  const [proxies, setProxies] = useState<Proxy[]>([]);
  const [newProxy, setNewProxy] = useState("");

  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [schedQuery, setSchedQuery] = useState("");
  const [schedRunAt, setSchedRunAt] = useState("");
  const [schedInterval, setSchedInterval] = useState<number>(0);

  const loadNetPolicy = async () => {
    try {
      const res = await fetch("/api/v2/netpolicy");
      if (res.ok) {
        const data = await res.json();
        setUaRotation(!!data.ua_rotation_enabled);
        setRateLimit(Number(data.rate_limit_seconds) || 0);
        setProxies(Array.isArray(data.proxies) ? data.proxies : []);
      }
    } catch {
      // ignore
    }
  };

  const loadSchedules = async () => {
    try {
      const res = await fetch("/api/v2/schedules");
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) setSchedules(data);
      }
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    loadNetPolicy();
    loadSchedules();
  }, []);

  const saveNetConfig = async (patch: Record<string, unknown>) => {
    try {
      const res = await fetch("/api/v2/netpolicy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (res.ok) toast.success("Network policy updated");
      else toast.error("Failed to update network policy");
    } catch {
      toast.error("Failed to update network policy");
    }
  };

  const addProxy = async () => {
    const url = newProxy.trim();
    if (!url) return;
    try {
      const res = await fetch("/api/v2/netpolicy/proxies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      if (res.ok) {
        setNewProxy("");
        toast.success("Proxy added");
        loadNetPolicy();
      } else {
        toast.error("Failed to add proxy");
      }
    } catch {
      toast.error("Failed to add proxy");
    }
  };

  const deleteProxy = async (id: number) => {
    try {
      await fetch(`/api/v2/netpolicy/proxies/${id}`, { method: "DELETE" });
      loadNetPolicy();
    } catch {
      // ignore
    }
  };

  const createSchedule = async () => {
    if (!schedQuery.trim() || !schedRunAt.trim()) {
      toast.error("Query and run time are required");
      return;
    }
    // datetime-local -> "YYYY-MM-DD HH:MM:SS"
    const runAt = schedRunAt.replace("T", " ") + ":00";
    try {
      const res = await fetch("/api/v2/schedules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: schedQuery.trim(),
          run_at: runAt,
          interval_minutes: Number(schedInterval) || 0,
        }),
      });
      if (res.ok) {
        setSchedQuery("");
        setSchedRunAt("");
        setSchedInterval(0);
        toast.success("Schedule created");
        loadSchedules();
      } else {
        toast.error("Failed to create schedule");
      }
    } catch {
      toast.error("Failed to create schedule");
    }
  };

  const deleteSchedule = async (id: number) => {
    try {
      await fetch(`/api/v2/schedules/${id}`, { method: "DELETE" });
      loadSchedules();
    } catch {
      // ignore
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Anti-blocking: UA rotation + rate limit + proxies */}
      <Card className="shadow-sm border-border/50">
        <CardHeader>
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Globe className="size-4" /> Anti-Blocking
          </CardTitle>
          <CardDescription>
            User-agent rotation, request rate limiting, and proxy rotation.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div className="flex flex-col">
              <span className="text-sm font-medium">User-agent rotation</span>
              <span className="text-xs text-muted-foreground">
                Vary the browser + request fingerprint per job.
              </span>
            </div>
            <Switch
              checked={uaRotation}
              onCheckedChange={(v) => {
                setUaRotation(v);
                saveNetConfig({ ua_rotation_enabled: v });
              }}
            />
          </div>

          <div className="flex items-center justify-between gap-4">
            <div className="flex flex-col">
              <span className="text-sm font-medium flex items-center gap-1.5">
                <Timer className="size-3.5" /> Rate limit (sec/domain)
              </span>
              <span className="text-xs text-muted-foreground">
                Minimum delay between requests to the same site. 0 = off.
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min={0}
                step={0.5}
                value={rateLimit}
                onChange={(e) => setRateLimit(Number(e.target.value))}
                className="w-20"
              />
              <Button
                size="sm"
                variant="outline"
                onClick={() => saveNetConfig({ rate_limit_seconds: rateLimit })}
              >
                Save
              </Button>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium flex items-center gap-1.5">
              <Server className="size-3.5" /> Proxies
            </span>
            <div className="flex gap-2">
              <Input
                placeholder="http://user:pass@host:port"
                value={newProxy}
                onChange={(e) => setNewProxy(e.target.value)}
              />
              <Button size="sm" onClick={addProxy}>
                Add
              </Button>
            </div>
            {proxies.length === 0 ? (
              <span className="text-xs text-muted-foreground">
                No proxies — requests go direct.
              </span>
            ) : (
              <ul className="flex flex-col gap-1">
                {proxies.map((p) => (
                  <li
                    key={p.id}
                    className="flex items-center justify-between text-xs bg-muted/40 rounded px-2 py-1"
                  >
                    <span className="font-mono truncate">{p.url}</span>
                    <span className="flex items-center gap-2 shrink-0">
                      {p.fail_count > 0 && (
                        <span className="text-amber-500">
                          {p.fail_count} fail{p.fail_count > 1 ? "s" : ""}
                        </span>
                      )}
                      <button
                        onClick={() => deleteProxy(p.id)}
                        className="text-muted-foreground hover:text-red-500"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Scheduling */}
      <Card className="shadow-sm border-border/50">
        <CardHeader>
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <CalendarClock className="size-4" /> Scheduled Scrapes
          </CardTitle>
          <CardDescription>
            Run a scrape at a future time, optionally repeating.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Input
              placeholder="Search query (e.g. Cafes in Lahore)"
              value={schedQuery}
              onChange={(e) => setSchedQuery(e.target.value)}
            />
            <div className="flex gap-2">
              <Input
                type="datetime-local"
                value={schedRunAt}
                onChange={(e) => setSchedRunAt(e.target.value)}
                className="flex-1"
              />
              <Input
                type="number"
                min={0}
                placeholder="Repeat min"
                title="Repeat every N minutes (0 = one-time)"
                value={schedInterval}
                onChange={(e) => setSchedInterval(Number(e.target.value))}
                className="w-28"
              />
            </div>
            <Button size="sm" onClick={createSchedule}>
              Schedule
            </Button>
            <span className="text-[11px] text-muted-foreground">
              Time is interpreted in UTC. Set repeat to 0 for a one-time run.
            </span>
          </div>

          {schedules.length === 0 ? (
            <span className="text-xs text-muted-foreground">
              No schedules configured.
            </span>
          ) : (
            <ul className="flex flex-col gap-1">
              {schedules.map((s) => (
                <li
                  key={s.id}
                  className="flex items-center justify-between text-xs bg-muted/40 rounded px-2 py-1.5"
                >
                  <span className="flex flex-col">
                    <span className="font-medium truncate">{s.query}</span>
                    <span className="text-muted-foreground">
                      {s.run_at} UTC ·{" "}
                      {s.interval_minutes > 0
                        ? `every ${s.interval_minutes}m`
                        : "one-time"}
                      {s.is_active ? "" : " · done"}
                      {s.run_count > 0 ? ` · ran ${s.run_count}×` : ""}
                    </span>
                  </span>
                  <button
                    onClick={() => deleteSchedule(s.id)}
                    className="text-muted-foreground hover:text-red-500 shrink-0"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
