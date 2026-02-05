import { useCallback, useEffect, useRef, useState } from "react";
import apiClient from "@/lib/apiClient";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Play, Square, Download, RefreshCw, Pause, Volume2, VolumeX, PictureInPicture, Maximize, Minimize, Image as ImageIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export interface Media {
  id: number;
  device_name: string;
  thumbnail?: any;
  thumbnail_url?: string;
  media?: any;
  media_url?: string;
  created_at: string;
  [key: string]: any;
}

interface MediaCardProps {
  item: Media;
  onPlay: (m: Media) => void;
  mediaBaseUrl: string | null;
  isPlaying?: boolean;
  playUrl?: string | null;
  onStop?: () => void;
  selectMode?: boolean;
  selected?: boolean;
  onToggleSelect?: (id: number) => void;
  thumbnailDataUrl?: string;
}

export function MediaCard({ item, onPlay, mediaBaseUrl, isPlaying, playUrl, onStop, selectMode, selected, onToggleSelect, thumbnailDataUrl }: MediaCardProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const downloadIdRef = useRef<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [isPaused, setIsPaused] = useState(true);
  const [isMuted, setIsMuted] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  
  const thumbnailPath = item.thumbnail_url || (typeof item.thumbnail === "string" ? item.thumbnail : "");
  const thumbUrl = mediaBaseUrl && thumbnailPath 
    ? `${mediaBaseUrl}/thumbnail?url=${encodeURIComponent(thumbnailPath)}`
    : null;
  const [thumbSrc, setThumbSrc] = useState<string | null>(thumbnailDataUrl || thumbUrl);
  const [thumbFallbackTried, setThumbFallbackTried] = useState(false);

  useEffect(() => {
    setThumbSrc(thumbnailDataUrl || thumbUrl);
    setThumbFallbackTried(false);
  }, [thumbUrl, item.thumbnail, item.thumbnail_url, thumbnailDataUrl]);

  const handleThumbError = useCallback(async () => {
    if (thumbFallbackTried) return;
    setThumbFallbackTried(true);
    if (!thumbnailPath) {
      setThumbSrc(null);
      return;
    }
    try {
      const cacheKey = `blink_media_thumb_${thumbnailPath}`;
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        setThumbSrc(cached);
        return;
      }
      const dataUrl = await apiClient.getThumbnailBase64(thumbnailPath);
      setThumbSrc(dataUrl);
    } catch {
      setThumbSrc(null);
    }
  }, [thumbFallbackTried, item.thumbnail, item.thumbnail_url, thumbnailPath]);

  useEffect(() => {
    let active = true;
    let cleanup: (() => void) | null = null;

    apiClient.onDownloadProgress((event) => {
      if (!active) return;
      const { id, received, total } = event;
      if (downloadIdRef.current !== id) return;
      if (total && total > 0) {
        const pct = Math.min(100, Math.round((received / total) * 100));
        setDownloadProgress(pct);
      } else {
        setDownloadProgress(0);
      }
    }).then((unlisten) => {
      if (!active) {
        unlisten();
        return;
      }
      cleanup = unlisten;
    }).catch(() => {});

    return () => {
      active = false;
      if (cleanup) cleanup();
    };
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (isPlaying && playUrl) {
      video.muted = true;
      setIsMuted(true);
    }

    const syncState = () => {
      setIsPaused(video.paused);
      setIsMuted(video.muted);
    };

    video.addEventListener("play", syncState);
    video.addEventListener("pause", syncState);
    video.addEventListener("volumechange", syncState);
    syncState();

    return () => {
      video.removeEventListener("play", syncState);
      video.removeEventListener("pause", syncState);
      video.removeEventListener("volumechange", syncState);
    };
  }, [isPlaying, playUrl]);

  useEffect(() => {
    const handleFullscreenChange = () => {
      const isNowFullscreen = document.fullscreenElement === wrapperRef.current;
      setIsFullscreen(isNowFullscreen);
      if (videoRef.current) {
        videoRef.current.controls = isNowFullscreen;
      }
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  const togglePlay = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (!videoRef.current) return;
    if (videoRef.current.paused) {
      videoRef.current.play().catch(console.error);
    } else {
      videoRef.current.pause();
    }
  };

  const toggleMute = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!videoRef.current) return;
    const nextMuted = !videoRef.current.muted;
    videoRef.current.muted = nextMuted;
    if (!nextMuted && videoRef.current.volume === 0) {
      videoRef.current.volume = 1;
    }
    setIsMuted(nextMuted);
  };

  const toggleFullscreen = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!wrapperRef.current) return;
    const elem = wrapperRef.current as any;
    if (!document.fullscreenElement) {
      const requestFullscreen =
        elem.requestFullscreen ||
        elem.webkitRequestFullscreen ||
        elem.mozRequestFullScreen ||
        elem.msRequestFullscreen;
      if (requestFullscreen) {
        await requestFullscreen.call(elem);
      }
    } else {
      const exitFullscreen =
        document.exitFullscreen ||
        (document as any).webkitExitFullscreen ||
        (document as any).mozCancelFullScreen ||
        (document as any).msExitFullscreen;
      if (exitFullscreen) {
        await exitFullscreen.call(document);
      }
    }
  };

  const togglePip = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!videoRef.current) return;
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else {
        await videoRef.current.requestPictureInPicture();
      }
    } catch (e) {
      console.error("PIP failed", e);
    }
  };

  async function handleDownload(e: React.MouseEvent) {
    e.stopPropagation();
    try {
      const fileName = `${item.device_name.replace(/[^a-z0-9]/gi, '_')}_${item.created_at.replace(/[:.]/g, '-')}.mp4`;
      const mediaUrl = item.media_url || (typeof item.media === "string" ? item.media : "");
      if (!mediaUrl) {
        setDownloadError("Missing clip URL.");
        return;
      }
      const downloadId = (typeof crypto !== "undefined" && "randomUUID" in crypto)
        ? crypto.randomUUID()
        : `${item.id}-${Date.now()}`;
      downloadIdRef.current = downloadId;
      setDownloadError(null);
      setDownloadProgress(0);
      setDownloading(true);
      const completed = await apiClient.downloadClip({
        url: mediaUrl,
        defaultFileName: fileName,
        downloadId,
        onProgress: (pct) => setDownloadProgress(pct)
      });
      if (completed) {
        setDownloadProgress(100);
      }
    } catch (e) {
      console.error("Download failed:", e);
      setDownloadError(typeof e === "string" ? e : String(e));
    } finally {
      setDownloading(false);
    }
  }

  const handleCardClick = () => {
    if (selectMode) {
      onToggleSelect?.(item.id);
      return;
    }
    if (!isPlaying) onPlay(item);
  };

  return (
    <Card
      className={`border-white/10 bg-[var(--app-surface)] overflow-hidden group cursor-pointer shadow-lg transition-all ${isPlaying ? 'ring-1 ring-[var(--app-accent)]/70 border-transparent' : 'hover:border-white/20'} ${selected ? 'ring-1 ring-[var(--app-accent)]/70 border-transparent' : ''}`}
      onClick={handleCardClick}
    >
      <div ref={wrapperRef} className="relative aspect-video bg-black/70 flex items-center justify-center overflow-hidden group/player">
        {isPlaying && playUrl ? (
          <>
            {loading && (
              <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-black">
                <RefreshCw className="w-10 h-10 text-[var(--app-accent)] animate-spin" />
              </div>
            )}
            <video 
              ref={videoRef}
              src={playUrl} 
              autoPlay 
              muted
              playsInline
              preload="metadata"
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
          </>
        ) : (
          <>
            {thumbSrc ? (
              <img 
                src={thumbSrc} 
                alt={item.device_name}
                loading="lazy"
                onError={handleThumbError}
                className="w-full h-full object-cover opacity-80 group-hover:opacity-100 group-hover:scale-[1.02] transition-all duration-500"
              />
            ) : (
              <div className="flex flex-col items-center justify-center text-slate-400 text-xs gap-2">
                <div className="w-9 h-9 rounded-full bg-[var(--app-surface-3)] border border-white/10 flex items-center justify-center text-slate-300">
                  <ImageIcon className="w-4 h-4" />
                </div>
                <span>No preview</span>
              </div>
            )}
            {selectMode && (
              <div className="absolute top-3 left-3 z-20">
                <div className={`w-5 h-5 rounded border ${selected ? 'bg-[var(--app-accent)] border-[var(--app-accent)]' : 'bg-black/40 border-white/20'} flex items-center justify-center`}>
                  {selected ? <div className="w-2.5 h-2.5 bg-white rounded-sm" /> : null}
                </div>
              </div>
            )}
            {!selectMode && (
            <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-300 bg-black/60">
                 <div className="bg-[var(--app-accent)] rounded-full p-4 shadow-2xl shadow-black/40 transform scale-75 group-hover:scale-100 transition-all">
                   <Play className="w-7 h-7 text-white fill-current" />
                 </div>
              </div>
            )}
            <div className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity">
              <Button 
                onClick={handleDownload}
                size="icon"
                disabled={downloading}
                className="bg-black/70 hover:bg-[var(--app-accent)] text-white rounded-full w-10 h-10 border border-white/10"
              >
                {downloading ? <RefreshCw className="w-5 h-5 animate-spin" /> : <Download className="w-5 h-5" />}
              </Button>
            </div>
            {downloading && (
              <div className="absolute left-4 bottom-4 right-4 bg-black/75 border border-white/10 rounded-md px-3 py-2">
                <div className="flex items-center justify-between text-[10px] tracking-widest text-slate-300 font-semibold">
                  <span>Downloading</span>
                  <span>{downloadProgress ?? 0}%</span>
                </div>
                <div className="mt-1 h-1 bg-white/10 rounded">
                  <div className="h-1 bg-[var(--app-accent)] rounded" style={{ width: `${downloadProgress ?? 0}%` }} />
                </div>
              </div>
            )}
            {downloadError && !downloading && (
              <div className="absolute left-4 bottom-4 right-4 bg-red-500/10 border border-red-500/30 rounded-md px-3 py-2 text-[10px] text-red-200">
                Download failed. Try again.
              </div>
            )}
          </>
        )}
      </div>
      <CardHeader className="p-5 bg-[var(--app-surface)] flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1 min-w-0">
          <CardTitle className="text-base sm:text-lg font-semibold text-white truncate leading-tight">{item.device_name}</CardTitle>
          <CardDescription className="text-[11px] sm:text-xs text-slate-500 font-medium">
            {new Date(item.created_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
          </CardDescription>
        </div>
        {isPlaying && (
          <div className="flex items-center gap-1 sm:gap-2 shrink-0 sm:ml-4 flex-wrap justify-between sm:justify-end w-full sm:w-auto">
            <Button 
              variant="ghost" 
              size="icon"
              onClick={togglePlay}
              className="icon-chip rounded-full w-8 h-8 sm:w-9 sm:h-9"
              title={isPaused ? "Play" : "Pause"}
              aria-label={isPaused ? "Play clip" : "Pause clip"}
            >
              {isPaused ? <Play className="w-4 h-4 fill-current" /> : <Pause className="w-4 h-4 fill-current" />}
            </Button>
            <Button 
              variant="ghost" 
              size="icon"
              onClick={toggleMute}
              className="icon-chip rounded-full w-8 h-8 sm:w-9 sm:h-9"
              title={isMuted ? "Unmute" : "Mute"}
              aria-label={isMuted ? "Unmute clip" : "Mute clip"}
            >
              {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
            </Button>
            <Button 
              variant="ghost" 
              size="icon"
              onClick={togglePip}
              className="icon-chip rounded-full w-8 h-8 sm:w-9 sm:h-9 hidden sm:inline-flex"
              title="Pop out"
              aria-label="Pop out clip"
            >
              <PictureInPicture className="w-4 h-4" />
            </Button>
            <Button 
              variant="ghost" 
              size="icon"
              onClick={toggleFullscreen}
              className="icon-chip rounded-full w-8 h-8 sm:w-9 sm:h-9 hidden md:inline-flex"
              title={isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
              aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
            >
              {isFullscreen ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
            </Button>
            <Button 
              variant="ghost" 
              size="sm" 
              onClick={(e) => { e.stopPropagation(); onStop?.(); }}
              className="h-8 sm:h-9 text-red-400 hover:text-red-300 hover:bg-red-400/10 font-semibold text-xs"
              aria-label="Stop clip playback"
            >
              <Square className="w-4 h-4 sm:mr-2 fill-current" />
              <span className="hidden sm:inline">Stop</span>
            </Button>
          </div>
        )}
      </CardHeader>
    </Card>
  );
}
