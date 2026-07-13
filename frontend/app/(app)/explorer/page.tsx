"use client"

import React, { useState, useEffect, useRef } from "react";
import { PageHeader } from "@/components/page-header";
import { ErrorBanner } from "@/components/error-banner";
import { Input } from "@/components/ui/input";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Search,
  Filter,
  Eye,
  Star,
  Download,
  Trash2,
  Tag,
  X,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Copy,
  Bookmark,
  ChevronDown,
  ChevronUp,
  Mail,
  Phone,
  Globe,
  MapPin,
  Calendar,
  Save,
  Sparkles,
  Layers,
} from "lucide-react";
import { toast } from "sonner";

interface Record {
  id: number;
  category: string | null;
  name: string;
  phone: string | null;
  google_maps_url: string | null;
  website: string | null;
  email: string | null;
  business_status: string | null;
  address: string | null;
  total_reviews: string | null;
  booking_links: string | null;
  rating: string | null;
  hours: string | null;
  latitude: number | null;
  longitude: number | null;
  country: string | null;
  city: string | null;
  region: string | null;
  source_query: string | null;
  scraped_at: string;
  updated_at: string;
  tags: string; // JSON string
  is_favorite: number;
  notes: string;
  description: string | null;
  social_links: string | null;
  owner_name: string | null;
  ceo_name: string | null;
  executives: string | null;
  ai_enriched: number;
}

interface FilterOptions {
  countries: string[];
  cities: string[];
  regions: string[];
  categories: string[];
  queries: string[];
}

import gsap from "gsap";
import { useGSAP } from "@gsap/react";

