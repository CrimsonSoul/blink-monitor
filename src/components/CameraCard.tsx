import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Battery, Wifi, Play, Square, Circle, Settings, Maximize2 } from "lucide-react";
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
  serverPort: number | null;
  isPlaying?: boolean;
  playUrl?: string | null;
  onStop?: () => void;
  recording?: boolean;
  onToggleRecording?: () => void;
  onTheaterMode?: () => void;
}

export function CameraCard({ camera, onLiveView, serverPort, isPlaying, playUrl, onStop, recording, onToggleRecording, onTheaterMode }: CameraCardProps) {
  const [streamStatus, setStreamStatus] = useState<string>("");
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  const thumbUrl = serverPort && camera.thumbnail 
    ? `http://localhost:${serverPort}/thumbnail?url=${encodeURIComponent(camera.thumbnail)}`
    : null;

  const getCleanStatus = (status: string) => {
    if (!status) return 'Unknown';
    if (status.toLowerCase() === 'done') return 'Online';
    return status.charAt(0).toUpperCase() + status.slice(1);
  };

  return (
    <>
      <Card className={`border-slate-800 bg-slate-900 overflow-hidden group shadow-lg transition-all ${isPlaying ? 'ring-2 ring-blue-600 border-transparent' : 'hover:border-blue-500/50 hover:shadow-blue-500/10'}`}>
        <div className="relative aspect-video bg-black flex items-center justify-center overflow-hidden">
          {isPlaying && playUrl ? (
            <MpegtsPlayer 
              url={playUrl} 
              onStatusChange={setStreamStatus}
            />
          ) : (
            <>
              {thumbUrl ? (
                <img 
                  src={thumbUrl} 
                  alt={camera.name}
                  loading="lazy"
                  className="w-full h-full object-cover opacity-80 group-hover:opacity-100 group-hover:scale-105 transition-all duration-500"
                />
              ) : (
                <div className="text-slate-500 text-xs">No Preview</div>
              )}
              <div className="absolute top-4 right-4 flex gap-2 transform translate-y-[-10px] opacity-0 group-hover:translate-y-0 group-hover:opacity-100 transition-all duration-300">
                <Badge className="bg-black/60 backdrop-blur-md border-none text-xs py-1 px-3">
                  <Battery className="w-4 h-4 mr-1.5" /> {camera.battery ?? "N/A"}
                </Badge>
                <Badge className="bg-black/60 backdrop-blur-md border-none text-xs py-1 px-3">
                  <Wifi className="w-4 h-4 mr-1.5" /> {camera.signals?.wifi ?? 0}
                </Badge>
              </div>
              <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/40">
                 <Button onClick={() => onLiveView(camera)} className="bg-blue-600 hover:bg-blue-700 text-white rounded-full px-10 py-8 text-lg font-bold shadow-2xl shadow-blue-600/40 transform scale-90 group-hover:scale-100 transition-all">
                   <Play className="w-6 h-6 mr-2.5 fill-current" /> Live View
                 </Button>
              </div>
            </>
          )}
        </div>
        <CardHeader className="p-6 bg-slate-900 flex flex-row items-center justify-between">
          <div className="space-y-1 overflow-hidden">
            <CardTitle className="text-lg font-bold text-white leading-tight truncate">{camera.name}</CardTitle>
            <CardDescription className="text-xs text-slate-400 font-bold tracking-widest uppercase truncate">
              {isPlaying ? (
                <span className="text-blue-400 animate-pulse">{streamStatus || "Connecting..."}</span>
              ) : (
                getCleanStatus(camera.status)
              )}
            </CardDescription>
          </div>
          <div className="flex items-center gap-2 shrink-0 ml-4">
            {isPlaying ? (
              <>
                <Button 
                  variant="ghost" 
                  size="icon" 
                  onClick={onTheaterMode}
                  className="text-slate-400 hover:text-white hover:bg-slate-800 rounded-full w-9 h-9"
                >
                  <Maximize2 className="w-4 h-4" />
                </Button>
                <Button 
                  variant="ghost" 
                  size="sm" 
                  onClick={onToggleRecording}
                  className={`font-bold uppercase tracking-tighter transition-colors ${recording ? 'text-red-500 hover:text-red-400 hover:bg-red-500/10' : 'text-slate-500 hover:text-slate-400 hover:bg-slate-500/10'}`}
                >
                  <Circle className={`w-3 h-3 mr-2 ${recording ? 'fill-current animate-pulse' : 'fill-slate-800'}`} />
                  REC
                </Button>
                <Button 
                  variant="ghost" 
                  size="sm" 
                  onClick={onStop}
                  className="text-red-400 hover:text-red-300 hover:bg-red-400/10 font-bold uppercase tracking-tighter"
                >
                  <Square className="w-4 h-4 mr-2 fill-current" /> Stop
                </Button>
              </>
            ) : (
              <Button 
                variant="ghost" 
                size="icon"
                onClick={() => setIsSettingsOpen(true)}
                className="text-slate-500 hover:text-white hover:bg-slate-800 rounded-full w-9 h-9"
              >
                <Settings className="w-5 h-5" />
              </Button>
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
