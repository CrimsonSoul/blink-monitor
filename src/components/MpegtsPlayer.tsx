import { useRef, useState, useEffect, useCallback, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { RefreshCw, Bug } from "lucide-react";
import mpegts from 'mpegts.js';
import { VideoControls } from "./VideoControls";
import { cn } from "@/lib/utils";

interface MpegtsPlayerProps {
  url: string;
  onStatusChange?: (status: string) => void;
  onStreamStarted?: () => void;
  showControls?: boolean;
  videoRef?: React.RefObject<HTMLVideoElement | null>;
  wrapperRef?: React.RefObject<HTMLDivElement | null>;
  fit?: "contain" | "cover";
}

export function MpegtsPlayer({
  url,
  onStatusChange,
  onStreamStarted,
  showControls = true,
  videoRef: externalVideoRef,
  wrapperRef: externalWrapperRef,
  fit = "contain"
}: MpegtsPlayerProps) {
  const internalVideoRef = useRef<HTMLVideoElement>(null);
  const internalWrapperRef = useRef<HTMLDivElement>(null);
  const videoRef = externalVideoRef ?? internalVideoRef;
  const wrapperRef = externalWrapperRef ?? internalWrapperRef;
  const playerRef = useRef<mpegts.Player | null>(null);
  const startedRef = useRef(false);
  const volumeRef = useRef(1);
  const retryRef = useRef(0);
  const retryTimerRef = useRef<number | null>(null);
  const [retryToken, setRetryToken] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("Connecting...");
  const [volume, setVolume] = useState(() => {
    const saved = localStorage.getItem('blink_volume');
    return saved ? parseFloat(saved) : 1;
  });

  const updateStatus = useCallback((newStatus: string) => {
    setStatus(newStatus);
    onStatusChange?.(newStatus);
  }, [onStatusChange]);

  const effectiveUrl = useMemo(() => {
    const joiner = url.includes("?") ? "&" : "?";
    return `${url}${joiner}retry=${retryToken}`;
  }, [url, retryToken]);

  useEffect(() => {
    startedRef.current = false;
    retryRef.current = 0;
    if (retryTimerRef.current) {
      window.clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    setLoading(true);
    setError(null);
    setStatus("Connecting...");
  }, [effectiveUrl]);

  const markStarted = useCallback(() => {
    if (!startedRef.current) {
      startedRef.current = true;
      setLoading(false);
      onStreamStarted?.();
    }
  }, [onStreamStarted]);

  useEffect(() => {
    volumeRef.current = volume;
  }, [volume]);

  useEffect(() => {
    if (!videoRef.current) return;

    if (mpegts.getFeatureList().mseLivePlayback) {
      setError(null);
      setLoading(true);
      updateStatus("Establishing IMMI handshake...");

      const player = mpegts.createPlayer({
        type: 'mpegts',
        isLive: true,
        url: effectiveUrl,
        hasAudio: true,
        hasVideo: true,
      }, {
        enableStashBuffer: false,
        liveBufferLatencyChasing: true,
        autoCleanupSourceBuffer: true,
      });

      player.attachMediaElement(videoRef.current);
      player.load();
      playerRef.current = player;

      player.on(mpegts.Events.ERROR, (type, detail, info) => {
        console.error("mpegts error", type, detail, info);
        const statusCode = info?.code ? ` ${info.code}` : "";
        const statusMsg = info?.msg ? ` ${info.msg}` : "";
        let message = `Stream Error: ${type} (${detail})${statusCode}${statusMsg}`;
        
        // If we have a 500 error, try to extract the more detailed message from the body if possible
        // Note: mpegts.js might not always provide the body in info.msg for 500s, 
        // but we'll try to make it as helpful as possible.
        if (info?.code === 500 && info?.msg) {
          message = `Backend Error: ${info.msg}`;
        }
        
        setError(message);
        setLoading(false);

        const shouldRetry = detail === "HttpStatusCodeInvalid" && typeof info?.code === "number" && info.code >= 500;
        if (shouldRetry && retryRef.current < 3) {
          retryRef.current += 1;
          const delayMs = Math.min(2000 * retryRef.current, 8000);
          updateStatus(`Stream unavailable (HTTP ${info.code}). Retrying in ${Math.round(delayMs / 1000)}s...`);
          setLoading(true);
          setError(null);
          retryTimerRef.current = window.setTimeout(() => {
            setRetryToken((t) => t + 1);
          }, delayMs);
        }
      });

      player.on(mpegts.Events.MEDIA_INFO, (info) => {
        console.log("Stream media info arrived", info);
        updateStatus("Stream metadata received, starting playback...");
        
        const playPromise = player.play();
        if (playPromise) {
          playPromise.then(() => {
            if (videoRef.current) {
              videoRef.current.volume = volumeRef.current;
            }
          }).catch((e: Error) => {
            console.warn("Play deferred, waiting for more data...", e);
          });
        }
      });

      player.on(mpegts.Events.STATISTICS_INFO, () => {
        setLoading(false);
        markStarted();
        if (videoRef.current?.paused) {
          player.play()?.then(() => {
            if (videoRef.current) {
              videoRef.current.volume = volumeRef.current;
            }
          }).catch(() => {});
        }
      });

      const timeout = setTimeout(() => {
        if (!startedRef.current) {
          setError("Stream Connection Timeout (45s). The camera might be busy or unreachable. Try again in a minute.");
          setLoading(false);
        }
      }, 45000);

      return () => {
        clearTimeout(timeout);
        if (retryTimerRef.current) {
          window.clearTimeout(retryTimerRef.current);
          retryTimerRef.current = null;
        }
        if (playerRef.current) {
          playerRef.current.destroy();
          playerRef.current = null;
        }
      };
    } else {
      setError("MSE Live Playback not supported in this browser");
    }
  }, [effectiveUrl, markStarted, updateStatus]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleVolumeChange = () => {
      const newVolume = video.volume;
      setVolume(newVolume);
      try {
        localStorage.setItem('blink_volume', newVolume.toString());
      } catch {}
    };

    const handlePlaying = () => {
      updateStatus("Live stream connected");
      markStarted();
    };

    video.addEventListener('volumechange', handleVolumeChange);
    video.addEventListener('playing', handlePlaying);
    return () => {
      video.removeEventListener('volumechange', handleVolumeChange);
      video.removeEventListener('playing', handlePlaying);
    };
  }, [markStarted, updateStatus]);

  const handleRetry = useCallback(() => {
    setRetryToken((t) => t + 1);
  }, []);

  return (
    <div ref={wrapperRef} className="relative w-full h-full flex items-center justify-center bg-black group/player overflow-hidden">
      {loading && !error && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-black">
          <RefreshCw className="w-10 h-10 text-[var(--app-accent)] animate-spin mb-4" />
          <p className="text-sm font-medium text-white/90">{status}</p>
        </div>
      )}
      {error && (
        <div className="absolute inset-0 z-40 flex flex-col items-center justify-center bg-black/80 px-10 text-center">
          <div className="bg-[var(--app-accent)]/10 border border-[var(--app-accent)]/30 p-4 rounded-full mb-4">
             <Bug className="w-8 h-8 text-[var(--app-accent)]" />
          </div>
          <p className="text-lg font-bold text-white mb-2">Livestream Error</p>
          <p className="text-sm text-slate-400 mb-6">{error}</p>
          <Button onClick={handleRetry} className="bg-[var(--app-surface-3)] hover:bg-[var(--app-surface-2)] border border-white/10 text-white">
            Retry Stream
          </Button>
        </div>
      )}
      <video 
        ref={videoRef} 
        className={cn(
          "w-full h-full transition-opacity duration-700",
          fit === "cover" ? "object-cover" : "object-contain",
          loading ? "opacity-0" : "opacity-100"
        )}
        autoPlay
        muted
        playsInline
      >
        <track kind="captions" />
      </video>

      {!loading && !error && showControls && (
        <VideoControls videoRef={videoRef} wrapperRef={wrapperRef} isLive={true} />
      )}
    </div>
  );
}