export default function ExplorerPage() {
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

  // Loading & Error states
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Duplicates Finder & Manual Enrichment states
  const [duplicatesOpen, setDuplicatesOpen] = useState(false);
  const [duplicateClusters, setDuplicateClusters] = useState<Record[][]>([]);
  const [loadingDuplicates, setLoadingDuplicates] = useState(false);
  const [enriching, setEnriching] = useState(false);
  const [manualEnrichProvider, setManualEnrichProvider] = useState("local");
  const [manualEnrichModel, setManualEnrichModel] = useState("local");

  // Data & Pagination states
  const [records, setRecords] = useState<Record[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);
  const [totalPages, setTotalPages] = useState(1);

  // Search & Sort states
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [sortBy, setSortBy] = useState("id");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");

  // Selection states
  const [selectedIds, setSelectedIds] = useState<number[]>([]);

  // Columns visibility state
  const [visibleColumns, setVisibleColumns] = useState<{ [key: string]: boolean }>({
    name: true,
    category: true,
    country: true,
    city: true,
    phone: true,
    email: true,
    rating: true,
    total_reviews: true,
    website: true,
    is_favorite: true,
    ai_enriched: true,
  });

  const columnsList = [
    { id: "name", label: "Name" },
    { id: "category", label: "Category" },
    { id: "ai_enriched", label: "AI Enriched" },
    { id: "country", label: "Country" },
    { id: "city", label: "City" },
    { id: "region", label: "Region" },
    { id: "phone", label: "Phone" },
    { id: "email", label: "Email" },
    { id: "rating", label: "Rating" },
    { id: "total_reviews", label: "Reviews" },
    { id: "website", label: "Website" },
    { id: "description", label: "Description" },
    { id: "owner_name", label: "Owner" },
    { id: "ceo_name", label: "CEO" },
    { id: "executives", label: "Executives" },
    { id: "business_status", label: "Status" },
    { id: "address", label: "Address" },
    { id: "source_query", label: "Query Source" },
    { id: "scraped_at", label: "Scraped At" },
  ];

  // Active filter state
  const [activeFilters, setActiveFilters] = useState<{
    country?: string;
    city?: string;
    region?: string;
    category?: string;
    source_query?: string;
    is_favorite?: string;
    has_email?: string;
    has_website?: string;
    has_phone?: string;
    min_rating?: string;
  }>({});

  const [filterOptions, setFilterOptions] = useState<FilterOptions>({
    countries: [],
    cities: [],
    regions: [],
    categories: [],
    queries: [],
  });

  // Saved filters state
  const [savedFilters, setSavedFilters] = useState<{ id: number; name: string; filter_json: string }[]>([]);
  const [newFilterName, setNewFilterName] = useState("");

  // Detail panel state
  const [selectedRecord, setSelectedRecord] = useState<Record | null>(null);
  const [notesInput, setNotesInput] = useState("");
  const [tagInput, setTagInput] = useState("");

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1); // Reset page on search
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  // Fetch unique filter values & saved filters on load
  const fetchMetadata = async () => {
    try {
      const [optRes, savedRes] = await Promise.all([
        fetch("/api/v2/filters/options"),
        fetch("/api/v2/filters/saved"),
      ]);

      if (optRes.ok) {
        const data = await optRes.json();
        if (data.success) setFilterOptions(data.options);
      }
      if (savedRes.ok) {
        const data = await savedRes.json();
        if (data.success) setSavedFilters(data.filters);
      }
    } catch (e) {
      // ignore
    }
  };

  // Main data fetch function
  const fetchRecords = async () => {
    setLoading(true);
    setError(null);

    const queryParams = new URLSearchParams();
    queryParams.set("page", page.toString());
    queryParams.set("limit", limit.toString());
    if (debouncedSearch) queryParams.set("search", debouncedSearch);
    if (sortBy) queryParams.set("sort", `${sortBy}:${sortOrder}`);

    // Apply active filters
    Object.entries(activeFilters).forEach(([key, val]) => {
      if (val) {
        queryParams.set(`filter[${key}]`, val);
      }
    });

    try {
      const res = await fetch(`/api/v2/records?${queryParams.toString()}`);
      const data = await res.json();

      if (res.ok && data.success) {
        setRecords(data.records);
        setTotal(data.total);
        setTotalPages(data.totalPages);
      } else {
        setError(data.error || "Failed to fetch records.");
      }
    } catch (e) {
      setError("Connection to database failed.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRecords();
  }, [page, limit, debouncedSearch, sortBy, sortOrder, activeFilters]);

  useEffect(() => {
    fetchMetadata();
  }, []);

  const fetchDuplicates = async () => {
    setLoadingDuplicates(true);
    try {
      const res = await fetch("/api/v2/records/duplicates");
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          setDuplicateClusters(data.duplicates);
        }
      }
    } catch (e) {
      toast.error("Failed to fetch potential duplicates.");
    } finally {
      setLoadingDuplicates(false);
    }
  };

  const handleMerge = async (targetId: number, sourceIds: number[]) => {
    try {
      const res = await fetch("/api/v2/records/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetId, sourceIds }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          toast.success("Leads merged smartly successfully!");
          // Remove from local list
          setDuplicateClusters(prev => prev.filter(cluster => !cluster.some(r => r.id === targetId || sourceIds.includes(r.id))));
          // Refresh main view
          fetchRecords();
        } else {
          toast.error(data.error || "Failed to merge leads.");
        }
      }
    } catch (e) {
      toast.error("Network error during merge.");
    }
  };

  const handleManualEnrich = async () => {
    if (!selectedRecord) return;
    setEnriching(true);
    const toastId = toast.loading(`Crawling & enriching "${selectedRecord.name}"... This takes a few seconds.`);
    try {
      const res = await fetch(`/api/v2/records/${selectedRecord.id}/enrich`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: manualEnrichProvider,
          model: manualEnrichModel,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.record) {
          toast.success(`"${selectedRecord.name}" enriched successfully!`, { id: toastId });
          setSelectedRecord(data.record);
          fetchRecords();
        } else {
          toast.error(data.error || "Enrichment failed.", { id: toastId });
        }
      } else {
        const errData = await res.json();
        toast.error(errData.detail || "Enrichment failed.", { id: toastId });
      }
    } catch (e) {
      toast.error("Network error during manual enrichment.", { id: toastId });
    } finally {
      setEnriching(false);
    }
  };

  // Sort toggle handler
  const handleSort = (field: string) => {
    if (sortBy === field) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    } else {
      setSortBy(field);
      setSortOrder("desc");
    }
    setPage(1);
  };

  // Toggle favorite optimistic updates
  const handleToggleFavorite = async (record: Record, e: React.MouseEvent) => {
    e.stopPropagation();
    const newFav = record.is_favorite === 1 ? 0 : 1;
    
    // Optimistic UI update
    setRecords(records.map(r => r.id === record.id ? { ...r, is_favorite: newFav } : r));
    if (selectedRecord && selectedRecord.id === record.id) {
      setSelectedRecord({ ...selectedRecord, is_favorite: newFav });
    }

    try {
      const res = await fetch(`/api/v2/records/${record.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_favorite: newFav }),
      });
      if (!res.ok) {
        // Rollback
        setRecords(records.map(r => r.id === record.id ? { ...r, is_favorite: record.is_favorite } : r));
        if (selectedRecord && selectedRecord.id === record.id) {
          setSelectedRecord({ ...selectedRecord, is_favorite: record.is_favorite });
        }
        toast.error("Failed to update favorite status.");
      }
    } catch (err) {
      // Rollback on network/fetch error
      setRecords(records.map(r => r.id === record.id ? { ...r, is_favorite: record.is_favorite } : r));
      if (selectedRecord && selectedRecord.id === record.id) {
        setSelectedRecord({ ...selectedRecord, is_favorite: record.is_favorite });
      }
      toast.error("Network error updating status.");
    }
  };

  // Selection handlers
  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedIds(records.map((r) => r.id));
    } else {
      setSelectedIds([]);
    }
  };

  const handleSelectRow = (id: number, checked: boolean) => {
    if (checked) {
      setSelectedIds([...selectedIds, id]);
    } else {
      setSelectedIds(selectedIds.filter((x) => x !== id));
    }
  };

  // Clear filters
  const handleRemoveFilter = (key: string) => {
    const updated = { ...activeFilters };
    delete updated[key as keyof typeof activeFilters];
    setActiveFilters(updated);
    setPage(1);
  };

  // Save current filter setup
  const handleSaveFilter = async () => {
    if (!newFilterName.trim()) {
      toast.error("Please enter a name for the filter.");
      return;
    }

    try {
      const res = await fetch("/api/v2/filters/saved", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newFilterName.trim(),
          filterJson: activeFilters,
        }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        toast.success("Filter saved successfully!");
        setNewFilterName("");
        fetchMetadata();
      } else {
        toast.error(data.error || "Failed to save filter.");
      }
    } catch (e) {
      toast.error("Network error saving filter.");
    }
  };

  // Load saved filter setup
  const handleLoadFilter = (filterJsonStr: string) => {
    try {
      const filters = JSON.parse(filterJsonStr);
      setActiveFilters(filters);
      setPage(1);
      toast.success("Filter loaded successfully.");
    } catch (e) {
      toast.error("Failed to load filter.");
    }
  };

  // Delete saved filter
  const handleDeleteSavedFilter = async (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const res = await fetch(`/api/v2/filters/saved/${id}`, { method: "DELETE" });
      if (res.ok) {
        toast.success("Saved filter deleted.");
        fetchMetadata();
      }
    } catch (e) {
      toast.error("Failed to delete saved filter.");
    }
  };

  // Bulk delete selected
  const handleBulkDelete = async () => {
    if (selectedIds.length === 0) return;
    if (!confirm(`Are you sure you want to delete ${selectedIds.length} selected records?`)) return;

    try {
      const res = await fetch("/api/v2/records/bulk-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: selectedIds }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        toast.success(`Successfully deleted ${data.deletedCount} records.`);
        setSelectedIds([]);
        fetchRecords();
        fetchMetadata();
      } else {
        toast.error(data.error || "Failed to delete records.");
      }
    } catch (e) {
      toast.error("Network error deleting records.");
    }
  };

  // Save notes on panel blur
  const handleSaveNotes = async () => {
    if (!selectedRecord) return;
    if (selectedRecord.notes === notesInput) return;

    try {
      const res = await fetch(`/api/v2/records/${selectedRecord.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes: notesInput }),
      });
      if (res.ok) {
        setSelectedRecord({ ...selectedRecord, notes: notesInput });
        setRecords(records.map(r => r.id === selectedRecord.id ? { ...r, notes: notesInput } : r));
        toast.success("Notes saved.");
      }
    } catch (e) {
      toast.error("Failed to save notes.");
    }
  };

  // Tags handlers
  const handleAddTag = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedRecord || !tagInput.trim()) return;

    let tagsList: string[] = [];
    try {
      tagsList = JSON.parse(selectedRecord.tags || "[]");
    } catch (err) {}

    const newTag = tagInput.trim().toLowerCase();
    if (tagsList.includes(newTag)) {
      toast.error("Tag already exists.");
      return;
    }

    const updatedTags = [...tagsList, newTag];
    const tagsJson = JSON.stringify(updatedTags);

    try {
      const res = await fetch(`/api/v2/records/${selectedRecord.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tags: tagsJson }),
      });

      if (res.ok) {
        setSelectedRecord({ ...selectedRecord, tags: tagsJson });
        setRecords(records.map(r => r.id === selectedRecord.id ? { ...r, tags: tagsJson } : r));
        setTagInput("");
        toast.success("Tag added.");
      }
    } catch (e) {
      toast.error("Failed to add tag.");
    }
  };

  const handleRemoveTag = async (tagToRemove: string) => {
    if (!selectedRecord) return;

    let tagsList: string[] = [];
    try {
      tagsList = JSON.parse(selectedRecord.tags || "[]");
    } catch (err) {}

    const updatedTags = tagsList.filter(t => t !== tagToRemove);
    const tagsJson = JSON.stringify(updatedTags);

    try {
      const res = await fetch(`/api/v2/records/${selectedRecord.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tags: tagsJson }),
      });

      if (res.ok) {
        setSelectedRecord({ ...selectedRecord, tags: tagsJson });
        setRecords(records.map(r => r.id === selectedRecord.id ? { ...r, tags: tagsJson } : r));
        toast.success("Tag removed.");
      }
    } catch (e) {
      toast.error("Failed to remove tag.");
    }
  };

  // Export selected to CSV
  const handleExportSelected = () => {
    if (selectedIds.length === 0) return;
    const selectedRecords = records.filter(r => selectedIds.includes(r.id));
    
    // Simple CSV conversion
    const headers = ["Name", "Category", "Phone", "Email", "Rating", "Reviews", "Website", "Address", "Country", "City"];
    const rows = selectedRecords.map(r => [
      `"${(r.name || "").replace(/"/g, '""')}"`,
      `"${(r.category || "").replace(/"/g, '""')}"`,
      `"${r.phone || ""}"`,
      `"${r.email || ""}"`,
      r.rating || "",
      r.total_reviews || "",
      `"${r.website || ""}"`,
      `"${(r.address || "").replace(/"/g, '""')}"`,
      `"${r.country || ""}"`,
      `"${r.city || ""}"`,
    ]);

    const csvContent = [headers.join(","), ...rows.map(e => e.join(","))].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `selected_leads_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    // Log export history
    fetch("/api/v2/exports", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filename: `selected_leads_${Date.now()}.csv`,
        format: "csv",
        recordCount: selectedIds.length,
        filterApplied: { selection: "Selected Items" },
        fileSizeBytes: blob.size,
      }),
    });
  };

  return (
    <div ref={containerRef} className="flex flex-col gap-6">
      {/* Header */}
      <PageHeader
        title="Data Explorer"
        description="Browse, search, and filter all scraped business records."
      />

      {/* Action Toolbar */}
      <Card className="stagger-elem shadow-sm border-border/50 bg-card/60 backdrop-blur-xl">
        <CardContent className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
          {/* Left: Search input */}
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
            <Input
              placeholder="Search leads..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
              aria-label="Search leads"
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                className="absolute right-3 top-2.5 text-muted-foreground hover:text-foreground cursor-pointer"
                aria-label="Clear search"
                title="Clear search"
              >
                <X className="size-4" />
              </button>
            )}
          </div>

          {/* Right: Actions */}
          <div className="flex items-center gap-2 flex-wrap">
            {/* Filters panel trigger */}
            <Popover>
              <PopoverTrigger className={cn(buttonVariants({ variant: "outline", size: "sm" }), "cursor-pointer")}>
                <Filter className="size-4 mr-2" /> Filter
              </PopoverTrigger>
              <PopoverContent className="w-80 p-4 flex flex-col gap-4" align="end">
                <div className="font-semibold text-sm">Filters</div>
                <Separator />
                
                {/* Filter selects */}
                <div className="flex flex-col gap-3 max-h-[300px] overflow-y-auto pr-1">
                  {/* Country Filter */}
                  {filterOptions.countries.length > 0 && (
                    <div className="flex flex-col gap-1">
                      <span className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">Country</span>
                      <Select
                        value={activeFilters.country || "all"}
                        onValueChange={(val) => setActiveFilters({ ...activeFilters, country: val === "all" || !val ? undefined : val })}
                      >
                        <SelectTrigger className="h-8">
                          <SelectValue placeholder="Select Country" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All Countries</SelectItem>
                          {filterOptions.countries.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  )}

                  {/* Category Filter */}
                  {filterOptions.categories.length > 0 && (
                    <div className="flex flex-col gap-1">
                      <span className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">Category</span>
                      <Select
                        value={activeFilters.category || "all"}
                        onValueChange={(val) => setActiveFilters({ ...activeFilters, category: val === "all" || !val ? undefined : val })}
                      >
                        <SelectTrigger className="h-8">
                          <SelectValue placeholder="Select Category" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All Categories</SelectItem>
                          {filterOptions.categories.slice(0, 50).map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  )}

                  {/* Min Rating Filter */}
                  <div className="flex flex-col gap-1">
                    <span className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">Min Rating</span>
                    <Select
                      value={activeFilters.min_rating || "all"}
                      onValueChange={(val) => setActiveFilters({ ...activeFilters, min_rating: val === "all" || !val ? undefined : val })}
                    >
                      <SelectTrigger className="h-8">
                        <SelectValue placeholder="Select Rating" />
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

                  {/* Has Email checkbox filter */}
                  <div className="flex flex-col gap-1">
                    <span className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">Contact Status</span>
                    <Select
                      value={activeFilters.has_email || "all"}
                      onValueChange={(val) => setActiveFilters({ ...activeFilters, has_email: val === "all" || !val ? undefined : val })}
                    >
                      <SelectTrigger className="h-8">
                        <SelectValue placeholder="Select Email Filter" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Any Email Status</SelectItem>
                        <SelectItem value="true">Has Email Address</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  
                  {/* Favorites only */}
                  <div className="flex flex-col gap-1">
                    <span className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">Starred Status</span>
                    <Select
                      value={activeFilters.is_favorite || "all"}
                      onValueChange={(val) => setActiveFilters({ ...activeFilters, is_favorite: val === "all" || !val ? undefined : val })}
                    >
                      <SelectTrigger className="h-8">
                        <SelectValue placeholder="Select Starred Filter" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Any Starred Status</SelectItem>
                        <SelectItem value="true">Starred Only</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </PopoverContent>
            </Popover>

            {/* Saved Filters Popover */}
            <Popover>
              <PopoverTrigger className={cn(buttonVariants({ variant: "outline", size: "sm" }), "cursor-pointer")}>
                <Bookmark className="size-4 mr-2" /> Saved Filters
              </PopoverTrigger>
              <PopoverContent className="w-64 p-4 flex flex-col gap-3" align="end">
                <div className="font-semibold text-xs uppercase tracking-wider text-muted-foreground">Save Current Filters</div>
                <div className="flex gap-2">
                  <Input
                    placeholder="Filter name..."
                    value={newFilterName}
                    onChange={(e) => setNewFilterName(e.target.value)}
                    className="h-8 text-xs"
                    aria-label="New filter name"
                  />
                  <Button
                    onClick={handleSaveFilter}
                    size="sm"
                    className="h-8 px-2.5 shrink-0 cursor-pointer"
                    aria-label="Save current filter settings"
                    title="Save current filters"
                  >
                    <Save className="size-3.5" />
                  </Button>
                </div>
                {savedFilters.length > 0 && (
                  <>
                    <Separator className="my-1" />
                    <div className="font-semibold text-xs uppercase tracking-wider text-muted-foreground">Saved Filters</div>
                    <div className="flex flex-col gap-1.5 max-h-[150px] overflow-y-auto pr-1">
                      {savedFilters.map((f) => (
                        <div
                          key={f.id}
                          onClick={() => handleLoadFilter(f.filter_json)}
                          className="flex items-center justify-between text-xs p-1.5 border rounded hover:bg-zinc-50 dark:hover:bg-zinc-900 cursor-pointer"
                        >
                          <span className="font-medium truncate">{f.name}</span>
                          <button
                            onClick={(e) => handleDeleteSavedFilter(f.id, e)}
                            className="text-muted-foreground hover:text-destructive shrink-0 ml-2 cursor-pointer"
                            aria-label={`Delete saved filter ${f.name}`}
                            title="Delete saved filter"
                          >
                            <X className="size-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </PopoverContent>
            </Popover>

            {/* Duplicates Finder button */}
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                fetchDuplicates();
                setDuplicatesOpen(true);
              }}
              className="cursor-pointer"
            >
              <Layers className="size-4 mr-2" /> Find Duplicates
            </Button>

            {/* Column Visibility Checkbox Dropdown */}
            <DropdownMenu>
              <DropdownMenuTrigger className={cn(buttonVariants({ variant: "outline", size: "sm" }), "cursor-pointer")}>
                <Eye className="size-4 mr-2" /> Columns
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-56" align="end">
                <DropdownMenuLabel>Toggle Columns</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {columnsList.map((col) => (
                  <DropdownMenuCheckboxItem
                    key={col.id}
                    checked={visibleColumns[col.id]}
                    onCheckedChange={(checked) => setVisibleColumns({ ...visibleColumns, [col.id]: checked })}
                  >
                    {col.label}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Bulk actions menu */}
            {selectedIds.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger className={cn(buttonVariants({ variant: "outline", size: "sm" }), "bg-primary/5 text-primary border-primary/20 hover:bg-primary/10 cursor-pointer")}>
                  Actions ({selectedIds.length}) <ChevronDown className="size-4 ml-1" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={handleExportSelected}>
                    <Download className="size-4 mr-2" /> Export Selected
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => {
                    window.location.href = `/lead-enrichment?ids=${selectedIds.join(",")}`;
                  }}>
                    <Sparkles className="size-4 mr-2" /> Enrich Selected
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={handleBulkDelete} className="text-destructive">
                    <Trash2 className="size-4 mr-2" /> Delete Selected
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Filter Chips list */}
      {Object.keys(activeFilters).length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-muted-foreground">Active filters:</span>
          {Object.entries(activeFilters).map(([key, val]) => {
            if (!val) return null;
            let displayVal = val;
            if (key === "is_favorite") displayVal = "Starred Only";
            if (key === "has_email") displayVal = "Has Email";
            if (key === "min_rating") displayVal = `${val}+ Stars`;

            return (
              <Badge key={key} variant="secondary" className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full">
                <span className="capitalize text-zinc-500 font-semibold">{key.replace("_", " ")}:</span>
                <span>{displayVal}</span>
                <button
                  onClick={() => handleRemoveFilter(key)}
                  className="hover:bg-zinc-200 dark:hover:bg-zinc-800 rounded-full p-0.5 cursor-pointer"
                  aria-label={`Remove filter ${key.replace("_", " ")}`}
                  title={`Remove ${key.replace("_", " ")} filter`}
                >
                  <X className="size-3" />
                </button>
              </Badge>
            );
          })}
          <Button
            onClick={() => setActiveFilters({})}
            variant="ghost"
            size="sm"
            className="h-6 text-xs text-muted-foreground hover:text-foreground cursor-pointer px-2"
          >
            Clear All
          </Button>
        </div>
      )}

      {/* Main Table Grid */}
      <Card className="stagger-elem shadow-sm border-border/50 bg-card/60 backdrop-blur-xl overflow-hidden">
        {loading ? (
          <div className="p-8 flex flex-col gap-4">
            <div className="h-10 w-full bg-muted animate-pulse rounded-lg" />
            <div className="flex-1 flex flex-col gap-2.5">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-12 w-full bg-muted/65 animate-pulse rounded-lg" />
              ))}
            </div>
          </div>
        ) : error ? (
          <div className="p-6">
            <ErrorBanner message={error} />
          </div>
        ) : records.length > 0 ? (
          <>
            {/* Desktop Table View */}
            <div className="hidden md:block overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12 text-center">
                      <Checkbox
                        checked={records.length > 0 && selectedIds.length === records.length}
                        onCheckedChange={handleSelectAll}
                      />
                    </TableHead>
                    {visibleColumns.is_favorite && (
                      <TableHead className="w-12 text-center">
                        <Star className="size-4 mx-auto text-muted-foreground" />
                      </TableHead>
                    )}
                    {visibleColumns.name && (
                      <TableHead onClick={() => handleSort("name")} className="cursor-pointer select-none hover:bg-zinc-50 dark:hover:bg-zinc-900">
                        Name {sortBy === "name" && (sortOrder === "asc" ? <ChevronUp className="inline size-3.5" /> : <ChevronDown className="inline size-3.5" />)}
                      </TableHead>
                    )}
                    {visibleColumns.category && (
                      <TableHead onClick={() => handleSort("category")} className="cursor-pointer select-none hover:bg-zinc-50 dark:hover:bg-zinc-900">
                        Category {sortBy === "category" && (sortOrder === "asc" ? <ChevronUp className="inline size-3.5" /> : <ChevronDown className="inline size-3.5" />)}
                      </TableHead>
                    )}
                    {visibleColumns.ai_enriched && <TableHead className="text-center">AI Enriched</TableHead>}
                    {visibleColumns.country && <TableHead>Country</TableHead>}
                    {visibleColumns.city && <TableHead>City</TableHead>}
                    {visibleColumns.region && <TableHead>Region</TableHead>}
                    {visibleColumns.phone && <TableHead>Phone</TableHead>}
                    {visibleColumns.email && <TableHead>Email</TableHead>}
                    {visibleColumns.rating && (
                      <TableHead onClick={() => handleSort("rating")} className="cursor-pointer select-none hover:bg-zinc-50 dark:hover:bg-zinc-900">
                        Rating {sortBy === "rating" && (sortOrder === "asc" ? <ChevronUp className="inline size-3.5" /> : <ChevronDown className="inline size-3.5" />)}
                      </TableHead>
                    )}
                    {visibleColumns.total_reviews && (
                      <TableHead onClick={() => handleSort("total_reviews")} className="cursor-pointer select-none hover:bg-zinc-50 dark:hover:bg-zinc-900">
                        Reviews {sortBy === "total_reviews" && (sortOrder === "asc" ? <ChevronUp className="inline size-3.5" /> : <ChevronDown className="inline size-3.5" />)}
                      </TableHead>
                    )}
                    {visibleColumns.website && <TableHead>Website</TableHead>}
                    {visibleColumns.description && <TableHead>Description</TableHead>}
                    {visibleColumns.owner_name && <TableHead>Owner</TableHead>}
                    {visibleColumns.ceo_name && <TableHead>CEO</TableHead>}
                    {visibleColumns.executives && <TableHead>Executives</TableHead>}
                    {visibleColumns.business_status && <TableHead>Status</TableHead>}
                    {visibleColumns.address && <TableHead>Address</TableHead>}
                    {visibleColumns.source_query && <TableHead>Source Query</TableHead>}
                    {visibleColumns.scraped_at && <TableHead>Scraped At</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {records.map((record) => {
                    const isSelected = selectedIds.includes(record.id);

                    return (
                      <TableRow
                        key={record.id}
                        onClick={() => {
                          setSelectedRecord(record);
                          setNotesInput(record.notes || "");
                        }}
                        className="cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors"
                      >
                        <TableCell className="text-center" onClick={(e) => e.stopPropagation()}>
                          <Checkbox
                            checked={isSelected}
                            onCheckedChange={(checked) => handleSelectRow(record.id, !!checked)}
                          />
                        </TableCell>
                        {visibleColumns.is_favorite && (
                          <TableCell className="text-center" onClick={(e) => e.stopPropagation()}>
                            <button
                              onClick={(e) => handleToggleFavorite(record, e)}
                              className="cursor-pointer focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none rounded-sm p-1 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                              aria-label={record.is_favorite === 1 ? "Remove from favorites" : "Add to favorites"}
                              title={record.is_favorite === 1 ? "Remove from favorites" : "Add to favorites"}
                            >
                              <Star
                                className={className(
                                  "size-4 mx-auto transition-colors",
                                  record.is_favorite === 1
                                    ? "text-yellow-500 fill-yellow-500"
                                    : "text-zinc-300 dark:text-zinc-700 hover:text-yellow-500"
                                )}
                              />
                            </button>
                          </TableCell>
                        )}
                        {visibleColumns.name && (
                          <TableCell className="font-semibold text-foreground max-w-xs truncate">
                            {record.name}
                          </TableCell>
                        )}
                        {visibleColumns.category && (
                          <TableCell className="text-xs">
                            {record.category ? <Badge variant="outline">{record.category}</Badge> : "-"}
                          </TableCell>
                        )}
                        {visibleColumns.ai_enriched && (
                          <TableCell className="text-center">
                            {record.ai_enriched === 1 ? (
                              <Badge variant="outline" className="bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 border-blue-200 dark:border-blue-800">AI</Badge>
                            ) : "-"}
                          </TableCell>
                        )}
                        {visibleColumns.country && <TableCell className="text-xs">{record.country || "-"}</TableCell>}
                        {visibleColumns.city && <TableCell className="text-xs">{record.city || "-"}</TableCell>}
                        {visibleColumns.region && <TableCell className="text-xs">{record.region || "-"}</TableCell>}
                        {visibleColumns.phone && (
                          <TableCell className="text-xs whitespace-nowrap">
                            {record.phone ? (
                              <a
                                href={`tel:${record.phone}`}
                                className="text-primary hover:underline"
                                onClick={(e) => e.stopPropagation()}
                              >
                                {record.phone}
                              </a>
                            ) : (
                              "-"
                            )}
                          </TableCell>
                        )}
                        {visibleColumns.email && (
                          <TableCell className="text-xs max-w-[150px] truncate" title={record.email || undefined}>
                            {record.email ? (
                              <a
                                href={`mailto:${record.email}`}
                                className="text-primary hover:underline"
                                onClick={(e) => e.stopPropagation()}
                              >
                                {record.email}
                              </a>
                            ) : (
                              "-"
                            )}
                          </TableCell>
                        )}
                        {visibleColumns.rating && (
                          <TableCell className="text-xs">
                            {record.rating ? (
                              <div className="flex items-center gap-1 font-semibold text-foreground">
                                {record.rating} <span className="text-yellow-500">★</span>
                              </div>
                            ) : (
                              "-"
                            )}
                          </TableCell>
                        )}
                        {visibleColumns.total_reviews && (
                          <TableCell className="text-xs">
                            {record.total_reviews ? record.total_reviews.replace(/[()]/g, "") : "0"}
                          </TableCell>
                        )}
                        {visibleColumns.website && (
                          <TableCell className="text-xs" onClick={(e) => e.stopPropagation()}>
                            {record.website ? (
                              <a
                                href={record.website}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-primary hover:underline flex items-center gap-1 max-w-[120px] truncate"
                              >
                                Link <ExternalLink className="size-3 shrink-0" />
                              </a>
                            ) : (
                              "-"
                            )}
                          </TableCell>
                        )}
                        {visibleColumns.description && (
                          <TableCell className="text-xs max-w-[200px] truncate" title={record.description || undefined}>
                            {record.description || "-"}
                          </TableCell>
                        )}
                        {visibleColumns.owner_name && (
                          <TableCell className="text-xs max-w-[120px] truncate" title={record.owner_name || undefined}>
                            {record.owner_name || "-"}
                          </TableCell>
                        )}
                        {visibleColumns.ceo_name && (
                          <TableCell className="text-xs max-w-[120px] truncate" title={record.ceo_name || undefined}>
                            {record.ceo_name || "-"}
                          </TableCell>
                        )}
                        {visibleColumns.executives && (
                          <TableCell className="text-xs max-w-[150px] truncate" title={record.executives || undefined}>
                            {record.executives || "-"}
                          </TableCell>
                        )}
                        {visibleColumns.business_status && (
                          <TableCell className="text-xs">
                            {record.business_status ? (
                              <span className={className(
                                record.business_status.toLowerCase().includes("open")
                                  ? "text-green-500 font-semibold"
                                  : "text-zinc-500"
                              )}>
                                {record.business_status.split("⋅")[0]}
                              </span>
                            ) : (
                              "-"
                            )}
                          </TableCell>
                        )}
                        {visibleColumns.address && (
                          <TableCell className="text-xs max-w-xs truncate" title={record.address || undefined}>
                            {record.address || "-"}
                          </TableCell>
                        )}
                        {visibleColumns.source_query && (
                          <TableCell className="text-xs max-w-[120px] truncate" title={record.source_query || undefined}>
                            {record.source_query || "-"}
                          </TableCell>
                        )}
                        {visibleColumns.scraped_at && (
                          <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                            {new Date(record.scraped_at).toLocaleDateString()}
                          </TableCell>
                        )}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            {/* Mobile Card View */}
            <div className="block md:hidden divide-y divide-zinc-200 dark:divide-zinc-800">
              {records.map((record) => {
                const isSelected = selectedIds.includes(record.id);

                return (
                  <div
                    key={record.id}
                    onClick={() => {
                      setSelectedRecord(record);
                      setNotesInput(record.notes || "");
                    }}
                    className="p-4 flex flex-col gap-2 hover:bg-zinc-50 dark:hover:bg-zinc-900 cursor-pointer transition-colors"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2 overflow-hidden">
                        <div onClick={(e) => e.stopPropagation()}>
                          <Checkbox
                            checked={isSelected}
                            onCheckedChange={(checked) => handleSelectRow(record.id, !!checked)}
                          />
                        </div>
                        <span className="font-semibold text-foreground truncate">{record.name}</span>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={(e) => handleToggleFavorite(record, e)}
                          className="cursor-pointer focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none rounded-sm p-1 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                          aria-label={record.is_favorite === 1 ? "Remove from favorites" : "Add to favorites"}
                          title={record.is_favorite === 1 ? "Remove from favorites" : "Add to favorites"}
                        >
                          <Star
                            className={className(
                              "size-4 transition-colors",
                              record.is_favorite === 1
                                ? "text-yellow-500 fill-yellow-500"
                                : "text-zinc-300 dark:text-zinc-700"
                            )}
                          />
                        </button>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 flex-wrap text-xs text-muted-foreground">
                      {record.category && <Badge variant="outline" className="text-[10px] px-1.5 py-0">{record.category}</Badge>}
                      {record.rating && <span className="text-amber-500 font-semibold">★ {record.rating}</span>}
                      {record.city && <span>• {record.city}</span>}
                    </div>

                    {record.address && (
                      <span className="text-[11px] text-muted-foreground truncate">{record.address}</span>
                    )}

                    <div className="flex items-center justify-between pt-1 border-t border-dashed mt-1 text-[11px]">
                      <div className="flex items-center gap-3" onClick={(e) => e.stopPropagation()}>
                        {record.phone && (
                          <a href={`tel:${record.phone}`} className="text-primary hover:underline flex items-center gap-1">
                            <Phone className="size-3" /> Call
                          </a>
                        )}
                        {record.email && (
                          <a href={`mailto:${record.email}`} className="text-primary hover:underline flex items-center gap-1">
                            <Mail className="size-3" /> Email
                          </a>
                        )}
                        {record.website && (
                          <a href={record.website} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline flex items-center gap-1">
                            <Globe className="size-3" /> Web
                          </a>
                        )}
                      </div>
                      <span className="text-[10px] text-zinc-400">
                        {new Date(record.scraped_at).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        ) : (
          <div className="text-center text-muted-foreground p-12 text-sm">
            No leads found matching the current search criteria or filters.
          </div>
        )}

        {/* Table Pagination footer */}
        {!loading && records.length > 0 && (
          <div className="p-4 flex flex-col sm:flex-row items-center justify-between border-t gap-4">
            {/* Left: Counts */}
            <div className="text-xs text-muted-foreground flex items-center gap-4">
              <span>Showing {records.length} of {total.toLocaleString()} leads</span>
              <div className="flex items-center gap-1.5">
                <span>Rows per page:</span>
                <Select value={limit.toString()} onValueChange={(val) => { setLimit(parseInt(val || "25")); setPage(1); }}>
                  <SelectTrigger className="h-7 w-[64px] text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="10">10</SelectItem>
                    <SelectItem value="25">25</SelectItem>
                    <SelectItem value="50">50</SelectItem>
                    <SelectItem value="100">100</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Right: Pagination buttons */}
            <div className="flex items-center gap-1.5">
              <Button
                variant="outline"
                size="icon"
                className="size-8 cursor-pointer"
                onClick={() => setPage(Math.max(1, page - 1))}
                disabled={page === 1}
                aria-label="Previous page"
                title="Previous page"
              >
                <ChevronLeft className="size-4" />
              </Button>
              <span className="text-xs font-semibold px-3 text-foreground">
                Page {page} of {totalPages}
              </span>
              <Button
                variant="outline"
                size="icon"
                className="size-8 cursor-pointer"
                onClick={() => setPage(Math.min(totalPages, page + 1))}
                disabled={page === totalPages}
                aria-label="Next page"
                title="Next page"
              >
                <ChevronRight className="size-4" />
              </Button>
            </div>
          </div>
        )}
      </Card>

      {/* Slide-over Detail Panel (Sheet) */}
      <Sheet open={selectedRecord !== null} onOpenChange={(open) => { if (!open) setSelectedRecord(null); }}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto flex flex-col gap-6 bg-background/80 backdrop-blur-xl border-l border-border/50" side="right">
          {selectedRecord && (
            <>
              <SheetHeader className="text-left border-b pb-4">
                <div className="flex items-center justify-between mt-4">
                  <div className="text-[10px] uppercase font-bold tracking-wider text-primary">
                    {selectedRecord.category || "Lead Detail"}
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={(e) => handleToggleFavorite(selectedRecord, e)}
                    className="size-8 cursor-pointer"
                    aria-label={selectedRecord.is_favorite === 1 ? "Remove from favorites" : "Add to favorites"}
                    title={selectedRecord.is_favorite === 1 ? "Remove from favorites" : "Add to favorites"}
                  >
                    <Star
                      className={className(
                        "size-5",
                        selectedRecord.is_favorite === 1 ? "text-yellow-500 fill-yellow-500" : "text-zinc-300 dark:text-zinc-700"
                      )}
                    />
                  </Button>
                </div>
                <SheetTitle className="text-xl font-bold tracking-tight text-foreground">
                  {selectedRecord.name}
                </SheetTitle>
                <SheetDescription className="text-xs text-muted-foreground flex items-center gap-1.5 mt-1">
                  <Calendar className="size-3.5" /> Scraped on {new Date(selectedRecord.scraped_at).toLocaleDateString()}
                </SheetDescription>
              </SheetHeader>

              {/* Lead Details Grid */}
              <div className="flex flex-col gap-4">
                <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">General Info</h4>
                <div className="grid grid-cols-1 gap-3 text-sm border rounded-lg p-3 bg-zinc-50/50 dark:bg-zinc-900/50">
                  {/* Website */}
                  <div className="flex items-center justify-between py-1 border-b last:border-b-0">
                    <span className="text-muted-foreground flex items-center gap-1.5 text-xs"><Globe className="size-3.5" /> Website</span>
                    {selectedRecord.website ? (
                      <a href={selectedRecord.website} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline truncate max-w-xs flex items-center gap-1">
                        {selectedRecord.website.replace(/^https?:\/\/(www\.)?/, "")} <ExternalLink className="size-3" />
                      </a>
                    ) : <span className="text-zinc-400 font-medium">-</span>}
                  </div>

                  {/* Email */}
                  <div className="flex items-center justify-between py-1 border-b last:border-b-0">
                    <span className="text-muted-foreground flex items-center gap-1.5 text-xs"><Mail className="size-3.5" /> Email</span>
                    {selectedRecord.email ? (
                      <a href={`mailto:${selectedRecord.email}`} className="text-primary hover:underline truncate max-w-xs">
                        {selectedRecord.email}
                      </a>
                    ) : <span className="text-zinc-400 font-medium">-</span>}
                  </div>

                  {/* Phone */}
                  <div className="flex items-center justify-between py-1 border-b last:border-b-0">
                    <span className="text-muted-foreground flex items-center gap-1.5 text-xs"><Phone className="size-3.5" /> Phone</span>
                    {selectedRecord.phone ? (
                      <a href={`tel:${selectedRecord.phone}`} className="text-primary hover:underline">
                        {selectedRecord.phone}
                      </a>
                    ) : <span className="text-zinc-400 font-medium">-</span>}
                  </div>

                  {/* Rating & Reviews */}
                  <div className="flex items-center justify-between py-1 border-b last:border-b-0">
                    <span className="text-muted-foreground flex items-center gap-1.5 text-xs"><Star className="size-3.5 text-yellow-500 fill-yellow-500" /> Rating</span>
                    <span className="font-semibold">
                      {selectedRecord.rating ? `${selectedRecord.rating} / 5.0 (${selectedRecord.total_reviews ? selectedRecord.total_reviews.replace(/[()]/g, "") : "0"} reviews)` : "Unrated"}
                    </span>
                  </div>

                  {/* Business Status */}
                  <div className="flex items-center justify-between py-1 border-b last:border-b-0">
                    <span className="text-muted-foreground flex items-center gap-1.5 text-xs">Status</span>
                    <span className="font-semibold capitalize">{selectedRecord.business_status || "Unknown"}</span>
                  </div>
                </div>
              </div>

              {/* AI Enrichment Data */}
              {selectedRecord.ai_enriched === 1 && (
                <div className="flex flex-col gap-4">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400 flex items-center gap-1.5">
                    <Star className="size-3.5 fill-blue-600 dark:fill-blue-400" /> AI Enriched Data
                  </h4>
                  <div className="grid grid-cols-1 gap-3 text-sm border border-blue-100 dark:border-blue-900 rounded-lg p-3 bg-blue-50/30 dark:bg-blue-950/20">
                    {selectedRecord.description && (
                      <div className="flex flex-col gap-1 pb-2 border-b border-blue-100 dark:border-blue-900/50">
                        <span className="text-muted-foreground text-xs font-semibold">Company Description</span>
                        <p className="text-xs text-foreground leading-relaxed">{selectedRecord.description}</p>
                      </div>
                    )}
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      {selectedRecord.owner_name && (
                        <div className="flex flex-col">
                          <span className="text-muted-foreground">Owner</span>
                          <span className="font-semibold">{selectedRecord.owner_name}</span>
                        </div>
                      )}
                      {selectedRecord.ceo_name && (
                        <div className="flex flex-col">
                          <span className="text-muted-foreground">CEO</span>
                          <span className="font-semibold">{selectedRecord.ceo_name}</span>
                        </div>
                      )}
                    </div>
                    {selectedRecord.executives && (
                      <div className="flex flex-col pt-2 border-t border-blue-100 dark:border-blue-900/50">
                        <span className="text-muted-foreground text-xs">Executives / Key People</span>
                        <span className="font-semibold text-xs">{selectedRecord.executives}</span>
                      </div>
                    )}
                    {selectedRecord.social_links && (
                      <div className="flex flex-col pt-2 border-t border-blue-100 dark:border-blue-900/50">
                        <span className="text-muted-foreground text-xs mb-1">Social Links</span>
                        <div className="flex flex-wrap gap-2">
                          {(() => {
                            let links = [];
                            try {
                              links = JSON.parse(selectedRecord.social_links);
                              // handle dicts if applicable, else strings
                              if (Array.isArray(links)) {
                                return links.map((link: string, i) => (
                                  <a key={i} href={link} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline flex items-center gap-1 max-w-[180px] truncate">
                                    <ExternalLink className="size-3 shrink-0" /> {new URL(link).hostname.replace('www.', '')}
                                  </a>
                                ));
                              } else if (typeof links === 'object') {
                                return Object.entries(links).map(([platform, url], i) => (
                                  <a key={i} href={url as string} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline flex items-center gap-1 max-w-[180px] truncate capitalize">
                                    <ExternalLink className="size-3 shrink-0" /> {platform}
                                  </a>
                                ));
                              }
                            } catch (e) {
                              return <span className="text-xs truncate">{selectedRecord.social_links}</span>;
                            }
                          })()}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Geographic Data */}
              <div className="flex flex-col gap-4">
                <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Geographic Location</h4>
                <div className="grid grid-cols-1 gap-3 text-sm border rounded-lg p-3 bg-zinc-50/50 dark:bg-zinc-900/50">
                  <div className="flex items-start gap-1.5">
                    <MapPin className="size-4 mt-0.5 text-muted-foreground shrink-0" />
                    <div className="flex flex-col gap-1">
                      <span className="text-xs font-medium text-muted-foreground">Address</span>
                      <span className="text-foreground text-xs">{selectedRecord.address || "No address extracted"}</span>
                    </div>
                  </div>
                  <Separator className="my-1" />
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div className="flex flex-col">
                      <span className="text-muted-foreground">Country</span>
                      <span className="font-semibold truncate">{selectedRecord.country || "-"}</span>
                    </div>
                    <div className="flex flex-col">
                      <span className="text-muted-foreground">City</span>
                      <span className="font-semibold truncate">{selectedRecord.city || "-"}</span>
                    </div>
                    <div className="flex flex-col">
                      <span className="text-muted-foreground">Region</span>
                      <span className="font-semibold truncate">{selectedRecord.region || "-"}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Tags Section */}
              <div className="flex flex-col gap-3">
                <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Lead Tags</h4>
                <div className="flex flex-wrap gap-1.5">
                  {(() => {
                    let tags: string[] = [];
                    try {
                      tags = JSON.parse(selectedRecord.tags || "[]");
                    } catch (e) {}

                    return tags.length > 0 ? (
                      tags.map(t => (
                        <Badge key={t} variant="secondary" className="flex items-center gap-1">
                          {t}
                          <button onClick={() => handleRemoveTag(t)} className="text-muted-foreground hover:text-foreground">
                            <X className="size-3" />
                          </button>
                        </Badge>
                      ))
                    ) : (
                      <span className="text-xs text-muted-foreground italic">No tags assigned yet.</span>
                    );
                  })()}
                </div>
                {/* Add Tag form */}
                <form onSubmit={handleAddTag} className="flex gap-2">
                  <Input
                    placeholder="Add tag (e.g. lead, prospect)..."
                    value={tagInput}
                    onChange={(e) => setTagInput(e.target.value)}
                    className="h-8 text-xs"
                  />
                  <Button type="submit" size="sm" className="h-8 px-3 cursor-pointer">
                    Add
                  </Button>
                </form>
              </div>

              {/* Notes Section */}
              <div className="flex flex-col gap-3">
                <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Internal Notes</h4>
                <textarea
                  value={notesInput}
                  onChange={(e) => setNotesInput(e.target.value)}
                  onBlur={handleSaveNotes}
                  rows={4}
                  placeholder="Type notes here... Auto-saves on blur."
                  className="w-full p-3 border rounded-lg bg-zinc-50/50 dark:bg-zinc-900/50 text-xs font-sans text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary"
                />
              </div>

              {/* Actions */}
              <div className="flex gap-2 border-t pt-4 mt-auto flex-wrap">
                {selectedRecord.website && (
                  <Popover>
                    <PopoverTrigger className={cn(buttonVariants({ variant: "outline" }), "flex-1 text-xs cursor-pointer")}>
                      <Sparkles className="size-3.5 mr-1.5" /> Enrich Lead
                    </PopoverTrigger>
                    <PopoverContent className="w-64 p-3 flex flex-col gap-3" align="end">
                      <div className="font-semibold text-xs uppercase tracking-wider text-muted-foreground">Manual Enrichment</div>
                      <div className="flex flex-col gap-2">
                        <div className="flex flex-col gap-1">
                          <label className="text-[10px] font-semibold text-muted-foreground uppercase">Provider</label>
                          <Select value={manualEnrichProvider} onValueChange={(val) => {
                            if (val) setManualEnrichProvider(val);
                            if (val === "local") setManualEnrichModel("local");
                            else if (val === "mix") setManualEnrichModel("mix");
                            else if (val === "openrouter") setManualEnrichModel("google/gemini-2.5-flash");
                            else if (val === "openai") setManualEnrichModel("gpt-4o-mini");
                            else if (val === "claude") setManualEnrichModel("claude-3-haiku-20240307");
                            else if (val === "groq") setManualEnrichModel("llama3-8b-8192");
                          }}>
                            <SelectTrigger className="h-8 text-xs">
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
                        {manualEnrichProvider !== "local" && (
                          <div className="flex flex-col gap-1">
                            <label className="text-[10px] font-semibold text-muted-foreground uppercase">Model</label>
                            <Input
                              placeholder="Model name..."
                              value={manualEnrichModel}
                              onChange={(e) => setManualEnrichModel(e.target.value)}
                              className="h-8 text-xs"
                            />
                          </div>
                        )}
                        <Button
                          size="sm"
                          className="w-full text-xs cursor-pointer mt-1"
                          disabled={enriching}
                          onClick={handleManualEnrich}
                        >
                          {enriching ? "Enriching..." : "Start Enrichment"}
                        </Button>
                      </div>
                    </PopoverContent>
                  </Popover>
                )}
                {selectedRecord.google_maps_url && (
                  <Button
                    variant="outline"
                    className="flex-1 text-xs"
                    onClick={() => window.open(selectedRecord.google_maps_url!, "_blank", "noopener,noreferrer")}
                  >
                    Open on Maps <ExternalLink className="size-3.5 ml-1.5" />
                  </Button>
                )}
                <Button
                  variant="destructive"
                  className="px-4 text-xs cursor-pointer"
                  onClick={async () => {
                    if (confirm("Are you sure you want to delete this lead?")) {
                      try {
                        const res = await fetch(`/api/v2/records/${selectedRecord.id}`, { method: "DELETE" });
                        if (res.ok) {
                          toast.success("Lead deleted successfully.");
                          setSelectedRecord(null);
                          fetchRecords();
                          fetchMetadata();
                        }
                      } catch (e) {
                        toast.error("Failed to delete lead.");
                      }
                    }
                  }}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      {/* Duplicates Finder Dialog */}
      <Dialog open={duplicatesOpen} onOpenChange={setDuplicatesOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col p-6 bg-card/95 border border-border/50 backdrop-blur-2xl rounded-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-lg font-semibold">
              <Layers className="size-5 text-primary" /> Potential Duplicates Finder
            </DialogTitle>
            <DialogDescription className="text-xs">
              We found the following groups of leads that share the same name, website domain, phone number, or email. Select which lead to keep as the master record; other leads in the group will be merged into it and then deleted.
            </DialogDescription>
          </DialogHeader>

          <Separator className="my-2" />

          <div className="flex-1 overflow-y-auto max-h-[60vh] pr-2 flex flex-col gap-4">
            {loadingDuplicates ? (
              <div className="py-12 text-center text-sm text-muted-foreground italic flex flex-col items-center gap-2">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
                Scanning database for duplicates...
              </div>
            ) : duplicateClusters.length === 0 ? (
              <div className="py-12 text-center text-sm text-muted-foreground border border-dashed rounded-lg">
                No potential duplicates found. Your leads database is clean!
              </div>
            ) : (
              duplicateClusters.map((cluster, clusterIdx) => (
                <ClusterCard
                  key={clusterIdx}
                  cluster={cluster}
                  onMerge={handleMerge}
                />
              ))
            )}
          </div>

          <DialogFooter className="mt-4 border-t pt-4">
            <Button variant="outline" size="sm" onClick={() => setDuplicatesOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ClusterCard({
  cluster,
  onMerge
}: {
  cluster: Record[];
  onMerge: (targetId: number, sourceIds: number[]) => void;
}) {
  const [masterId, setMasterId] = useState<number>(cluster[0].id);

  const otherIds = cluster.filter(r => r.id !== masterId).map(r => r.id);

  return (
    <div className="border border-border/80 rounded-xl p-4 bg-zinc-50/50 dark:bg-zinc-900/40 flex flex-col gap-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <span className="text-xs font-semibold text-muted-foreground">
          Group of {cluster.length} potential duplicates
        </span>
        <Button
          size="sm"
          onClick={() => onMerge(masterId, otherIds)}
          className="h-8 text-xs cursor-pointer bg-primary hover:bg-primary/90 text-primary-foreground font-medium rounded-lg"
        >
          Merge Smartly
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {cluster.map((lead) => {
          const isMaster = lead.id === masterId;
          return (
            <div
              key={lead.id}
              onClick={() => setMasterId(lead.id)}
              className={`p-3 rounded-lg border text-left cursor-pointer transition-all flex flex-col gap-2 relative ${isMaster ? "border-primary bg-primary/5 dark:bg-primary/10 shadow-sm" : "border-border hover:bg-zinc-100/50 dark:hover:bg-zinc-800/30"}`}
            >
              <div className="absolute top-2 right-2">
                <input
                  type="radio"
                  checked={isMaster}
                  onChange={() => setMasterId(lead.id)}
                  className="accent-primary size-3.5 cursor-pointer"
                  aria-label={`Select ${lead.name} as master`}
                />
              </div>

              <div className="flex flex-col gap-1 pr-6">
                <span className="font-semibold text-sm truncate">{lead.name}</span>
                {lead.category && (
                  <Badge variant="outline" className="w-fit text-[9px] uppercase tracking-wider scale-95 origin-left">
                    {lead.category}
                  </Badge>
                )}
              </div>

              <div className="grid grid-cols-1 gap-1 text-[11px] text-muted-foreground">
                <div className="truncate"><strong>Phone:</strong> {lead.phone || "-"}</div>
                <div className="truncate"><strong>Email:</strong> {lead.email || "-"}</div>
                <div className="truncate"><strong>Website:</strong> {lead.website || "-"}</div>
                <div className="line-clamp-2"><strong>Address:</strong> {lead.address || "-"}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Utility function for conditional className formatting inside client component
function className(...classes: any[]) {
  return classes.filter(Boolean).join(" ");
}
