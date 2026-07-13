"use client"

import React, { useState, useEffect } from "react";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Download,
  FileSpreadsheet,
  FileCode,
  FileText,
  History,
  Settings,
  Calendar,
  AlertCircle,
  Play,
  CheckCircle,
  Database,
} from "lucide-react";
import { toast } from "sonner";
import * as XLSX from "xlsx";

interface ExportItem {
  id: number;
  filename: string;
  format: string;
  record_count: number;
  filter_applied: string; // JSON string
  created_at: string;
  file_size_bytes: number;
}

interface FilterOptions {
  countries: string[];
  cities: string[];
  regions: string[];
  categories: string[];
  queries: string[];
}

export default function ExportsPage() {
  const [history, setHistory] = useState<ExportItem[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [exporting, setExporting] = useState(false);

  // Form states
  const [filenamePrefix, setFilenamePrefix] = useState("leads_export");
  const [format, setFormat] = useState<"xlsx" | "csv" | "json">("xlsx");
  const [countryFilter, setCountryFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [hasPhone, setHasPhone] = useState(false);
  const [hasEmail, setHasEmail] = useState(false);
  const [hasWebsite, setHasWebsite] = useState(false);
  const [minRating, setMinRating] = useState("all");

  const [filterOptions, setFilterOptions] = useState<FilterOptions>({
    countries: [],
    cities: [],
    regions: [],
    categories: [],
    queries: [],
  });

  // Fetch unique filters & history on load
  const fetchMetadata = async () => {
    try {
      const [optRes, histRes] = await Promise.all([
        fetch("/api/v2/filters/options"),
        fetch("/api/v2/exports"),
      ]);

      if (optRes.ok) {
        const data = await optRes.json();
        if (data.success) setFilterOptions(data.options);
      }
      if (histRes.ok) {
        const data = await histRes.json();
        if (data.success) setHistory(data.exports);
      }
    } catch (e) {
      toast.error("Failed to load export configurations.");
    } finally {
      setLoadingHistory(false);
    }
  };

  useEffect(() => {
    fetchMetadata();
  }, []);

  const handleExport = async (e: React.FormEvent) => {
    e.preventDefault();
    setExporting(true);

    // Build query parameters
    const queryParams = new URLSearchParams();
    queryParams.set("page", "1");
    queryParams.set("limit", "100000"); // large limit to get all matching records

    const activeFilters: Record<string, string> = {};
    if (countryFilter !== "all") activeFilters.country = countryFilter;
    if (categoryFilter !== "all") activeFilters.category = categoryFilter;
    if (favoritesOnly) activeFilters.is_favorite = "true";
    if (hasPhone) activeFilters.has_phone = "true";
    if (hasEmail) activeFilters.has_email = "true";
    if (hasWebsite) activeFilters.has_website = "true";
    if (minRating !== "all") activeFilters.min_rating = minRating;

    Object.entries(activeFilters).forEach(([key, val]) => {
      queryParams.set(`filter[${key}]`, val);
    });

    try {
      toast.loading("Querying matching database records...", { id: "export-process" });
      const res = await fetch(`/api/v2/records?${queryParams.toString()}`);
      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.error || "Failed to retrieve records from database.");
      }

      const records = data.records;
      if (records.length === 0) {
        toast.dismiss("export-process");
        toast.warning("No records matched the selected export filters.");
        setExporting(false);
        return;
      }

      toast.loading(`Structuring ${records.length} records into ${format.toUpperCase()}...`, { id: "export-process" });

      const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      const fullFilename = `${filenamePrefix}_${timestamp}.${format}`;

      let blob: Blob;
      
      // Clean records for spreadsheet output
      const formattedRecords = records.map((r: any) => ({
        ID: r.id,
        Name: r.name || "",
        Category: r.category || "",
        Phone: r.phone || "",
        Email: r.email || "",
        Website: r.website || "",
        Rating: r.rating ? parseFloat(r.rating) : "",
        Reviews: r.total_reviews ? parseInt(r.total_reviews.replace(/[()]/g, "")) : 0,
        Address: r.address || "",
        City: r.city || "",
        Country: r.country || "",
        Region: r.region || "",
        Source: r.source_query || "",
        "Scraped At": new Date(r.scraped_at).toLocaleDateString(),
        Notes: r.notes || "",
        Starred: r.is_favorite === 1 ? "Yes" : "No",
      }));

      if (format === "xlsx") {
        // Excel generation
        const ws = XLSX.utils.json_to_sheet(formattedRecords);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Leads");
        const excelBuffer = XLSX.write(wb, { bookType: "xlsx", type: "array" });
        blob = new Blob([excelBuffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      } else if (format === "json") {
        // JSON generation
        const jsonContent = JSON.stringify(records, null, 2);
        blob = new Blob([jsonContent], { type: "application/json" });
      } else {
        // CSV generation
        const headers = Object.keys(formattedRecords[0]);
        const csvRows = [
          headers.join(","),
          ...formattedRecords.map((row: any) =>
            headers
              .map((fieldName) => {
                const val = row[fieldName];
                const cleanVal = val === null || val === undefined ? "" : val.toString();
                // Escape quotes and wrap in quotes if contains commas/quotes
                if (cleanVal.includes(",") || cleanVal.includes('"') || cleanVal.includes("\n")) {
                  return `"${cleanVal.replace(/"/g, '""')}"`;
                }
                return cleanVal;
              })
              .join(",")
          ),
        ];
        blob = new Blob([csvRows.join("\n")], { type: "text/csv;charset=utf-8;" });
      }

      // Download file in browser
      const downloadUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = downloadUrl;
      link.download = fullFilename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(downloadUrl);

      // Log export history in SQLite
      await fetch("/api/v2/exports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: fullFilename,
          format,
          recordCount: records.length,
          filterApplied: activeFilters,
          fileSizeBytes: blob.size,
        }),
      });

      toast.success(`Export completed successfully! Downloaded ${fullFilename}`, { id: "export-process" });
      fetchMetadata(); // Refresh history
    } catch (err: any) {
      toast.error(err.message || "Failed to execute export.", { id: "export-process" });
    } finally {
      setExporting(false);
    }
  };

  const handleReDownload = async (item: ExportItem) => {
    let filters: Record<string, string> = {};
    try {
      filters = JSON.parse(item.filter_applied || "{}");
    } catch (e) {}

    const queryParams = new URLSearchParams();
    queryParams.set("page", "1");
    queryParams.set("limit", "100000");

    Object.entries(filters).forEach(([key, val]) => {
      queryParams.set(`filter[${key}]`, val);
    });

    try {
      toast.loading(`Re-generating export archive: ${item.filename}...`, { id: "redownload" });
      const res = await fetch(`/api/v2/records?${queryParams.toString()}`);
      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.error || "Failed to query database.");
      }

      const records = data.records;
      if (records.length === 0) {
        toast.dismiss("redownload");
        toast.warning("No records found matching saved filters.");
        return;
      }

      // Format records
      const formattedRecords = records.map((r: any) => ({
        ID: r.id,
        Name: r.name || "",
        Category: r.category || "",
        Phone: r.phone || "",
        Email: r.email || "",
        Website: r.website || "",
        Rating: r.rating ? parseFloat(r.rating) : "",
        Reviews: r.total_reviews ? parseInt(r.total_reviews.replace(/[()]/g, "")) : 0,
        Address: r.address || "",
        City: r.city || "",
        Country: r.country || "",
        Region: r.region || "",
        Source: r.source_query || "",
        "Scraped At": new Date(r.scraped_at).toLocaleDateString(),
        Notes: r.notes || "",
        Starred: r.is_favorite === 1 ? "Yes" : "No",
      }));

      let blob: Blob;
      if (item.format === "xlsx") {
        const ws = XLSX.utils.json_to_sheet(formattedRecords);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Leads");
        const excelBuffer = XLSX.write(wb, { bookType: "xlsx", type: "array" });
        blob = new Blob([excelBuffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      } else if (item.format === "json") {
        blob = new Blob([JSON.stringify(records, null, 2)], { type: "application/json" });
      } else {
        const headers = Object.keys(formattedRecords[0]);
        const csvRows = [
          headers.join(","),
          ...formattedRecords.map((row: any) =>
            headers
              .map((fieldName) => {
                const val = row[fieldName];
                const cleanVal = val === null || val === undefined ? "" : val.toString();
                if (cleanVal.includes(",") || cleanVal.includes('"') || cleanVal.includes("\n")) {
                  return `"${cleanVal.replace(/"/g, '""')}"`;
                }
                return cleanVal;
              })
              .join(",")
          ),
        ];
        blob = new Blob([csvRows.join("\n")], { type: "text/csv;charset=utf-8;" });
      }

      const downloadUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = downloadUrl;
      link.download = item.filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(downloadUrl);

      toast.success("Download started successfully.", { id: "redownload" });
    } catch (e) {
      toast.error("Failed to re-generate export file.", { id: "redownload" });
    }
  };

  const getFormatIcon = (format: string) => {
    switch (format.toLowerCase()) {
      case "xlsx":
        return <FileSpreadsheet className="size-5 text-emerald-500" />;
      case "json":
        return <FileCode className="size-5 text-amber-500" />;
      default:
        return <FileText className="size-5 text-blue-500" />;
    }
  };

  const getFileSizeString = (bytes: number) => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Export Wizard"
        description="Download your leads database in structured Excel, CSV, or JSON formats."
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Export Form */}
        <Card className="lg:col-span-2 shadow-sm border-zinc-200 dark:border-zinc-800">
          <CardHeader>
            <CardTitle className="text-md flex items-center gap-2">
              <Settings className="size-4 text-primary" /> Export Configuration
            </CardTitle>
            <CardDescription>
              Select filters and output properties to format your data file.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleExport} className="flex flex-col gap-5">
              {/* File Options */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="filename" className="text-xs font-semibold text-zinc-500">Filename Prefix</label>
                  <Input
                    id="filename"
                    value={filenamePrefix}
                    onChange={(e) => setFilenamePrefix(e.target.value)}
                    placeholder="leads_export"
                    className="h-9"
                    required
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="format" className="text-xs font-semibold text-zinc-500">Download Format</label>
                  <Select value={format} onValueChange={(val: any) => setFormat(val)}>
                    <SelectTrigger className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="xlsx">Excel Spreadsheet (.xlsx)</SelectItem>
                      <SelectItem value="csv">Comma Separated Values (.csv)</SelectItem>
                      <SelectItem value="json">Raw JSON File (.json)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <Separator className="my-1" />

              {/* Geographic Filtering */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-zinc-500">Country Scope</label>
                  <Select value={countryFilter} onValueChange={(val) => setCountryFilter(val || "all")}>
                    <SelectTrigger className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Countries</SelectItem>
                      {filterOptions.countries.map(c => (
                        <SelectItem key={c} value={c}>{c}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-zinc-500">Industry / Category Scope</label>
                  <Select value={categoryFilter} onValueChange={(val) => setCategoryFilter(val || "all")}>
                    <SelectTrigger className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Categories</SelectItem>
                      {filterOptions.categories.slice(0, 50).map(c => (
                        <SelectItem key={c} value={c}>{c}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Additional parameters */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-zinc-500">Minimum Lead Rating</label>
                  <Select value={minRating} onValueChange={(val) => setMinRating(val || "all")}>
                    <SelectTrigger className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Any Rating</SelectItem>
                      <SelectItem value="4.5">4.5+ Stars</SelectItem>
                      <SelectItem value="4.0">4.0+ Stars</SelectItem>
                      <SelectItem value="3.5">3.5+ Stars</SelectItem>
                      <SelectItem value="3.0">3.0+ Stars</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <Separator className="my-1" />

              {/* Integrity checks */}
              <div className="flex flex-col gap-3">
                <label className="text-xs font-semibold text-zinc-500">Data Integrity Filters</label>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="favorites"
                      checked={favoritesOnly}
                      onCheckedChange={(checked) => setFavoritesOnly(!!checked)}
                    />
                    <label htmlFor="favorites" className="text-xs font-medium cursor-pointer">
                      Export starred/favorite leads only
                    </label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="has-phone"
                      checked={hasPhone}
                      onCheckedChange={(checked) => setHasPhone(!!checked)}
                    />
                    <label htmlFor="has-phone" className="text-xs font-medium cursor-pointer">
                      Only include leads with a phone number
                    </label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="has-email"
                      checked={hasEmail}
                      onCheckedChange={(checked) => setHasEmail(!!checked)}
                    />
                    <label htmlFor="has-email" className="text-xs font-medium cursor-pointer">
                      Only include leads with email addresses
                    </label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="has-web"
                      checked={hasWebsite}
                      onCheckedChange={(checked) => setHasWebsite(!!checked)}
                    />
                    <label htmlFor="has-web" className="text-xs font-medium cursor-pointer">
                      Only include leads with active websites
                    </label>
                  </div>
                </div>
              </div>

              <Button
                type="submit"
                disabled={exporting}
                className="w-full mt-2 cursor-pointer"
              >
                {exporting ? "Compiling spreadsheet..." : (
                  <>
                    <Download className="size-4 mr-2" /> Download Export File
                  </>
                )}
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Right: Export History */}
        <Card className="shadow-sm border-zinc-200 dark:border-zinc-800 flex flex-col h-full max-h-[600px]">
          <CardHeader className="shrink-0">
            <CardTitle className="text-md flex items-center gap-2">
              <History className="size-4 text-primary" /> Past Downloads
            </CardTitle>
            <CardDescription>
              Previously compiled data extractions.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex-1 overflow-y-auto pr-2 flex flex-col gap-4">
            {loadingHistory ? (
              Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-16 w-full bg-muted animate-pulse rounded-lg" />
              ))
            ) : history.length > 0 ? (
              history.map((item) => {
                let filtersDesc = "";
                try {
                  const f = JSON.parse(item.filter_applied || "{}");
                  const activeKeys = Object.keys(f);
                  if (activeKeys.length === 0) {
                    filtersDesc = "All Records";
                  } else {
                    filtersDesc = activeKeys
                      .map((k) => `${k}: ${f[k]}`)
                      .join(", ");
                  }
                } catch (e) {
                  filtersDesc = "Custom Filters";
                }

                return (
                  <div
                    key={item.id}
                    className="p-3 border rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors flex items-start justify-between gap-3 text-xs"
                  >
                    <div className="flex gap-2.5 items-start overflow-hidden">
                      <div className="p-1.5 border rounded-md shrink-0 bg-background">
                        {getFormatIcon(item.format)}
                      </div>
                      <div className="flex flex-col gap-1 overflow-hidden">
                        <span className="font-semibold text-foreground truncate" title={item.filename}>
                          {item.filename}
                        </span>
                        <div className="text-[10px] text-muted-foreground flex items-center gap-1.5 flex-wrap">
                          <span className="flex items-center gap-1"><Database className="size-2.5" /> {item.record_count} leads</span>
                          <span>•</span>
                          <span>{getFileSizeString(item.file_size_bytes)}</span>
                          <span>•</span>
                          <span className="flex items-center gap-1"><Calendar className="size-2.5" /> {new Date(item.created_at).toLocaleDateString()}</span>
                        </div>
                        <span className="text-[9px] text-zinc-400 truncate max-w-[200px]" title={filtersDesc}>
                          Filters: {filtersDesc}
                        </span>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7 cursor-pointer"
                      onClick={() => handleReDownload(item)}
                      title="Download again"
                    >
                      <Download className="size-3.5" />
                    </Button>
                  </div>
                );
              })
            ) : (
              <div className="text-center text-muted-foreground text-xs py-12 italic">
                No past exports recorded. Configure and trigger your first download on the left.
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
