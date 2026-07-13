"use client"

import React, { useEffect, useState } from "react";
import { PageHeader } from "@/components/page-header";
import { MetricCard } from "@/components/metric-card";
import { StatusBadge } from "@/components/status-badge";
import { EmptyState } from "@/components/empty-state";
import { ErrorBanner } from "@/components/error-banner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Database,
  TrendingUp,
  Calendar,
  Star,
  Mail,
  Radar,
  ArrowRight,
  RefreshCw,
  Clock,
  Compass,
} from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";

// Colors for Pie/Donut Chart
const COLORS = ["#3b82f6", "#22c55e", "#f59e0b", "#a855f7", "#ec4899", "#10b981", "#f43f5e", "#8b5cf6", "#71717a"];

interface Stats {
  totalRecords: number;
  addedToday: number;
  addedThisWeek: number;
  avgRating: number;
  totalEmails: number;
  activeJobs: number;
}

interface GrowthPoint {
  date: string;
  records: number;
  added: number;
}

interface GeoPoint {
  country: string;
  count: number;
}

interface CategoryPoint {
  category: string;
  count: number;
}

interface ScrapeJob {
  id: number;
  query: string;
  status: "running" | "completed" | "stopped" | "failed";
  record_count: number;
  started_at: string;
}

export default function DashboardPage() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [stats, setStats] = useState<Stats | null>(null);
  const [growth, setGrowth] = useState<GrowthPoint[]>([]);
  const [geo, setGeo] = useState<GeoPoint[]>([]);
  const [categories, setCategories] = useState<CategoryPoint[]>([]);
  const [jobs, setJobs] = useState<ScrapeJob[]>([]);

  const fetchDashboardData = async (isSilent = false) => {
    if (!isSilent) setLoading(true);
    else setRefreshing(true);
    setError(null);

    try {
      const [statsRes, growthRes, geoRes, catRes, jobsRes] = await Promise.all([
        fetch("/api/v2/stats/overview"),
        fetch("/api/v2/stats/growth"),
        fetch("/api/v2/stats/geo-distribution"),
        fetch("/api/v2/stats/category-distribution"),
        fetch("/api/v2/jobs?limit=5"),
      ]);

      const [statsData, growthData, geoData, catData, jobsData] = await Promise.all([
        statsRes.json(),
        growthRes.json(),
        geoRes.json(),
        catRes.json(),
        jobsRes.json(),
      ]);

      if (statsData.success) setStats(statsData.stats);
      if (growthData.success) setGrowth(growthData.growth);
      if (geoData.success) setGeo(geoData.distribution);
      if (catData.success) setCategories(catData.distribution);
      if (jobsData.success) setJobs(jobsData.jobs);
    } catch (e: any) {
      setError("Failed to fetch dashboard data. Please make sure the backend is running.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchDashboardData();
  }, []);

  if (loading) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Dashboard" description="Overview of your scraped Google Maps leads and statistics." />
        
        {/* Metric Skeletons */}
        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i} className="shadow-sm">
              <CardHeader className="pb-2">
                <Skeleton className="h-4 w-24" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-8 w-16 mb-2" />
                <Skeleton className="h-3 w-32" />
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Charts Skeletons */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mt-4">
          <Card className="lg:col-span-2 shadow-sm">
            <CardHeader><Skeleton className="h-6 w-48" /></CardHeader>
            <CardContent><Skeleton className="h-[300px] w-full" /></CardContent>
          </Card>
          <Card className="shadow-sm">
            <CardHeader><Skeleton className="h-6 w-48" /></CardHeader>
            <CardContent><Skeleton className="h-[300px] w-full" /></CardContent>
          </Card>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Dashboard" description="Overview of your scraped Google Maps leads and statistics.">
          <Button onClick={() => fetchDashboardData()} variant="outline" size="sm">
            <RefreshCw className="size-4 mr-2" /> Retry
          </Button>
        </PageHeader>
        <ErrorBanner message={error} />
      </div>
    );
  }

  // Zero State
  if (!stats || stats.totalRecords === 0) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Dashboard" description="Overview of your scraped Google Maps leads and statistics." />
        <EmptyState
          icon={Compass}
          title="No Scraping Data Found"
          description="It looks like you don't have any scraped records in the database. Run the scraper to collect your first leads!"
          action={{
            label: "Go to Scraper Panel",
            onClick: () => {
              window.location.href = "/scraper";
            },
          }}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <PageHeader
        title="Dashboard"
        description="Overview of your scraped Google Maps leads and statistics."
      >
        <Button
          onClick={() => fetchDashboardData(true)}
          variant="outline"
          size="sm"
          disabled={refreshing}
          className="cursor-pointer"
        >
          <RefreshCw className={className("size-4 mr-2", refreshing && "animate-spin")} />
          {refreshing ? "Refreshing..." : "Refresh"}
        </Button>
      </PageHeader>

      {/* Metric Cards Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        <MetricCard
          title="Total Leads"
          value={stats.totalRecords.toLocaleString()}
          description="stored in database"
          icon={Database}
        />
        <MetricCard
          title="Scraped Today"
          value={stats.addedToday}
          description="leads added today"
          icon={TrendingUp}
          trend={{ value: stats.totalRecords > 0 ? Math.round((stats.addedToday / stats.totalRecords) * 100) : 0, isPositive: true }}
        />
        <MetricCard
          title="Scraped This Week"
          value={stats.addedThisWeek}
          description="last 7 days"
          icon={Calendar}
        />
        <MetricCard
          title="Avg Rating"
          value={`${stats.avgRating} ★`}
          description="across rated listings"
          icon={Star}
        />
        <MetricCard
          title="Emails Found"
          value={stats.totalEmails.toLocaleString()}
          description={`${Math.round((stats.totalEmails / stats.totalRecords) * 100)}% contact rate`}
          icon={Mail}
        />
        <MetricCard
          title="Active Scrapes"
          value={stats.activeJobs > 0 ? "Active" : "Idle"}
          description={stats.activeJobs > 0 ? "Running scrape job" : "No active jobs"}
          icon={Radar}
          className={stats.activeJobs > 0 ? "border-blue-500/30" : ""}
        />
      </div>

      {/* Main Charts Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Growth Line/Area Chart */}
        <Card className="lg:col-span-2 shadow-sm">
          <CardHeader>
            <CardTitle className="text-base font-semibold">Data Growth</CardTitle>
            <CardDescription>Cumulative scraped records over the last 30 days</CardDescription>
          </CardHeader>
          <CardContent className="h-[300px] pl-2">
            {growth.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={growth}>
                  <defs>
                    <linearGradient id="colorRecords" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.2} />
                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="date" tickLine={false} axisLine={false} style={{ fontSize: "11px", fill: "var(--color-muted-foreground)" }} />
                  <YAxis tickLine={false} axisLine={false} style={{ fontSize: "11px", fill: "var(--color-muted-foreground)" }} width={40} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "var(--color-card)",
                      borderColor: "var(--color-border)",
                      borderRadius: "8px",
                      color: "var(--color-foreground)",
                      fontSize: "12px",
                    }}
                  />
                  <Area type="monotone" dataKey="records" stroke="#3b82f6" strokeWidth={2} fillOpacity={1} fill="url(#colorRecords)" name="Total Leads" />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                No growth data available
              </div>
            )}
          </CardContent>
        </Card>

        {/* Category Donut Chart */}
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle className="text-base font-semibold">Categories</CardTitle>
            <CardDescription>Top industries by lead count</CardDescription>
          </CardHeader>
          <CardContent className="h-[300px] flex flex-col justify-between">
            {categories.length > 0 ? (
              <>
                <div className="h-[180px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={categories}
                        cx="50%"
                        cy="50%"
                        innerRadius={60}
                        outerRadius={80}
                        paddingAngle={2}
                        dataKey="count"
                        nameKey="category"
                      >
                        {categories.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={{
                          backgroundColor: "var(--color-card)",
                          borderColor: "var(--color-border)",
                          borderRadius: "8px",
                          fontSize: "12px",
                        }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                {/* Legend list */}
                <div className="grid grid-cols-2 gap-1 text-[11px] max-h-[100px] overflow-y-auto px-2">
                  {categories.map((c, index) => (
                    <div key={c.category} className="flex items-center gap-1.5 truncate">
                      <span className="size-2 rounded-full shrink-0" style={{ backgroundColor: COLORS[index % COLORS.length] }} />
                      <span className="truncate text-muted-foreground" title={c.category}>{c.category}</span>
                      <span className="font-semibold">{c.count}</span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                No category data available
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Bottom Layout Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-2">
        {/* Geo Distribution horizontal bar */}
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle className="text-base font-semibold">Geographic Distribution</CardTitle>
            <CardDescription>Top countries by lead volume</CardDescription>
          </CardHeader>
          <CardContent className="h-[280px]">
            {geo.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={geo} layout="vertical" margin={{ left: 20, right: 20 }}>
                  <XAxis type="number" tickLine={false} axisLine={false} style={{ fontSize: "11px", fill: "var(--color-muted-foreground)" }} />
                  <YAxis dataKey="country" type="category" tickLine={false} axisLine={false} style={{ fontSize: "11px", fill: "var(--color-muted-foreground)" }} width={80} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "var(--color-card)",
                      borderColor: "var(--color-border)",
                      borderRadius: "8px",
                      fontSize: "12px",
                    }}
                  />
                  <Bar dataKey="count" fill="#3b82f6" radius={[0, 4, 4, 0]} name="Leads" />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                No geographical data available
              </div>
            )}
          </CardContent>
        </Card>

        {/* Scrape Jobs timeline */}
        <Card className="shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle className="text-base font-semibold">Recent Operations</CardTitle>
              <CardDescription>Recent scraper executions and statuses</CardDescription>
            </div>
            <Link href="/scraper" className="text-xs text-primary font-semibold hover:underline flex items-center gap-1">
              Scraper Panel <ArrowRight className="size-3" />
            </Link>
          </CardHeader>
          <CardContent>
            {jobs.length > 0 ? (
              <div className="flex flex-col gap-4">
                {jobs.map((job) => (
                  <div key={job.id} className="flex items-center justify-between border-b pb-3 last:border-b-0 last:pb-0">
                    <div className="flex flex-col gap-0.5 min-w-0">
                      <span className="text-sm font-semibold text-foreground truncate max-w-xs md:max-w-sm" title={job.query}>
                        {job.query}
                      </span>
                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                        <Clock className="size-3" />
                        {new Date(job.started_at).toLocaleDateString()} at {new Date(job.started_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      {job.status === "completed" && (
                        <span className="text-xs font-semibold text-muted-foreground">
                          {job.record_count} leads
                        </span>
                      )}
                      <StatusBadge status={job.status} />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
                No scraper jobs executed yet
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// Utility function for conditional className formatting inside client component
function className(...classes: any[]) {
  return classes.filter(Boolean).join(" ");
}
