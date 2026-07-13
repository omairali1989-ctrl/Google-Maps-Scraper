"use client"

import React, { useState, useEffect, useMemo } from "react";
import L from "leaflet";
import { MapContainer, TileLayer, Marker, Popup, useMap, useMapEvents } from "react-leaflet";
import { useTheme } from "next-themes";
import "leaflet/dist/leaflet.css";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import {
  Search,
  MapPin,
  Phone,
  Mail,
  Globe,
  Star,
  ExternalLink,
  ChevronRight,
  Navigation,
  Crosshair,
  Filter,
  Eye,
} from "lucide-react";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";

// Fix Leaflet Default Icon issue in Next.js

delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

// Create custom markers
const createCustomIcon = (color: string, isFavorite: boolean) => {
  const markerHtmlStyles = `
    background-color: ${color};
    width: 24px;
    height: 24px;
    display: block;
    left: -12px;
    top: -12px;
    position: relative;
    border-radius: 24px 24px 0;
    transform: rotate(45deg);
    border: 2px solid #ffffff;
    box-shadow: 0 2px 5px rgba(0,0,0,0.3);
    display: flex;
    align-items: center;
    justify-content: center;
  `;
  
  const innerHtmlStyles = `
    transform: rotate(-45deg);
    color: #ffffff;
    font-size: 10px;
    font-weight: bold;
  `;

  return L.divIcon({
    className: "custom-pin-marker",
    iconAnchor: [0, 24],
    popupAnchor: [0, -28],
    html: `<span style="${markerHtmlStyles}"><span style="${innerHtmlStyles}">${isFavorite ? "★" : "•"}</span></span>`
  });
};

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
  rating: string | null;
  latitude: number;
  longitude: number;
  country: string | null;
  city: string | null;
  region: string | null;
  is_favorite: number;
  notes?: string;
  tags?: string;
}

