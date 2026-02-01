import { useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Play, Square, Download, RefreshCw } from "lucide-react";
import { VideoControls } from "./VideoControls";
import { cn } from "@/lib/utils";

export interface Media {
  id: number;
  device_name: string;
  thumbnail: string;
  media: string;
  created_at: string;
}

interface MediaCardProps {
  item: Media;
  onPlay: (m: Media) => void;
  serverPort: number | null;
  isPlaying?: boolean;
  playUrl?: string | null;
  onStop?: () => void;
}

export function MediaCard({ item, onPlay, serverPort, isPlaying, playUrl, onStop }: MediaCardProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  
  const thumbUrl = serverPort && item.thumbnail 
    ? `http://localhost:${serverPort}/thumbnail?url=${encodeURIComponent(item.thumbnail)}`
    : null;

  async function handleDownload(e: React.MouseEvent) {
    e.stopPropagation();
    try {
      const fileName = `${item.device_name.replace(/[^a-z0-9]/gi, '_')}_${item.created_at.replace(/[:.]/g, '-')}.mp4`;
      const path = await save({
        defaultPath: fileName,
        filters: [{ name: 'Video', extensions: ['mp4'] }]
      });

      if (path) {
        setDownloading(true);
        await invoke("download_clip", { url: item.media, path });
      }
    } catch (e) {
      console.error("Download failed:", e);
    } finally {
      setDownloading(false);
    }
  }

  return (
    <Card className={`border-slate-800 bg-slate-900 overflow-hidden group cursor-pointer shadow-lg transition-all ${isPlaying ? 'ring-2 ring-blue-600 border-transparent' : 'hover:border-blue-500/50'}`} onClick={() => !isPlaying && onPlay(item)}>
      <div ref={wrapperRef} className="relative aspect-video bg-black flex items-center justify-center overflow-hidden group/player">
        {isPlaying && playUrl ? (
          <>
            {loading && (
              <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-black">
                <RefreshCw className="w-10 h-10 text-blue-500 animate-spin" />
              </div>
            )}
            <video 
              ref={videoRef}
              src={playUrl} 
              autoPlay 
              className={cn(
                "w-full h-full transition-opacity duration-700",
                loading ? "opacity-0" : "opacity-100"
              )}
              onEnded={onStop}
              onWaiting={() => setLoading(true)}
              onPlaying={() => setLoading(false)}
              onCanPlay={() => setLoading(false)}
            >
              <track kind="captions" />
            </video>
            {!loading && <VideoControls videoRef={videoRef} wrapperRef={wrapperRef} isLive={false} />}
          </>
        ) : (
          <>
            {thumbUrl ? (
              <img 
                src={thumbUrl} 
                alt={item.device_name}
                loading="lazy"
                className="w-full h-full object-cover opacity-60 group-hover:opacity-90 group-hover:scale-105 transition-all duration-500"
              />
            ) : (
              <div className="text-slate-500 text-xs">No Preview</div>
            )}
            <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-300 bg-black/40">
               <div className="bg-blue-600 rounded-full p-4 shadow-2xl shadow-blue-600/40 transform scale-75 group-hover:scale-100 transition-all">
                 <Play className="w-8 h-8 text-white fill-current" />
               </div>
            </div>
            <div className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity">
              <Button 
                onClick={handleDownload}
                size="icon"
                disabled={downloading}
                className="bg-black/50 hover:bg-blue-600 text-white rounded-full w-10 h-10 border border-white/10"
              >
                {downloading ? <RefreshCw className="w-5 h-5 animate-spin" /> : <Download className="w-5 h-5" />}
              </Button>
            </div>
          </>
        )}
      </div>
      <CardHeader className="p-6 bg-slate-900 flex flex-row items-center justify-between">
        <div className="space-y-1 min-w-0">
          <CardTitle className="text-lg font-bold text-white truncate leading-tight">{item.device_name}</CardTitle>
          <CardDescription className="text-xs text-slate-400 font-bold uppercase tracking-wide">
            {new Date(item.created_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
          </CardDescription>
        </div>
        {isPlaying && (
          <Button 
            variant="ghost" 
            size="sm" 
            onClick={(e) => { e.stopPropagation(); onStop?.(); }}
            className="text-red-400 hover:text-red-300 hover:bg-red-400/10 font-bold uppercase tracking-tighter"
          >
            <Square className="w-4 h-4 mr-2 fill-current" /> Stop
          </Button>
        )}
      </CardHeader>
    </Card>
  );
}
