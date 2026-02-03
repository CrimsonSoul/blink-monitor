import { useState, useEffect, useCallback, useRef } from "react";
import { Volume2, VolumeX, Maximize, Minimize, PictureInPicture, Play, Pause } from "lucide-react";
import { cn } from "@/lib/utils";

interface VideoControlsProps {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  wrapperRef: React.RefObject<HTMLDivElement | null>;
  isLive?: boolean;
}

export function VideoControls({ videoRef, wrapperRef, isLive = false }: VideoControlsProps) {
  const [isPlaying, setIsPlaying] = useState(true);
  const [isMuted, setIsMuted] = useState(true);
  const [volume, setVolume] = useState(() => {
    const saved = localStorage.getItem("blink_volume");
    return saved ? parseFloat(saved) : 1;
  });
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showControls, setShowControls] = useState(false);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const syncState = () => {
      setIsPlaying(!video.paused);
      setIsMuted(video.muted);
      setVolume(video.volume);
    };

    video.addEventListener("play", syncState);
    video.addEventListener("pause", syncState);
    video.addEventListener("volumechange", syncState);

    // Initial sync
    syncState();

    return () => {
      video.removeEventListener("play", syncState);
      video.removeEventListener("pause", syncState);
      video.removeEventListener("volumechange", syncState);
    };
  }, [videoRef]);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  const togglePlay = useCallback((e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (!videoRef.current) return;
    if (videoRef.current.paused) {
      videoRef.current.play().catch(console.error);
    } else {
      videoRef.current.pause();
    }
  }, [videoRef]);

  const toggleMute = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (!videoRef.current) return;
    const newMuted = !videoRef.current.muted;
    videoRef.current.muted = newMuted;
    setIsMuted(newMuted);
    
    if (!newMuted && videoRef.current.volume === 0) {
      videoRef.current.volume = 1;
    }
  }, [videoRef]);

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    if (!videoRef.current) return;
    videoRef.current.volume = val;
    videoRef.current.muted = val === 0;
    setVolume(val);
    try {
      localStorage.setItem("blink_volume", val.toString());
    } catch {}
  };

  const toggleFullscreen = useCallback((e: React.MouseEvent) => {
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
        requestFullscreen.call(elem).catch(console.error);
      }
    } else {
      const exitFullscreen = 
        document.exitFullscreen || 
        (document as any).webkitExitFullscreen || 
        (document as any).mozCancelFullScreen || 
        (document as any).msExitFullscreen;
        
      if (exitFullscreen) {
        exitFullscreen.call(document);
      }
    }
  }, [wrapperRef]);

  const togglePip = useCallback(async (e: React.MouseEvent) => {
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
  }, [videoRef]);

  const resetTimer = useCallback(() => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    setShowControls(true);
    
    // Only auto-hide if playing. Keep visible if paused so user can find buttons.
    if (!videoRef.current?.paused) {
      timerRef.current = window.setTimeout(() => {
        setShowControls(false);
      }, 3000);
    }
  }, [videoRef]);

  useEffect(() => {
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, []);

  return (
    <div 
      className={cn(
        "absolute inset-0 z-20 flex flex-col justify-end transition-opacity duration-300",
        showControls || !isPlaying ? "opacity-100" : "opacity-0"
      )}
      onMouseEnter={resetTimer}
      onMouseLeave={() => {
        if (!videoRef.current?.paused) setShowControls(false);
      }}
      onMouseMove={resetTimer}
    >
      {/* Click surface for play/pause (only for clips) */}
      {!isLive && (
        <div 
          className="absolute inset-0 cursor-pointer" 
          onClick={togglePlay}
        />
      )}

      {/* Control Bar Overlay */}
      <div 
        className="bg-gradient-to-t from-black/90 via-black/60 to-transparent p-4 flex items-center gap-4 pointer-events-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {!isLive && (
          <button 
            type="button"
            onClick={togglePlay}
            className="text-white/90 hover:text-[var(--app-accent)] transition-colors"
          >
            {isPlaying ? <Pause className="w-6 h-6 fill-current" /> : <Play className="w-6 h-6 fill-current" />}
          </button>
        )}

        <div className="flex items-center gap-2 group/volume">
          <button 
            type="button"
            onClick={toggleMute}
            className="text-white/90 hover:text-[var(--app-accent)] transition-colors"
          >
            {isMuted || volume === 0 ? <VolumeX className="w-6 h-6" /> : <Volume2 className="w-6 h-6" />}
          </button>
          <input 
            type="range" 
            min="0" 
            max="1" 
            step="0.05" 
            value={isMuted ? 0 : volume}
            onChange={handleVolumeChange}
            className="w-20 h-1 bg-white/20 rounded-lg appearance-none cursor-pointer accent-[var(--app-accent)]"
          />
        </div>

        <div className="flex-1" />

        <div className="flex items-center gap-3">
          <button 
            type="button"
            onClick={togglePip}
            className="text-white/90 hover:text-[var(--app-accent)] transition-colors"
            title="Pop out"
          >
            <PictureInPicture className="w-5 h-5" />
          </button>
          <button 
            type="button"
            onClick={toggleFullscreen}
            className="text-white/90 hover:text-[var(--app-accent)] transition-colors"
            title={isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
          >
            {isFullscreen ? <Minimize className="w-6 h-6" /> : <Maximize className="w-6 h-6" />}
          </button>
        </div>
      </div>
    </div>
  );
}
