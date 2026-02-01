import { useRef, useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Button } from "@/components/ui/button";
import { RefreshCw, Bug } from "lucide-react";
import mpegts from 'mpegts.js';
import { VideoControls } from "./VideoControls";
import { cn } from "@/lib/utils";

interface MpegtsPlayerProps {
  url: string;
  onStatusChange?: (status: string) => void;
  onStreamStarted?: () => void;
}

export function MpegtsPlayer({ url, onStatusChange, onStreamStarted }: MpegtsPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<mpegts.Player | null>(null);
  const startedRef = useRef(false);
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

  const markStarted = useCallback(() => {
    if (!startedRef.current) {
      startedRef.current = true;
      onStreamStarted?.();
    }
  }, [onStreamStarted]);

  useEffect(() => {
    if (!videoRef.current) return;

    if (mpegts.getFeatureList().mseLivePlayback) {
      setError(null);
      setLoading(true);
      updateStatus("Establishing IMMI handshake...");

      const player = mpegts.createPlayer({
        type: 'mpegts',
        isLive: true,
        url: url,
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
        setError(`Stream Error: ${type} (${detail})`);
        setLoading(false);
      });

      player.on(mpegts.Events.MEDIA_INFO, (info) => {
        console.log("Stream media info arrived", info);
        updateStatus("Stream metadata received, starting playback...");
        markStarted();
        
        const playPromise = player.play();
        if (playPromise) {
          playPromise.then(() => {
            if (videoRef.current) {
              videoRef.current.muted = false;
              videoRef.current.volume = volume;
            }
          }).catch((e: Error) => {
            console.warn("Play deferred, waiting for more data...", e);
          });
        }
      });

      player.on(mpegts.Events.STATISTICS_INFO, () => {
        markStarted();
        if (loading) {
          setLoading(false);
          if (videoRef.current?.paused) {
            player.play()?.then(() => {
              if (videoRef.current) {
                videoRef.current.muted = false;
                videoRef.current.volume = volume;
              }
            }).catch(() => {});
          }
        }
      });

      const logInterval = setInterval(async () => {
        if (loading) {
          try {
            const logs = await invoke<string[]>("get_ffmpeg_logs");
            const lastLog = logs[logs.length - 1];
            if (lastLog && (lastLog.includes("Busy") || lastLog.includes("Establishing") || lastLog.includes("handshake") || lastLog.includes("Connected") || lastLog.includes("started"))) {
              updateStatus(lastLog);
            }
          } catch (e) {
            console.error("Failed to fetch logs", e);
          }
        }
      }, 1000);

      const timeout = setTimeout(() => {
        if (!startedRef.current) {
          setError("Stream Connection Timeout (45s). The camera might be busy or unreachable. Try again in a minute.");
          setLoading(false);
        }
      }, 45000);

      return () => {
        clearTimeout(timeout);
        clearInterval(logInterval);
        if (playerRef.current) {
          playerRef.current.destroy();
          playerRef.current = null;
        }
      };
    } else {
      setError("MSE Live Playback not supported in this browser");
    }
  }, [url, loading, markStarted, updateStatus, volume]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleVolumeChange = () => {
      const newVolume = video.volume;
      setVolume(newVolume);
      localStorage.setItem('blink_volume', newVolume.toString());
    };

    video.addEventListener('volumechange', handleVolumeChange);
    return () => video.removeEventListener('volumechange', handleVolumeChange);
  }, []);

  return (
    <div ref={wrapperRef} className="relative w-full h-full flex items-center justify-center bg-black group/player overflow-hidden">
      {loading && !error && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-black">
          <RefreshCw className="w-10 h-10 text-blue-500 animate-spin mb-4" />
          <p className="text-sm font-medium text-white">{status}</p>
        </div>
      )}
      {error && (
        <div className="absolute inset-0 z-40 flex flex-col items-center justify-center bg-black/80 px-10 text-center">
          <div className="bg-red-500/20 p-4 rounded-full mb-4">
             <Bug className="w-8 h-8 text-red-500" />
          </div>
          <p className="text-lg font-bold text-white mb-2">Livestream Error</p>
          <p className="text-sm text-slate-400 mb-6">{error}</p>
          <Button onClick={() => window.location.reload()} className="bg-slate-800 hover:bg-slate-700 text-white">
            Reload App
          </Button>
        </div>
      )}
      <video 
        ref={videoRef} 
        className={cn(
          "w-full h-full object-contain transition-opacity duration-700",
          loading ? "opacity-0" : "opacity-100"
        )}
        autoPlay
        muted
        playsInline
      >
        <track kind="captions" />
      </video>

      {!loading && !error && (
        <VideoControls videoRef={videoRef} wrapperRef={wrapperRef} isLive={true} />
      )}
    </div>
  );
}
