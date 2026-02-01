import { Media } from "./MediaCard";
import { MediaCard } from "./MediaCard";
import { Film } from "lucide-react";

interface TimelineViewProps {
  media: Media[];
  onPlay: (m: Media) => void;
  serverPort: number | null;
  playingItem: { id: number; type: string } | null;
  onStop: () => void;
}

export function TimelineView({ media, onPlay, serverPort, playingItem, onStop }: TimelineViewProps) {
  // Group media by date
  const grouped = media.reduce((acc, item) => {
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

  if (media.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-slate-600">
        <Film className="w-10 h-10 opacity-20 mb-4" />
        <p className="text-sm font-medium">No recent activity</p>
      </div>
    );
  }

  return (
    <div className="space-y-12 max-w-[1600px] mx-auto pb-20">
      {Object.entries(grouped).map(([date, items]) => (
        <div key={date} className="space-y-6">
          <div className="flex items-center gap-4">
            <div className="h-px flex-1 bg-slate-800/50" />
            <h3 className="text-xs font-bold uppercase tracking-[0.2em] text-slate-500 whitespace-nowrap">
              {date} <span className="ml-2 text-slate-600">({items.length})</span>
            </h3>
            <div className="h-px flex-1 bg-slate-800/50" />
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {items.map((item) => (
              <MediaCard 
                key={item.id} 
                item={item} 
                onPlay={onPlay} 
                serverPort={serverPort}
                isPlaying={playingItem?.id === item.id && playingItem?.type === 'media'}
                playUrl={playingItem?.id === item.id ? (playingItem as any).url : null}
                onStop={onStop}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
