import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { isPermissionGranted, requestPermission, sendNotification } from '@tauri-apps/plugin-notification';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Camera as CameraIcon, Shield, ShieldOff, RefreshCw, X, Circle } from "lucide-react";
import { Sidebar } from "@/components/Sidebar";
import { CameraCard, type Camera } from "@/components/CameraCard";
import { type Media } from "@/components/MediaCard";
import { MpegtsPlayer } from "@/components/MpegtsPlayer";
import { TimelineView } from "@/components/TimelineView";
import { cn } from "@/lib/utils";

interface Network {
  id: number;
  name: string;
  armed: boolean;
}

function App() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pin, setPin] = useState("");
  const [step, setStep] = useState<"login" | "pin" | "dashboard">("login");
  const [activeTab, setActiveTab] = useState("cameras");
  const [cameras, setCameras] = useState<Camera[]>([]);
  const [networks, setNetworks] = useState<Network[]>([]);
  const [media, setMedia] = useState<Media[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [serverPort, setServerPort] = useState<number | null>(null);
  const [playingItems, setPlayingItems] = useState<Map<number, { id: number, type: 'camera' | 'media', url: string, camera?: Camera }>>(new Map());
  const [recording, setRecording] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  const [newClipCount, setNewClipCount] = useState(0);
  const [theaterMode, setTheaterMode] = useState(false);

  const lastSeenMediaIdRef = useRef<number>(0);

  const handleLogout = useCallback(async () => {
    try {
      await invoke("logout");
      setCameras([]);
      setNetworks([]);
      setMedia([]);
      setServerPort(null);
      setStep("login");
      setTheaterMode(false);
      setPlayingItems(new Map());
    } catch (e) {
      console.error("Logout failed:", e);
    }
  }, []);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const rawHome = await invoke<string>("get_raw_homescreen");
      const parsedHome = JSON.parse(rawHome);
      
      const nets = parsedHome.networks || [];
      const cams = [
        ...(parsedHome.cameras || []).map((c: any) => ({ ...c, product_type: c.type || "camera", serial: c.serial })),
        ...(parsedHome.owls || []).map((c: any) => ({ ...c, product_type: c.type || "owl", serial: c.serial })),
        ...(parsedHome.doorbells || []).map((c: any) => ({ ...c, product_type: c.type || "doorbell", serial: c.serial }))
      ];
      
      setNetworks(nets);
      setCameras(cams);

      const rawMedia = await invoke<string>("get_raw_media");
      const parsedMedia = JSON.parse(rawMedia);
      const mediaItems: Media[] = (parsedMedia.media || []).slice(0, 50);
      
      if (mediaItems.length > 0) {
        const latestId = mediaItems[0].id;
        if (lastSeenMediaIdRef.current > 0 && latestId > lastSeenMediaIdRef.current) {
          const newOnes = mediaItems.filter(m => m.id > lastSeenMediaIdRef.current);
          if (newOnes.length > 0) {
            setNewClipCount(prev => prev + newOnes.length);
            
            const hasPermission = await isPermissionGranted();
            if (hasPermission) {
              sendNotification({
                title: `${newOnes.length} new motion event(s)`,
                body: newOnes.map(m => m.device_name).join(", ")
              });
            }
          }
        }
        lastSeenMediaIdRef.current = latestId;
      }

      setMedia(mediaItems);
      setLastRefresh(new Date());
    } catch (e: any) {
      const errStr = typeof e === 'string' ? e : String(e);
      if (errStr.includes("AUTH_EXPIRED") || errStr.includes("401")) {
        handleLogout();
        setError("Session expired. Please sign in again.");
      } else {
        console.error("Fetch error:", e);
      }
    } finally {
      setLoading(false);
    }
  }, [handleLogout]);

  useEffect(() => {
    async function init() {
      try {
        // Request notification permission in background
        isPermissionGranted().then(granted => {
          if (!granted) requestPermission();
        });

        const authed = await invoke<boolean>("check_auth");
        if (authed) {
          const port = await invoke<number>("get_server_port");
          setServerPort(port);
          await fetchData();
          setStep("dashboard");
        }
      } catch (e) {
        console.error("Persistence error:", e);
      }
    }
    init();
  }, [fetchData]);

  useEffect(() => {
    if (step !== "dashboard") return;
    const interval = setInterval(() => {
      fetchData();
    }, 60000);
    return () => clearInterval(interval);
  }, [step, fetchData]);

  const toggleArm = useCallback(async (networkId: number, currentlyArmed: boolean) => {
    try {
      await invoke("set_network_arm", { networkId, arm: !currentlyArmed });
      fetchData();
    } catch (e: any) {
      console.error(e);
    }
  }, [fetchData]);

  const handleLiveView = useCallback(async (camera: Camera, isRestart = false) => {
    const networkId = camera.network_id || networks[0]?.id;
    if (!networkId || !serverPort) return;
    
    const url = `http://localhost:${serverPort}/live/${networkId}/${camera.id}/${camera.product_type}?serial=${camera.serial || ""}&record=${recording}`;
    
    setPlayingItems(prev => {
      const next = new Map(prev);
      if (camera.product_type === 'media') {
         next.clear();
      } else if (!isRestart && next.size >= 4 && !next.has(camera.id)) {
         const firstKey = next.keys().next().value;
         if (firstKey !== undefined) next.delete(firstKey);
      }
      
      next.set(camera.id, {
        id: camera.id,
        type: 'camera',
        url,
        camera
      });
      return next;
    });
  }, [networks, serverPort, recording]);

  const handleStop = useCallback((id?: number) => {
    setPlayingItems(prev => {
      if (id === undefined) {
        setTheaterMode(false);
        return new Map();
      }
      const next = new Map(prev);
      next.delete(id);
      if (next.size === 0) setTheaterMode(false);
      return next;
    });
  }, []);

  const handleToggleRecording = useCallback(() => {
    const nextRecording = !recording;
    setRecording(nextRecording);
    
    setPlayingItems(prev => {
      const next = new Map(prev);
      for (const [id, item] of Array.from(next.entries())) {
        if (item.type === 'camera' && item.camera) {
          const camera = item.camera;
          const networkId = camera.network_id || networks[0]?.id;
          if (networkId && serverPort) {
            const url = `http://localhost:${serverPort}/live/${networkId}/${camera.id}/${camera.product_type}?serial=${camera.serial || ""}&record=${nextRecording}`;
            next.set(id, { ...item, url });
          }
        }
      }
      return next;
    });
  }, [recording, networks, serverPort]);

  const handlePlayMedia = useCallback(async (item: Media) => {
    if (!serverPort) return;
    const url = `http://localhost:${serverPort}/proxy?url=${encodeURIComponent(item.media)}`;
    setPlayingItems(new Map([[item.id, {
      id: item.id,
      type: 'media',
      url
    }]]));
  }, [serverPort]);

  useEffect(() => {
    if (step !== "dashboard") return;
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      
      switch (e.key.toLowerCase()) {
        case 'r': fetchData(); break;
        case 'escape':
          if (theaterMode) setTheaterMode(false);
          else handleStop();
          break;
        case ' ':
          e.preventDefault();
          if (networks.length > 0) toggleArm(networks[0].id, networks[0].armed);
          break;
        default: {
          const num = parseInt(e.key);
          if (num >= 1 && num <= 9 && num <= cameras.length) {
            handleLiveView(cameras[num - 1]);
          }
        }
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [step, fetchData, theaterMode, networks, cameras, toggleArm, handleStop, handleLiveView]);

  const handleTabChange = (tab: string) => {
    setActiveTab(tab);
    if (tab === "clips") {
      setNewClipCount(0);
    }
  };

  async function handleLogin() {
    setLoading(true);
    setError("");
    try {
      const result = await invoke<string>("login", { email, password });
      if (result === "2FA_REQUIRED") {
        setStep("pin");
      } else {
        const port = await invoke<number>("get_server_port");
        setServerPort(port);
        await fetchData();
        setStep("dashboard");
      }
    } catch (e: any) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }

  async function handleVerifyPin() {
    setLoading(true);
    setError("");
    try {
      await invoke("verify_pin", { pin });
      const port = await invoke<number>("get_server_port");
      setServerPort(port);
      await fetchData();
      setStep("dashboard");
    } catch (e: any) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }

  async function handleDebug() {
    try {
      const home = await invoke<string>("get_raw_homescreen");
      const media = await invoke<string>("get_raw_media");
      const logs = await invoke<string[]>("get_ffmpeg_logs");
      setDebugData(JSON.stringify({ 
        home: JSON.parse(home), 
        media: JSON.parse(media),
        ffmpeg_logs: logs 
      }, null, 2));
    } catch (e) {
      setDebugData("Debug Error: " + e);
    }
  }

  const playingItem = playingItems.size > 0 ? Array.from(playingItems.values())[playingItems.size - 1] : null;

  if (step === "login") {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-[#0a0a0c] text-white p-4">
        <div className="absolute inset-0 bg-gradient-to-tr from-blue-500/10 via-transparent to-purple-500/10" />
        <Card className="w-full max-w-[380px] border-slate-800/50 bg-slate-900/40 backdrop-blur-2xl text-white relative z-10 shadow-2xl animate-in fade-in zoom-in duration-500">
          <CardHeader className="text-center pb-2">
            <div className="mx-auto bg-blue-600 w-12 h-12 rounded-xl flex items-center justify-center mb-4 shadow-lg shadow-blue-500/20">
              <CameraIcon className="w-6 h-6 text-white" />
            </div>
            <CardTitle className="text-2xl font-bold tracking-tight">Blink Monitor</CardTitle>
            <CardDescription className="text-slate-400">Sign in to your account</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Input
                type="email"
                placeholder="Email Address"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="border-slate-800 bg-slate-950/40 text-white h-11"
              />
            </div>
            <div className="space-y-1.5">
              <Input
                type="password"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="border-slate-800 bg-slate-950/40 text-white h-11"
              />
            </div>
            {error && (
              <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20">
                <p className="text-xs text-red-400 font-medium leading-relaxed">{error}</p>
              </div>
            )}
            <button 
              type="button"
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold h-11 transition-all shadow-lg shadow-blue-600/20 rounded-md disabled:opacity-50" 
              onClick={handleLogin}
              disabled={loading}
            >
              {loading ? "Authenticating..." : "Sign In"}
            </button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (step === "pin") {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-[#0a0a0c] text-white p-4">
        <div className="absolute inset-0 bg-gradient-to-tr from-blue-500/10 via-transparent to-purple-500/10" />
        <Card className="w-full max-w-[380px] border-slate-800/50 bg-slate-900/40 backdrop-blur-2xl text-white relative z-10 shadow-2xl">
          <CardHeader className="text-center">
            <CardTitle className="text-xl font-bold">Two-Factor Auth</CardTitle>
            <CardDescription className="text-slate-400">Check your email for the 6-digit PIN</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <Input
              type="text"
              placeholder="0 0 0 0 0 0"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              className="border-slate-800 bg-slate-950/40 text-white text-center text-3xl h-14 font-mono tracking-[0.5em] focus:ring-blue-600"
              maxLength={6}
            />
            {error && (
              <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20">
                <p className="text-xs text-red-400 font-medium leading-relaxed text-center">{error}</p>
              </div>
            )}
            <button 
              type="button"
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold h-11 transition-all rounded-md disabled:opacity-50" 
              onClick={handleVerifyPin}
              disabled={loading}
            >
              {loading ? "Verifying..." : "Confirm PIN"}
            </button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="h-screen w-screen bg-[#0a0a0c] text-white overflow-hidden flex font-sans">
      <Sidebar 
        activeTab={activeTab} 
        onTabChange={handleTabChange} 
        onLogout={handleLogout}
        badges={{ clips: newClipCount }}
      />

      <main className="flex-1 flex flex-col min-w-0 bg-[#0a0a0c]">
        <header className="h-16 border-b border-slate-800/40 flex items-center justify-between px-6 bg-slate-900/10 backdrop-blur-2xl sticky top-0 z-10">
          <h2 className="text-lg font-semibold text-white capitalize">{activeTab}</h2>
          
          <div className="flex items-center gap-3">
            {playingItems.size > 0 && (
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={() => handleStop()}
                className="text-red-400 hover:text-red-300 mr-2 uppercase text-[10px] font-bold tracking-widest"
              >
                Stop All ({playingItems.size})
              </Button>
            )}
            <div className="flex gap-2 mr-4">
              {networks.map(n => (
                <Button 
                  key={n.id} 
                  variant="outline"
                  size="sm"
                  className={cn(
                    "transition-all px-4 py-2 text-[11px] font-black uppercase tracking-widest h-9 rounded-full border-2",
                    n.armed 
                      ? "bg-green-500/10 text-green-500 border-green-500/20 hover:bg-green-500/20 hover:border-green-500/30" 
                      : "bg-red-500/10 text-red-500 border-red-500/20 hover:bg-red-500/20 hover:border-red-500/30"
                  )}
                  onClick={() => toggleArm(n.id, n.armed)}
                >
                  {n.armed ? (
                    <>
                      <Shield className="w-3.5 h-3.5 mr-2 fill-current" />
                      <span className="opacity-70 mr-1.5">{n.name}:</span>
                      <span>Armed</span>
                    </>
                  ) : (
                    <>
                      <ShieldOff className="w-3.5 h-3.5 mr-2 fill-current" />
                      <span className="opacity-70 mr-1.5">{n.name}:</span>
                      <span>Disarmed</span>
                    </>
                  )}
                </Button>
              ))}
            </div>
            <div className="text-[10px] text-slate-500 font-bold uppercase mr-2 tabular-nums">
              Refreshed {Math.round((new Date().getTime() - lastRefresh.getTime()) / 1000)}s ago
            </div>
            <Button variant="ghost" size="icon" onClick={fetchData} className="text-slate-400 hover:text-white hover:bg-slate-800/50 rounded-lg w-9 h-9" disabled={loading}>
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </Button>
          </div>
        </header>

        <div className="flex-1 overflow-auto p-6 sm:p-8 scroll-smooth">
          {activeTab === "cameras" && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-[1600px] mx-auto">
              {cameras.map((camera) => (
                <CameraCard 
                  key={camera.id} 
                  camera={camera} 
                  onLiveView={handleLiveView} 
                  serverPort={serverPort}
                  isPlaying={playingItems.has(camera.id) && playingItems.get(camera.id)?.type === 'camera'}
                  playUrl={playingItems.get(camera.id)?.url}
                  onStop={() => handleStop(camera.id)}
                  recording={recording}
                  onToggleRecording={handleToggleRecording}
                  onTheaterMode={() => {
                    setTheaterMode(true);
                    if (!playingItems.has(camera.id)) {
                      handleLiveView(camera);
                    }
                  }}
                />
              ))}
              {cameras.length === 0 && !loading && (
                <div className="col-span-full flex flex-col items-center justify-center h-64 text-slate-600">
                  <CameraIcon className="w-10 h-10 opacity-20 mb-4" />
                  <p className="text-sm font-medium">No cameras detected</p>
                </div>
              )}
            </div>
          )}

          {activeTab === "clips" && (
            <TimelineView 
              media={media}
              onPlay={handlePlayMedia}
              serverPort={serverPort}
              playingItem={playingItem}
              onStop={() => handleStop()}
            />
          )}
        </div>
      </main>

      {theaterMode && playingItem?.type === 'camera' && (
        <div className="fixed inset-0 z-[100] bg-black animate-in fade-in duration-300">
           <div className="absolute top-6 right-6 z-[110] flex gap-3">
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={handleToggleRecording}
                className={`bg-black/40 backdrop-blur-md border border-white/10 font-bold uppercase tracking-tighter ${recording ? 'text-red-500' : 'text-slate-400'}`}
              >
                <Circle className={`w-3 h-3 mr-2 ${recording ? 'fill-current animate-pulse' : 'fill-slate-800'}`} />
                REC
              </Button>
              <Button 
                variant="ghost" 
                size="icon" 
                onClick={() => handleStop()} 
                className="bg-black/40 backdrop-blur-md border border-white/10 text-white hover:bg-red-600 rounded-full w-10 h-10"
              >
                <X className="w-5 h-5" />
              </Button>
           </div>
           <div className="w-full h-full flex items-center justify-center">
              <MpegtsPlayer url={playingItem.url} />
           </div>
           <div className="absolute bottom-10 left-10 z-[110]">
              <h1 className="text-2xl font-bold text-white shadow-lg">{playingItem.camera?.name}</h1>
              <p className="text-slate-400 font-medium">Live Stream</p>
           </div>
        </div>
      )}
    </div>
  );
}

export default App;
