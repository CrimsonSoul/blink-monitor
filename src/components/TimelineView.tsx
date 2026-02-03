import { useMemo, useState } from "react";
import { Media } from "./MediaCard";
import { MediaCard } from "./MediaCard";
import { Film } from "lucide-react";

interface TimelineViewProps {
  media: Media[];
  onPlay: (m: Media) => void;
  serverPort: number | null;
  playingItem: { id: number; type: string } | null;
  onStop: () => void;
  mediaThumbCache?: Map<string, string>;
  selectMode?: boolean;
  selectedIds?: Set<number>;
  onToggleSelect?: (id: number) => void;
  onSelectAll?: () => void;
  onClearSelection?: () => void;
  onDeleteSelected?: () => void;
  deletingSelected?: boolean;
  onToggleSelectMode?: () => void;
  hasMore?: boolean;
  onLoadMore?: () => void;
  loadingMore?: boolean;
}

export function TimelineView({ media, onPlay, serverPort, playingItem, onStop, mediaThumbCache, selectMode, selectedIds, onToggleSelect, onSelectAll, onClearSelection, onDeleteSelected, deletingSelected, onToggleSelectMode, hasMore, onLoadMore, loadingMore }: TimelineViewProps) {
  const [search, setSearch] = useState("");
  const [deviceFilter, setDeviceFilter] = useState("all");
  const [sortOrder, setSortOrder] = useState<"newest" | "oldest">("newest");
  const [timeRange, setTimeRange] = useState<"all" | "24h" | "7d">("all");

  const deviceNames = useMemo(() => {
    const names = Array.from(new Set(media.map(m => m.device_name))).sort();
    return names;
  }, [media]);

  const filteredMedia = useMemo(() => {
    const now = Date.now();
    let items = media;
    if (timeRange !== "all") {
      const cutoff = timeRange === "24h" ? 24 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000;
      items = items.filter(m => {
        const ts = Date.parse(m.created_at);
        return Number.isFinite(ts) ? (now - ts) <= cutoff : true;
      });
    }
    if (deviceFilter !== "all") {
      items = items.filter(m => m.device_name === deviceFilter);
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      items = items.filter(m => m.device_name.toLowerCase().includes(q));
    }
    items = [...items].sort((a, b) => {
      const at = Date.parse(a.created_at);
      const bt = Date.parse(b.created_at);
      if (!Number.isFinite(at) || !Number.isFinite(bt)) return 0;
      return sortOrder === "newest" ? bt - at : at - bt;
    });
    return items;
  }, [media, deviceFilter, search, sortOrder, timeRange]);

  // Group media by date
  const grouped = filteredMedia.reduce((acc, item) => {
    const date = new Date(item.created_at).toLocaleDateString([], { 
      weekday: 'long', 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric' 
    });
    if (!acc[date]) acc[date] = [];
    acc[date].push(item);
    return acc;
  }, {} as Record<string, Media[]>);

  if (filteredMedia.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-center">
        <div className="w-12 h-12 rounded-full bg-[var(--app-accent)]/10 border border-[var(--app-accent)]/30 flex items-center justify-center text-[var(--app-accent)] mb-4">
          <Film className="w-5 h-5" />
        </div>
        <p className="text-sm font-semibold text-white/90">No recent activity</p>
        <p className="text-xs text-slate-400 mt-1">Clips will appear here as they’re recorded.</p>
      </div>
    );
  }

  return (
    <div className="space-y-12 max-w-[1600px] mx-auto pb-20">
      <div className="flex flex-wrap items-center gap-3 bg-[var(--app-surface-2)] border border-white/10 rounded-2xl p-4 shadow-[0_12px_30px_rgba(0,0,0,0.25)]">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by camera..."
          className="bg-[var(--app-surface-3)] border border-white/10 text-xs text-slate-200 rounded-full px-4 py-2 w-56 focus:border-[var(--app-accent)] focus:ring-2 focus:ring-[var(--app-accent-soft)] outline-none"
        />
        <select
          value={deviceFilter}
          onChange={(e) => setDeviceFilter(e.target.value)}
          className="bg-[var(--app-surface-3)] border border-white/10 text-xs text-slate-200 rounded-full px-4 py-2 focus:border-[var(--app-accent)] focus:ring-2 focus:ring-[var(--app-accent-soft)] outline-none"
        >
          <option value="all">All Cameras</option>
          {deviceNames.map((name) => (
            <option key={name} value={name}>{name}</option>
          ))}
        </select>
        <select
          value={timeRange}
          onChange={(e) => setTimeRange(e.target.value as "all" | "24h" | "7d")}
          className="bg-[var(--app-surface-3)] border border-white/10 text-xs text-slate-200 rounded-full px-4 py-2 focus:border-[var(--app-accent)] focus:ring-2 focus:ring-[var(--app-accent-soft)] outline-none"
        >
          <option value="all">All Time</option>
          <option value="24h">Last 24h</option>
          <option value="7d">Last 7d</option>
        </select>
        <select
          value={sortOrder}
          onChange={(e) => setSortOrder(e.target.value as "newest" | "oldest")}
          className="bg-[var(--app-surface-3)] border border-white/10 text-xs text-slate-200 rounded-full px-4 py-2 focus:border-[var(--app-accent)] focus:ring-2 focus:ring-[var(--app-accent-soft)] outline-none"
        >
          <option value="newest">Newest First</option>
          <option value="oldest">Oldest First</option>
        </select>
        <div className="text-[11px] text-slate-400 font-semibold ml-auto">
          {filteredMedia.length} clips
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onToggleSelectMode}
            className={`text-[11px] font-semibold px-4 py-1.5 rounded-full border ${selectMode ? 'text-[var(--app-accent)] border-[var(--app-accent)]/60 bg-[var(--app-accent)]/10' : 'text-slate-400 border-white/10 hover:border-white/20'}`}
          >
            {selectMode ? "Selecting" : "Select"}
          </button>
          {selectMode && (
            <>
              <button
                type="button"
                onClick={onSelectAll}
                className="text-[11px] font-semibold px-4 py-1.5 rounded-full border border-white/10 text-slate-300 hover:border-white/20"
              >
                Select All
              </button>
              <button
                type="button"
                onClick={onClearSelection}
                className="text-[11px] font-semibold px-4 py-1.5 rounded-full border border-white/10 text-slate-400 hover:border-white/20"
              >
                Clear
              </button>
              <button
                type="button"
                onClick={onDeleteSelected}
                disabled={deletingSelected || !selectedIds || selectedIds.size === 0}
                className={`text-[11px] font-semibold px-4 py-1.5 rounded-full border ${deletingSelected || !selectedIds || selectedIds.size === 0 ? 'border-white/5 text-slate-600' : 'border-red-500/50 text-red-300 hover:border-red-400'}`}
              >
                {deletingSelected ? "Deleting..." : `Delete (${selectedIds?.size ?? 0})`}
              </button>
            </>
          )}
        </div>
      </div>
      {Object.entries(grouped).map(([date, items]) => (
        <div key={date} className="space-y-6">
          <div className="flex items-center gap-4">
            <div className="h-px flex-1 bg-white/8" />
            <h3 className="text-xs font-semibold tracking-[0.25em] text-slate-500 whitespace-nowrap">
              {date} <span className="ml-2 text-slate-600">({items.length})</span>
            </h3>
            <div className="h-px flex-1 bg-white/8" />
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {items.map((item) => (
              <MediaCard 
                key={item.id} 
                item={item} 
                onPlay={onPlay} 
                serverPort={serverPort}
                isPlaying={playingItem?.id === item.id && playingItem?.type === 'media'}
                playUrl={playingItem?.id === item.id ? (playingItem as any).url : null}
                onStop={onStop}
                thumbnailDataUrl={
                  (item.thumbnail_url && mediaThumbCache?.get(item.thumbnail_url)) ||
                  (typeof item.thumbnail === "string" ? mediaThumbCache?.get(item.thumbnail) : undefined)
                }
                selectMode={selectMode}
                selected={selectedIds?.has(item.id)}
                onToggleSelect={onToggleSelect}
              />
            ))}
          </div>
        </div>
      ))}
      {onLoadMore && hasMore && (
        <div className="flex justify-center">
          <button
            type="button"
            onClick={onLoadMore}
            disabled={loadingMore}
            className="h-10 px-5 rounded-full border border-white/10 bg-[var(--app-surface-2)] text-xs text-slate-200 hover:bg-[var(--app-surface-3)] disabled:opacity-50"
          >
            {loadingMore ? "Loading..." : "Load more"}
          </button>
        </div>
      )}
      {onLoadMore && hasMore === false && (
        <div className="flex justify-center">
          <div className="h-10 px-5 rounded-full border border-white/10 bg-[var(--app-surface-2)] text-xs text-slate-400 flex items-center">
            End of history
          </div>
        </div>
      )}
    </div>
  );
}