// Haversine distance formula in km
function getDistance(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371; // Radius of earth in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Component to handle map view bounds changes & sync visible markers
interface ViewportSyncProps {
  onBoundsChange: (bounds: L.LatLngBounds) => void;
  onCenterChange: (center: L.LatLng) => void;
  center?: [number, number];
  zoom?: number;
}

function MapEventsHandler({ onBoundsChange, onCenterChange, center, zoom }: ViewportSyncProps) {
  const map = useMap();

  useEffect(() => {
    if (center) {
      map.setView(center, zoom || map.getZoom(), { animate: true });
    }
  }, [center, zoom, map]);

  useMapEvents({
    moveend: () => {
      onBoundsChange(map.getBounds());
      onCenterChange(map.getCenter());
    },
    zoomend: () => {
      onBoundsChange(map.getBounds());
      onCenterChange(map.getCenter());
    },
  });

  // Initial bounds set
  useEffect(() => {
    onBoundsChange(map.getBounds());
    onCenterChange(map.getCenter());
  }, []);

  return null;
}

// Handle radius center selection by clicking map
interface MapClickSelectorProps {
  enableRadiusSearch: boolean;
  setRadiusCenter: React.Dispatch<React.SetStateAction<[number, number] | null>>;
}

function MapClickSelector({ enableRadiusSearch, setRadiusCenter }: MapClickSelectorProps) {
  useMapEvents({
    click: (e) => {
      if (enableRadiusSearch) {
        setRadiusCenter([e.latlng.lat, e.latlng.lng]);
        toast.success(`Radius center set to: ${e.latlng.lat.toFixed(4)}, ${e.latlng.lng.toFixed(4)}`);
      }
    }
  });
  return null;
}

export default function MapContainerComponent() {
  const { resolvedTheme } = useTheme();
  const [records, setRecords] = useState<Record[]>([]);
  const [loading, setLoading] = useState(true);

  // Search and Filter states
  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("all");
  
  // Radius search states
  const [enableRadiusSearch, setEnableRadiusSearch] = useState(false);
  const [radiusKm, setRadiusKm] = useState(10);
  const [radiusCenter, setRadiusCenter] = useState<[number, number] | null>(null);
  
  // Viewport filter state
  const [onlyVisibleInViewport, setOnlyVisibleInViewport] = useState(false);
  const [mapBounds, setMapBounds] = useState<L.LatLngBounds | null>(null);
  const [mapCenter, setMapCenter] = useState<L.LatLng | null>(null);

  // Map view navigation target
  const [mapTarget, setMapTarget] = useState<{ center: [number, number]; zoom: number } | undefined>(undefined);
  
  // Detailed panel record
  const [selectedRecord, setSelectedRecord] = useState<Record | null>(null);

  // Fetch geo records
  useEffect(() => {
    const fetchGeoRecords = async () => {
      try {
        const res = await fetch("/api/v2/records/geo");
        const data = await res.json();
        if (res.ok && data.success) {
          setRecords(data.records);
        } else {
          toast.error("Failed to load map records.");
        }
      } catch (err) {
        toast.error("Error connecting to database.");
      } finally {
        setLoading(false);
      }
    };
    fetchGeoRecords();
  }, []);

  // Set default center based on records
  const defaultCenter: [number, number] = useMemo(() => {
    if (records.length > 0) {
      // Find average lat/lng of records
      const sumLat = records.reduce((acc, r) => acc + r.latitude, 0);
      const sumLng = records.reduce((acc, r) => acc + r.longitude, 0);
      return [sumLat / records.length, sumLng / records.length];
    }
    return [25.2048, 55.2708]; // Dubai fallback
  }, [records]);

  // Set radius center initially when radius search is enabled or default center changes
  useEffect(() => {
    if (enableRadiusSearch && !radiusCenter) {
      if (mapCenter) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setRadiusCenter([mapCenter.lat, mapCenter.lng]);
      } else {
         
        setRadiusCenter(defaultCenter);
      }
    }
  }, [enableRadiusSearch, radiusCenter, defaultCenter, mapCenter]);

  // Extract unique categories for filter dropdown
  const categories = useMemo(() => {
    const cats = new Set<string>();
    records.forEach(r => {
      if (r.category) cats.add(r.category);
    });
    return ["all", ...Array.from(cats)].sort();
  }, [records]);



  // Filtered records list
  const filteredRecords = useMemo(() => {
    return records.filter((r) => {
      // 1. Search text query filter
      if (search) {
        const query = search.toLowerCase();
        const matchesName = r.name.toLowerCase().includes(query);
        const matchesCategory = (r.category || "").toLowerCase().includes(query);
        const matchesAddress = (r.address || "").toLowerCase().includes(query);
        if (!matchesName && !matchesCategory && !matchesAddress) return false;
      }

      // 2. Category filter
      if (selectedCategory !== "all" && r.category !== selectedCategory) {
        return false;
      }

      // 3. Radius filter
      if (enableRadiusSearch && radiusCenter) {
        const dist = getDistance(radiusCenter[0], radiusCenter[1], r.latitude, r.longitude);
        if (dist > radiusKm) return false;
      }

      // 4. Map boundaries viewport filter
      if (onlyVisibleInViewport && mapBounds) {
        const latLng = L.latLng(r.latitude, r.longitude);
        if (!mapBounds.contains(latLng)) return false;
      }

      return true;
    });
  }, [records, search, selectedCategory, enableRadiusSearch, radiusCenter, radiusKm, onlyVisibleInViewport, mapBounds]);

  // Tile layer source based on theme
  const tileLayerUrl = resolvedTheme === "dark"
    ? "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
    : "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png";

  const tileLayerAttribution = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>';

  const handleSelectRecord = (record: Record) => {
    setSelectedRecord(record);
  };

  const handleFlyTo = (record: Record) => {
    setMapTarget({
      center: [record.latitude, record.longitude],
      zoom: 16
    });
    // Open standard popup or panel detail
    setSelectedRecord(record);
  };

  const handleSetCenterToCurrent = () => {
    if (mapCenter) {
      setRadiusCenter([mapCenter.lat, mapCenter.lng]);
      toast.success("Radius center updated to current map view center.");
    }
  };

  return (
    <div className="flex flex-col md:flex-row h-[calc(100vh-12rem)] min-h-[550px] relative overflow-hidden bg-card text-card-foreground">
      {/* Sidebar List & Filters */}
      <div className="w-full md:w-[350px] border-r border-zinc-200 dark:border-zinc-800 flex flex-col h-1/2 md:h-full shrink-0 bg-zinc-50/20 dark:bg-zinc-900/10">
        {/* Search Panel */}
        <div className="p-4 flex flex-col gap-3 border-b border-zinc-200 dark:border-zinc-800 shrink-0">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
            <Input
              placeholder="Search leads..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 h-9 text-xs"
            />
          </div>

          <div className="flex gap-2">
            <div className="flex-1">
              <select
                value={selectedCategory}
                onChange={(e) => setSelectedCategory(e.target.value)}
                className="w-full h-8 px-2 text-xs border rounded-md bg-transparent focus:outline-none focus:ring-1 focus:ring-primary"
              >
                <option value="all">All Categories</option>
                {categories.filter(c => c !== "all").map(c => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>

            <Button
              variant={onlyVisibleInViewport ? "default" : "outline"}
              size="sm"
              className="h-8 px-2.5 shrink-0 cursor-pointer text-xs"
              onClick={() => setOnlyVisibleInViewport(!onlyVisibleInViewport)}
              title="Show only visible markers in current viewport"
            >
              <Eye className="size-3.5 mr-1" /> Viewport
            </Button>
          </div>
        </div>

        {/* Radius Search Panel */}
        <div className="p-4 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/40 dark:bg-zinc-900/20 shrink-0 flex flex-col gap-2.5">
          <div className="flex items-center justify-between">
            <div className="flex flex-col">
              <span className="text-xs font-semibold">Radius Search</span>
              <span className="text-[10px] text-muted-foreground">Find leads within target distance</span>
            </div>
            <Switch
              checked={enableRadiusSearch}
              onCheckedChange={setEnableRadiusSearch}
            />
          </div>

          {enableRadiusSearch && (
            <div className="flex flex-col gap-2 text-xs">
              <div className="flex items-center justify-between text-[11px] font-medium">
                <span>Distance: {radiusKm} km</span>
                <span className="text-[10px] text-muted-foreground">Click map to move center</span>
              </div>
              <input
                type="range"
                min="1"
                max="50"
                value={radiusKm}
                onChange={(e) => setRadiusKm(parseInt(e.target.value))}
                className="w-full accent-primary h-1 bg-zinc-200 rounded-lg appearance-none cursor-pointer dark:bg-zinc-700"
              />
              <div className="flex items-center gap-1.5 mt-1">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-[10px] flex-1 py-0 px-2 cursor-pointer"
                  onClick={handleSetCenterToCurrent}
                >
                  <Crosshair className="size-3 mr-1" /> Use Map Center
                </Button>
                {radiusCenter && (
                  <Badge variant="secondary" className="h-7 text-[9px] px-1.5 shrink-0 max-w-[130px] truncate">
                    Center: {radiusCenter[0].toFixed(2)}, {radiusCenter[1].toFixed(2)}
                  </Badge>
                )}
              </div>
            </div>
          )}
        </div>

        {/* scrollable lead list */}
        <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-2">
          {loading ? (
            Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-20 w-full border rounded-lg bg-muted animate-pulse" />
            ))
          ) : filteredRecords.length > 0 ? (
            filteredRecords.map((r) => (
              <div
                key={r.id}
                onClick={() => handleFlyTo(r)}
                className="p-3 border rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-900 cursor-pointer transition-all flex flex-col gap-1.5 text-xs text-left group"
              >
                <div className="flex items-start justify-between gap-1.5">
                  <span className="font-semibold text-foreground truncate group-hover:text-primary transition-colors flex-1">
                    {r.name}
                  </span>
                  {r.is_favorite === 1 && (
                    <Star className="size-3.5 text-yellow-500 fill-yellow-500 shrink-0" />
                  )}
                </div>
                {r.category && (
                  <div className="text-[10px] text-muted-foreground">{r.category}</div>
                )}
                {r.address && (
                  <div className="flex items-center gap-1 text-[10px] text-muted-foreground truncate">
                    <MapPin className="size-3 text-zinc-400 shrink-0" />
                    <span>{r.address}</span>
                  </div>
                )}
                <div className="flex items-center justify-between text-[10px] text-muted-foreground pt-1 border-t border-dashed mt-0.5">
                  <div className="flex items-center gap-1">
                    {r.rating && (
                      <span className="font-semibold text-amber-500">★ {r.rating}</span>
                    )}
                    {r.phone && <Phone className="size-2.5 text-zinc-400" />}
                    {r.email && <Mail className="size-2.5 text-zinc-400" />}
                    {r.website && <Globe className="size-2.5 text-zinc-400" />}
                  </div>
                  <ChevronRight className="size-3 text-zinc-400 opacity-0 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all" />
                </div>
              </div>
            ))
          ) : (
            <div className="text-center text-muted-foreground text-xs p-6 italic">
              No leads match selected filters or geographic region.
            </div>
          )}
        </div>
      </div>

      {/* Map Content */}
      <div className="flex-1 h-1/2 md:h-full w-full relative z-10">
        <MapContainer
          
          center={defaultCenter}
          zoom={10}
          className="h-full w-full outline-none"
        >
          <TileLayer
            attribution={tileLayerAttribution}
            url={tileLayerUrl}
          />

          {/* Markers */}
          {filteredRecords.map((r) => {
            const isFav = r.is_favorite === 1;
            const markerColor = isFav ? "#eab308" : "#3b82f6"; // yellow-500 vs blue-500
            
            return (
              <Marker
                key={r.id}
                position={[r.latitude, r.longitude]}
                icon={createCustomIcon(markerColor, isFav)}
              >
                <Popup className="leaflet-custom-popup">
                  <div className="p-1 flex flex-col gap-1.5 max-w-[200px] text-xs">
                    <div className="font-bold text-foreground truncate">{r.name}</div>
                    {r.category && (
                      <div className="text-[10px] font-semibold text-primary">{r.category}</div>
                    )}
                    {r.address && (
                      <div className="text-[10px] text-muted-foreground truncate">{r.address}</div>
                    )}
                    {r.rating && (
                      <div className="text-[10px] font-semibold text-amber-500">★ {r.rating} / 5.0 ({r.total_reviews ? r.total_reviews.replace(/[()]/g, "") : "0"} reviews)</div>
                    )}
                    <Separator className="my-0.5" />
                    <div className="flex gap-1.5 justify-end">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 text-[10px] px-1.5 py-0 cursor-pointer"
                        onClick={() => handleSelectRecord(r)}
                      >
                        Details
                      </Button>
                    </div>
                  </div>
                </Popup>
              </Marker>
            );
          })}

          {/* Radius visual overlay */}
          {enableRadiusSearch && radiusCenter && (
            
            <CircleHelper center={radiusCenter} radius={radiusKm * 1000} />
          )}

          {/* Sync map bounds back to client state */}
          <MapEventsHandler
            onBoundsChange={setMapBounds}
            onCenterChange={setMapCenter}
            center={mapTarget?.center}
            zoom={mapTarget?.zoom}
          />

          <MapClickSelector enableRadiusSearch={enableRadiusSearch} setRadiusCenter={setRadiusCenter} />
        </MapContainer>

        {/* Floating summary badge */}
        <div className="absolute top-4 right-4 bg-background/90 backdrop-blur-sm border border-zinc-200 dark:border-zinc-800 rounded-lg px-3 py-1.5 shadow-md z-[1000] text-xs font-semibold flex items-center gap-1.5">
          <MapPin className="size-3.5 text-primary" />
          <span>Showing {filteredRecords.length} / {records.length} geolocated leads</span>
        </div>
      </div>

      {/* Slide-over Detail Panel */}
      <Sheet open={selectedRecord !== null} onOpenChange={(open) => { if (!open) setSelectedRecord(null); }}>
        <SheetContent className="w-full sm:max-w-md overflow-y-auto flex flex-col gap-6" side="right">
          {selectedRecord && (
            <>
              <SheetHeader className="text-left border-b pb-4">
                <div className="flex items-center justify-between mt-4">
                  <div className="text-[10px] uppercase font-bold tracking-wider text-primary">
                    {selectedRecord.category || "Lead Detail"}
                  </div>
                  {selectedRecord.is_favorite === 1 && (
                    <Badge variant="secondary" className="bg-yellow-500/10 text-yellow-600 hover:bg-yellow-500/20 text-[10px] font-semibold border-yellow-500/20">
                      Starred
                    </Badge>
                  )}
                </div>
                <SheetTitle className="text-lg font-bold tracking-tight text-foreground mt-1">
                  {selectedRecord.name}
                </SheetTitle>
              </SheetHeader>

              {/* Lead Details Grid */}
              <div className="flex flex-col gap-4">
                <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Contact & Info</h4>
                <div className="grid grid-cols-1 gap-3 text-xs border rounded-lg p-3 bg-zinc-50/50 dark:bg-zinc-900/50">
                  {/* Website */}
                  <div className="flex items-center justify-between py-1 border-b last:border-b-0">
                    <span className="text-muted-foreground flex items-center gap-1.5"><Globe className="size-3.5 text-zinc-400" /> Website</span>
                    {selectedRecord.website ? (
                      <a href={selectedRecord.website} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline truncate max-w-[200px] flex items-center gap-1">
                        Link <ExternalLink className="size-3" />
                      </a>
                    ) : <span className="text-zinc-400">-</span>}
                  </div>

                  {/* Email */}
                  <div className="flex items-center justify-between py-1 border-b last:border-b-0">
                    <span className="text-muted-foreground flex items-center gap-1.5"><Mail className="size-3.5 text-zinc-400" /> Email</span>
                    {selectedRecord.email ? (
                      <a href={`mailto:${selectedRecord.email}`} className="text-primary hover:underline truncate max-w-[200px]">
                        {selectedRecord.email}
                      </a>
                    ) : <span className="text-zinc-400">-</span>}
                  </div>

                  {/* Phone */}
                  <div className="flex items-center justify-between py-1 border-b last:border-b-0">
                    <span className="text-muted-foreground flex items-center gap-1.5"><Phone className="size-3.5 text-zinc-400" /> Phone</span>
                    {selectedRecord.phone ? (
                      <a href={`tel:${selectedRecord.phone}`} className="text-primary hover:underline">
                        {selectedRecord.phone}
                      </a>
                    ) : <span className="text-zinc-400">-</span>}
                  </div>

                  {/* Rating */}
                  <div className="flex items-center justify-between py-1 border-b last:border-b-0">
                    <span className="text-muted-foreground flex items-center gap-1.5"><Star className="size-3.5 text-yellow-500 fill-yellow-500" /> Rating</span>
                    <span className="font-semibold">
                      {selectedRecord.rating ? `${selectedRecord.rating} / 5.0 (${selectedRecord.total_reviews ? selectedRecord.total_reviews.replace(/[()]/g, "") : "0"} reviews)` : "Unrated"}
                    </span>
                  </div>
                </div>
              </div>

              {/* Geographic Data */}
              <div className="flex flex-col gap-4">
                <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Geographic Location</h4>
                <div className="grid grid-cols-1 gap-3 text-xs border rounded-lg p-3 bg-zinc-50/50 dark:bg-zinc-900/50">
                  <div className="flex items-start gap-1.5">
                    <MapPin className="size-4 mt-0.5 text-muted-foreground shrink-0" />
                    <div className="flex flex-col gap-1">
                      <span className="font-medium text-muted-foreground">Address</span>
                      <span className="text-foreground">{selectedRecord.address || "No address"}</span>
                    </div>
                  </div>
                  <Separator className="my-1" />
                  <div className="grid grid-cols-3 gap-2">
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

              {/* Actions */}
              <div className="flex gap-2 border-t pt-4 mt-auto">
                {selectedRecord.google_maps_url && (
                  <Button
                    variant="outline"
                    className="flex-1 text-xs"
                    onClick={() => window.open(selectedRecord.google_maps_url!, "_blank", "noopener,noreferrer")}
                  >
                    Open on Maps <ExternalLink className="size-3.5 ml-1.5" />
                  </Button>
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

// React-leaflet Circle rendering helper component to handle circle update behavior cleanly

function CircleHelper({ center, radius }: { center: [number, number]; radius: number }) {
  const map = useMap();
  const circleRef = React.useRef<L.Circle | null>(null);

  useEffect(() => {
    if (!center) return;

    if (circleRef.current) {
      circleRef.current.setLatLng(center);
      circleRef.current.setRadius(radius);
    } else {
      circleRef.current = L.circle(center, {
        radius,
        color: "#3b82f6",
        fillColor: "#3b82f6",
        fillOpacity: 0.15,
        weight: 1.5,
        dashArray: "4, 4"
      }).addTo(map);
    }

    return () => {
      if (circleRef.current) {
        circleRef.current.remove();
        circleRef.current = null;
      }
    };
  }, [center, radius, map]);

  return null;
}
