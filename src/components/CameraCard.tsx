import { useRef, useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Battery, Wifi, Play, Square, Circle, Settings, Maximize2, Star, PictureInPicture, Volume2, VolumeX, Camera as CameraIcon } from "lucide-react";
import { MpegtsPlayer } from "./MpegtsPlayer";
import { CameraSettings } from "./CameraSettings";

export interface CameraSignals {
  wifi?: number;
  battery?: number;
  temp?: number;
}

export interface Camera {
  id: number;
  name: string;
  thumbnail: string;
  status: string;
  battery?: string;
  signals?: CameraSignals;
  network_id?: number;
  product_type: string;
  serial?: string;
}

interface CameraCardProps {
  camera: Camera;
  onLiveView: (cam: Camera) => void;
  mediaBaseUrl: string | null;
  isPlaying?: boolean;
  playUrl?: string | null;
  onStop?: () => void;
  recording?: boolean;
  onToggleRecording?: () => void;
  onTheaterMode?: () => void;
  isFavorite?: boolean;
  onToggleFavorite?: () => void;
  thumbnailDataUrl?: string;
  suppressLivePlayback?: boolean;
}

export function CameraCard({ camera, onLiveView, mediaBaseUrl, isPlaying, playUrl, onStop, recording, onToggleRecording, onTheaterMode, isFavorite, onToggleFavorite, thumbnailDataUrl, suppressLivePlayback }: CameraCardProps) {
  const [streamStatus, setStreamStatus] = useState<string>("");
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isMuted, setIsMuted] = useState(true);
  const videoRef = useRef<HTMLVideoElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const thumbUrl = mediaBaseUrl && camera.thumbnail 
    ? `${mediaBaseUrl}/thumbnail?url=${encodeURIComponent(camera.thumbnail)}`
    : null;
  const effectiveThumbUrl = thumbnailDataUrl || thumbUrl;

  const getCleanStatus = (status: string) => {
    if (!status) return 'Unknown';
    if (status.toLowerCase() === 'done') return 'Online';
    return status.charAt(0).toUpperCase() + status.slice(1);
  };

  const handlePopOut = async () => {
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

  const handleToggleMute = () => {
    if (!videoRef.current) return;
    const nextMuted = !videoRef.current.muted;
    videoRef.current.muted = nextMuted;
    if (!nextMuted && videoRef.current.volume === 0) {
      videoRef.current.volume = 1;
    }
    setIsMuted(nextMuted);
  };

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const syncState = () => {
      setIsMuted(video.muted || video.volume === 0);
    };
    video.addEventListener("volumechange", syncState);
    syncState();
    return () => {
      video.removeEventListener("volumechange", syncState);
    };
  }, []);

  return (
    <>
      <Card className={`border-white/10 bg-[var(--app-surface)] overflow-hidden group shadow-lg transition-all ${isPlaying ? 'ring-1 ring-[var(--app-accent)]/70 border-transparent' : 'hover:border-white/20'}`}>
        <div className="relative aspect-video bg-black/70 flex items-center justify-center overflow-hidden">
          {isPlaying && playUrl && !suppressLivePlayback ? (
            <MpegtsPlayer 
              url={playUrl} 
              onStatusChange={setStreamStatus}
              showControls={false}
              videoRef={videoRef}
              wrapperRef={wrapperRef}
              fit="cover"
            />
          ) : isPlaying && suppressLivePlayback ? (
            <div className="w-full h-full flex flex-col items-center justify-center text-slate-400 text-xs">
              <span>Streaming in theater</span>
            </div>
          ) : (
            <>
              {effectiveThumbUrl ? (
                <img 
                  src={effectiveThumbUrl} 
                  alt={camera.name}
                  loading="lazy"
                  className="w-full h-full object-cover opacity-80 group-hover:opacity-100 group-hover:scale-[1.02] transition-all duration-500"
                />
              ) : (
                <div className="flex flex-col items-center justify-center text-slate-400 text-xs gap-2">
                  <div className="w-9 h-9 rounded-full bg-[var(--app-surface-3)] border border-white/10 flex items-center justify-center text-slate-300">
                    <CameraIcon className="w-4 h-4" />
                  </div>
                  <span>No preview</span>
                </div>
              )}
              <div className="absolute top-3 right-3 flex gap-2 opacity-0 group-hover:opacity-100 transition-all duration-300">
                <Badge className="bg-black/60 border border-white/10 text-[11px] py-1 px-2.5">
                  <Battery className="w-3.5 h-3.5 mr-1.5" /> {camera.battery ?? "N/A"}
                </Badge>
                <Badge className="bg-black/60 border border-white/10 text-[11px] py-1 px-2.5">
                  <Wifi className="w-3.5 h-3.5 mr-1.5" /> {camera.signals?.wifi ?? 0}
                </Badge>
              </div>
              <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/60">
                 <Button onClick={() => onLiveView(camera)} className="bg-[var(--app-accent)] hover:bg-[var(--app-accent-strong)] text-white rounded-full px-8 py-4 text-sm font-semibold shadow-2xl shadow-black/40 transform scale-95 group-hover:scale-100 transition-all">
                   <Play className="w-5 h-5 mr-2 fill-current" /> Live View
                 </Button>
              </div>
            </>
          )}
        </div>
        <CardHeader className="p-5 bg-[var(--app-surface)] flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1 overflow-hidden min-w-0">
            <CardTitle className="text-base sm:text-lg font-semibold text-white leading-tight truncate">{camera.name}</CardTitle>
            <CardDescription className="text-[11px] sm:text-xs text-slate-500 font-medium truncate">
              {isPlaying ? (
                <span className="text-[var(--app-accent)]">{streamStatus || "Connecting..."}</span>
              ) : (
                getCleanStatus(camera.status)
              )}
            </CardDescription>
          </div>
          <div className="flex items-center gap-1 sm:gap-2 shrink-0 sm:ml-4 flex-wrap justify-between sm:justify-end w-full sm:w-auto">
            {isPlaying ? (
              <>
                <Button 
                  variant="ghost" 
                  size="icon" 
                  onClick={onTheaterMode}
                  className="icon-chip rounded-full w-8 h-8 sm:w-9 sm:h-9"
                  title="Theater"
                  aria-label="Open theater mode"
                >
                  <Maximize2 className="w-4 h-4" />
                </Button>
                <Button 
                  variant="ghost" 
                  size="icon" 
                  onClick={handlePopOut}
                  className="icon-chip rounded-full w-8 h-8 sm:w-9 sm:h-9 hidden sm:inline-flex"
                  title="Pop out"
                  aria-label="Pop out video"
                >
                  <PictureInPicture className="w-4 h-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleToggleMute}
                  className="icon-chip rounded-full w-8 h-8 sm:w-9 sm:h-9"
                  title={isMuted ? "Unmute" : "Mute"}
                  aria-label={isMuted ? "Unmute live view" : "Mute live view"}
                >
                  {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                </Button>
                <Button 
                  variant="ghost" 
                  size="sm" 
                  onClick={onToggleRecording}
                  className={`h-8 sm:h-9 font-semibold text-xs transition-colors ${recording ? 'text-red-400 hover:text-red-300 hover:bg-red-500/10' : 'text-slate-500 hover:text-slate-300 hover:bg-[var(--app-surface-2)]'}`}
                >
                  <Circle className={`w-3 h-3 sm:mr-2 ${recording ? 'fill-current animate-pulse' : 'fill-slate-700'}`} />
                  <span className="hidden sm:inline">Rec</span>
                </Button>
                <Button 
                  variant="ghost" 
                  size="sm" 
                  onClick={onStop}
                  className="h-8 sm:h-9 text-red-400 hover:text-red-300 hover:bg-red-400/10 font-semibold text-xs"
                  aria-label="Stop live view"
                >
                  <Square className="w-4 h-4 sm:mr-2 fill-current" />
                  <span className="hidden sm:inline">Stop</span>
                </Button>
              </>
            ) : (
              <>
                <Button 
                  variant="ghost" 
                  size="icon"
                  onClick={() => onToggleFavorite?.()}
                  className={isFavorite 
                    ? "rounded-full w-8 h-8 sm:w-9 sm:h-9 text-yellow-400 hover:text-yellow-300 hover:bg-yellow-400/10 border border-yellow-400/30"
                    : "icon-chip rounded-full w-8 h-8 sm:w-9 sm:h-9"}
                  aria-label={isFavorite ? "Remove favorite" : "Add favorite"}
                >
                  <Star className={`w-4 h-4 ${isFavorite ? "fill-current" : ""}`} />
                </Button>
                <Button 
                  variant="ghost" 
                  size="icon"
                  onClick={() => setIsSettingsOpen(true)}
                  className="icon-chip rounded-full w-8 h-8 sm:w-9 sm:h-9"
                  aria-label="Open camera settings"
                >
                  <Settings className="w-5 h-5" />
                </Button>
              </>
            )}
          </div>
        </CardHeader>
      </Card>

      <CameraSettings 
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        networkId={camera.network_id || 0}
        cameraId={camera.id}
        productType={camera.product_type}
        cameraName={camera.name}
      />
    </>
  );
}
