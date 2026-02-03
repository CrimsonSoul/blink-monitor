import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { isPermissionGranted, requestPermission, sendNotification } from '@tauri-apps/plugin-notification';
import { resolveResource } from "@tauri-apps/api/path";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Camera as CameraIcon, RefreshCw, X, Circle, ChevronDown } from "lucide-react";
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
  const [dashboardNotice, setDashboardNotice] = useState<string | null>(null);
  const [serverPort, setServerPort] = useState<number | null>(null);
  const [playingItems, setPlayingItems] = useState<Map<number, { id: number, type: 'camera' | 'media', url: string, camera?: Camera }>>(new Map());
  const [recording, setRecording] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  const [newClipCount, setNewClipCount] = useState(0);
  const [theaterMode, setTheaterMode] = useState(false);
  const [notificationIconPath, setNotificationIconPath] = useState<string | null>(null);
  const [mediaPage, setMediaPage] = useState(1);
  const [mediaHasMore, setMediaHasMore] = useState(true);
  const [loadingMoreClips, setLoadingMoreClips] = useState(false);
  const [refreshIntervalMs, setRefreshIntervalMs] = useState(() => {
    const saved = localStorage.getItem("blink_refresh_ms");
    const parsed = saved ? Number(saved) : 60000;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 60000;
  });
  const [favoriteIds, setFavoriteIds] = useState<Set<number>>(() => {
    const raw = localStorage.getItem("blink_favorites");
    if (!raw) return new Set();
    try {
      return new Set<number>(JSON.parse(raw));
    } catch {
      return new Set();
    }
  });
  const [thumbCache, setThumbCache] = useState<Map<string, string>>(() => {
    const raw = localStorage.getItem("blink_thumb_cache_v1");
    if (!raw) return new Map();
    try {
      const parsed = JSON.parse(raw) as Array<[string, string]>;
      return new Map(parsed);
    } catch {
      return new Map();
    }
  });
  const safeSetItem = useCallback((key: string, value: string) => {
    try {
      localStorage.setItem(key, value);
    } catch (e) {
      console.warn("localStorage set failed:", key, e);
    }
  }, []);
  const pruneThumbStorage = useCallback((next: Map<string, string>) => {
    try {
      const prefix = "blink_thumb_";
      const allowed = new Set(next.keys());
      for (let i = localStorage.length - 1; i >= 0; i -= 1) {
        const key = localStorage.key(i);
        if (!key || !key.startsWith(prefix)) continue;
        const path = key.slice(prefix.length);
        if (!allowed.has(path)) {
          localStorage.removeItem(key);
        }
      }
    } catch (e) {
      console.warn("Thumb cache prune failed:", e);
    }
  }, []);
  const [mediaThumbCache, setMediaThumbCache] = useState<Map<string, string>>(() => {
    const raw = localStorage.getItem("blink_media_thumb_cache_v1");
    if (!raw) return new Map();
    try {
      const parsed = JSON.parse(raw) as Array<[string, string]>;
      return new Map(parsed);
    } catch {
      return new Map();
    }
  });
  const [selectMode, setSelectMode] = useState(false);
  const [selectedMediaIds, setSelectedMediaIds] = useState<Set<number>>(new Set());
  const [deletingSelected, setDeletingSelected] = useState(false);
  const [hiddenMediaIds, setHiddenMediaIds] = useState<Map<number, number>>(new Map());
  const hiddenMediaTtlMs = 2 * 60 * 1000;

  const lastSeenMediaIdRef = useRef<number>(0);
  const sessionTokenRef = useRef(0);
  const fetchInFlightRef = useRef(false);
  const fetchQueuedRef = useRef(false);

  const handleLogout = useCallback(async () => {
    sessionTokenRef.current += 1;
    fetchQueuedRef.current = false;
    fetchInFlightRef.current = false;
    setLoadingMoreClips(false);
    setMediaPage(1);
    setMediaHasMore(true);
    try {
      await invoke("logout");
      setCameras([]);
      setNetworks([]);
      setMedia([]);
      setServerPort(null);
      setMediaThumbCache(new Map());
      setSelectedMediaIds(new Set());
      setSelectMode(false);
      setStep("login");
      setTheaterMode(false);
      setPlayingItems(new Map());
    } catch (e) {
      console.error("Logout failed:", e);
    }
  }, []);

  const pickThumbnail = useCallback((item: any) => {
    if (typeof item.thumbnail === "string" && item.thumbnail) return item.thumbnail;
    const directKeys = ["thumbnail_url", "thumb", "thumb_url", "thumbnail_path", "thumbnail_media", "thumbnail_image", "thumbnail_uri", "thumb_path"];
    for (const key of directKeys) {
      const val = item[key];
      if (typeof val === "string" && val) return val;
    }
    if (item.thumbnail && typeof item.thumbnail === "object") {
      for (const [k, v] of Object.entries(item.thumbnail)) {
        if (typeof v === "string" && (k.toLowerCase().includes("thumb") || k.toLowerCase().includes("url") || k.toLowerCase().includes("path")) && v) {
          return v;
        }
      }
    }
    if (item.media && typeof item.media === "object") {
      for (const [k, v] of Object.entries(item.media)) {
        if (typeof v === "string" && k.toLowerCase().includes("thumb") && v) return v;
      }
    }
    for (const [k, v] of Object.entries(item)) {
      if (typeof v === "string" && k.toLowerCase().includes("thumb") && v) return v;
    }
    return "";
  }, []);

  const pickMediaUrl = useCallback((item: any) => {
    const directKeys = ["media", "media_url", "url", "clip", "clip_url", "video", "video_url"];
    for (const key of directKeys) {
      const val = item[key];
      if (typeof val === "string" && val) return val;
    }
    if (item.media && typeof item.media === "object") {
      for (const [k, v] of Object.entries(item.media)) {
        if (typeof v === "string" && (k.toLowerCase().includes("media") || k.toLowerCase().includes("video") || k.toLowerCase().includes("clip")) && v) return v;
      }
    }
    if (item.media && typeof item.media === "object" && item.media.url && typeof item.media.url === "string") {
      return item.media.url;
    }
    if (item.media && typeof item.media === "object" && item.media.media && typeof item.media.media === "string") {
      return item.media.media;
    }
    if (item.media && typeof item.media === "object") {
      for (const [k, v] of Object.entries(item.media)) {
        if (typeof v === "string" && (k.toLowerCase().includes("media") || k.toLowerCase().includes("video") || k.toLowerCase().includes("clip")) && v) return v;
      }
    }
    return "";
  }, []);

  const normalizeMediaItems = useCallback((parsedMedia: any): Media[] => {
    const mapped: Media[] = (parsedMedia.media || [])
      .filter((item: any) => !item?.deleted)
      .map((item: any) => ({
        ...item,
        thumbnail_url: pickThumbnail(item),
        media_url: pickMediaUrl(item)
      }));
    return mapped.sort((a, b) => {
      const at = Date.parse(a.created_at);
      const bt = Date.parse(b.created_at);
      if (Number.isFinite(at) && Number.isFinite(bt) && at !== bt) {
        return bt - at;
      }
      if (Number.isFinite(at) && !Number.isFinite(bt)) return -1;
      if (!Number.isFinite(at) && Number.isFinite(bt)) return 1;
      const aid = typeof a.id === "number" ? a.id : 0;
      const bid = typeof b.id === "number" ? b.id : 0;
      return bid - aid;
    });
  }, [pickMediaUrl, pickThumbnail]);

  const fetchMediaPage = useCallback(async (page: number) => {
    const rawMedia = await invoke<string>("get_raw_media_page", { page, sinceDays: 30 });
    const parsedMedia = JSON.parse(rawMedia);
    return normalizeMediaItems(parsedMedia);
  }, [normalizeMediaItems]);

  const fetchData = useCallback(async () => {
    if (fetchInFlightRef.current) {
      fetchQueuedRef.current = true;
      return;
    }
    fetchInFlightRef.current = true;
    setLoading(true);
    const sessionToken = sessionTokenRef.current;
    try {
      const rawHome = await invoke<string>("get_raw_homescreen");
      if (sessionTokenRef.current !== sessionToken) return;
      const parsedHome = JSON.parse(rawHome);
      
      const nets = parsedHome.networks || [];
      const cams = [
        ...(parsedHome.cameras || []).map((c: any) => ({ ...c, product_type: c.type || "camera", serial: c.serial })),
        ...(parsedHome.owls || []).map((c: any) => ({ ...c, product_type: c.type || "owl", serial: c.serial })),
        ...(parsedHome.doorbells || []).map((c: any) => ({ ...c, product_type: c.type || "doorbell", serial: c.serial }))
      ];
      
      setNetworks(nets);
      setCameras(cams);

      const page1Items = await fetchMediaPage(1);
      if (sessionTokenRef.current !== sessionToken) return;
      setMediaHasMore(page1Items.length > 0);
      const rawMediaItems = page1Items;
      const now = Date.now();
      let prunedHidden = hiddenMediaIds;
      let hiddenChanged = false;
      for (const [id, ts] of hiddenMediaIds) {
        if (now - ts > hiddenMediaTtlMs) {
          if (!hiddenChanged) prunedHidden = new Map(hiddenMediaIds);
          hiddenChanged = true;
          prunedHidden.delete(id);
        }
      }
      if (hiddenChanged) setHiddenMediaIds(prunedHidden);
      const mediaItems = rawMediaItems.filter(item => !prunedHidden.has(item.id));
      
      if (mediaItems.length > 0) {
        const latestId = mediaItems[0].id;
        if (lastSeenMediaIdRef.current > 0 && latestId > lastSeenMediaIdRef.current) {
          const newOnes = mediaItems.filter(m => m.id > lastSeenMediaIdRef.current);
          if (newOnes.length > 0) {
            setNewClipCount(prev => prev + newOnes.length);
            
            const hasPermission = await isPermissionGranted();
            if (hasPermission) {
              const payload = {
                title: `${newOnes.length} new motion event(s)`,
                body: newOnes.map(m => m.device_name).join(", ")
              };
              sendNotification(notificationIconPath ? { ...payload, icon: notificationIconPath } : payload);
            }
          }
        }
        lastSeenMediaIdRef.current = latestId;
      }

      setMedia((prev) => {
        const byId = new Map<number, Media>();
        for (const item of rawMediaItems) {
          byId.set(item.id, item);
        }
        for (const item of prev) {
          if (!byId.has(item.id)) {
            byId.set(item.id, item);
          }
        }
        const merged = Array.from(byId.values()).sort((a, b) => {
          const at = Date.parse(a.created_at);
          const bt = Date.parse(b.created_at);
          if (Number.isFinite(at) && Number.isFinite(bt) && at !== bt) {
            return bt - at;
          }
          if (Number.isFinite(at) && !Number.isFinite(bt)) return -1;
          if (!Number.isFinite(at) && Number.isFinite(bt)) return 1;
          const aid = typeof a.id === "number" ? a.id : 0;
          const bid = typeof b.id === "number" ? b.id : 0;
          return bid - aid;
        });
        return merged.filter(item => !prunedHidden.has(item.id));
      });
      if (import.meta.env.DEV && mediaItems.length > 0) {
        console.log("Blink media sample", mediaItems[0]);
      }
      setLastRefresh(new Date());
    } catch (e: any) {
      const errStr = typeof e === 'string' ? e : String(e);
      if (errStr.includes("AUTH_EXPIRED") || errStr.includes("401") || errStr.toLowerCase().includes("refresh token")) {
        handleLogout();
        setError("Session expired. Please sign in again.");
      } else {
        console.error("Fetch error:", e);
      }
    } finally {
      setLoading(false);
      fetchInFlightRef.current = false;
      if (fetchQueuedRef.current) {
        fetchQueuedRef.current = false;
        fetchData();
      }
    }
  }, [fetchMediaPage, handleLogout, hiddenMediaIds, notificationIconPath]);

  const getServerPortWithRetry = useCallback(async () => {
    const maxAttempts = 10;
    let attempt = 0;
    let delayMs = 150;

    while (attempt < maxAttempts) {
      try {
        const port = await invoke<number>("get_server_port");
        return port;
      } catch (e) {
        attempt += 1;
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        delayMs = Math.min(delayMs * 2, 1200);
      }
    }
    throw new Error("Server not ready");
  }, []);

  useEffect(() => {
    async function init() {
      try {
        // Request notification permission in background
        isPermissionGranted().then(granted => {
          if (!granted) requestPermission();
        });

        const authed = await invoke<boolean>("check_auth");
        if (authed) {
          const port = await getServerPortWithRetry();
          setServerPort(port);
          await fetchData();
          setStep("dashboard");
        }
      } catch (e) {
        console.error("Persistence error:", e);
      }
    }
    init();
  }, [fetchData, getServerPortWithRetry]);

  useEffect(() => {
    resolveResource("icons/icon.png")
      .then(setNotificationIconPath)
      .catch(() => setNotificationIconPath(null));
    if (import.meta.env.DEV) {
      console.info("Notification icons are cached by the OS; restart the app to see icon updates.");
    }
  }, []);

  useEffect(() => {
    if (step !== "dashboard") return;
    const interval = setInterval(() => {
      fetchData();
    }, refreshIntervalMs);
    return () => clearInterval(interval);
  }, [step, fetchData, refreshIntervalMs]);

  const handleLoadMoreClips = useCallback(async () => {
    if (loadingMoreClips || !mediaHasMore) return;
    const nextPage = mediaPage + 1;
    const sessionToken = sessionTokenRef.current;
    setLoadingMoreClips(true);
    try {
      const nextItems = await fetchMediaPage(nextPage);
      if (sessionTokenRef.current !== sessionToken) return;
      if (nextItems.length === 0) {
        setMediaHasMore(false);
        return;
      }
      setMediaPage(nextPage);
      setMedia((prev) => {
        const byId = new Map<number, Media>();
        for (const item of prev) byId.set(item.id, item);
        for (const item of nextItems) {
          byId.set(item.id, item);
        }
        const merged = Array.from(byId.values()).sort((a, b) => {
          const at = Date.parse(a.created_at);
          const bt = Date.parse(b.created_at);
          if (Number.isFinite(at) && Number.isFinite(bt) && at !== bt) {
            return bt - at;
          }
          if (Number.isFinite(at) && !Number.isFinite(bt)) return -1;
          if (!Number.isFinite(at) && Number.isFinite(bt)) return 1;
          const aid = typeof a.id === "number" ? a.id : 0;
          const bid = typeof b.id === "number" ? b.id : 0;
          return bid - aid;
        });
        return merged.filter(item => !hiddenMediaIds.has(item.id));
      });
    } finally {
      setLoadingMoreClips(false);
    }
  }, [fetchMediaPage, hiddenMediaIds, loadingMoreClips, mediaHasMore, mediaPage]);

  const toggleArm = useCallback(async (networkId: number, currentlyArmed: boolean) => {
    try {
      await invoke("set_network_arm", { networkId, arm: !currentlyArmed });
      fetchData();
    } catch (e: any) {
      console.error(e);
    }
  }, [fetchData]);

  const handleLiveView = useCallback(async (camera: Camera, isRestart = false) => {
    const networkId = (camera.network_id ?? (networks.length === 1 ? networks[0]?.id : undefined)) || undefined;
    if (!networkId || !serverPort) {
      if (!networkId) {
        setDashboardNotice("Live view unavailable: missing network mapping for this camera.");
        window.setTimeout(() => setDashboardNotice(null), 4000);
      }
      return;
    }
    
    const nonce = isRestart ? `&ts=${Date.now()}` : "";
    const url = `http://localhost:${serverPort}/live/${networkId}/${camera.id}/${camera.product_type}?serial=${camera.serial || ""}&record=${recording}${nonce}`;
    
    setPlayingItems(prev => {
      const next = new Map(prev);
      if (next.has(camera.id)) next.delete(camera.id);
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
    const mediaUrl = item.media_url || (typeof item.media === "string" ? item.media : "");
    if (!mediaUrl) return;
    const url = `http://localhost:${serverPort}/proxy?url=${encodeURIComponent(mediaUrl)}`;
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
    } else {
      setSelectMode(false);
      setSelectedMediaIds(new Set());
    }
  };

  const toggleSelectMode = useCallback(() => {
    setSelectMode(prev => {
      const next = !prev;
      if (!next) setSelectedMediaIds(new Set());
      return next;
    });
  }, []);

  const toggleSelectMedia = useCallback((id: number) => {
    setSelectedMediaIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectAllMedia = useCallback(() => {
    setSelectedMediaIds(new Set(media.map(m => m.id)));
  }, [media]);

  const clearSelectedMedia = useCallback(() => {
    setSelectedMediaIds(new Set());
  }, []);

  const deleteSelectedMedia = useCallback(async () => {
    if (selectedMediaIds.size === 0) return;
    setDeletingSelected(true);
    try {
      const selectedItems = media.filter(item => selectedMediaIds.has(item.id));
      const remaining = await invoke<number[]>("delete_media_items", { items: selectedItems });
      const selectedIds = Array.from(selectedMediaIds);
      const remainingSet = new Set(remaining);
      const deletedIds = selectedIds.filter(id => !remainingSet.has(id));
      if (deletedIds.length > 0) {
        const now = Date.now();
        setHiddenMediaIds(prev => {
          const next = new Map(prev);
          for (const id of deletedIds) {
            next.set(id, now);
          }
          return next;
        });
        setMedia(prev => prev.filter(item => !deletedIds.includes(item.id)));
      }
      if (remaining.length > 0) {
        setSelectedMediaIds(new Set(remaining));
        setSelectMode(true);
      } else {
        setSelectedMediaIds(new Set());
        setSelectMode(false);
      }
      await fetchData();
    } catch (e) {
      console.error("Delete failed:", e);
    } finally {
      setDeletingSelected(false);
    }
  }, [selectedMediaIds, fetchData]);


  const toggleFavorite = useCallback((cameraId: number) => {
    setFavoriteIds(prev => {
      const next = new Set(prev);
      if (next.has(cameraId)) next.delete(cameraId);
      else next.add(cameraId);
      try {
        localStorage.setItem("blink_favorites", JSON.stringify(Array.from(next)));
      } catch {}
      return next;
    });
  }, []);

  const sortedCameras = useMemo(() => {
    const items = [...cameras];
    items.sort((a, b) => {
      const aFav = favoriteIds.has(a.id) ? 1 : 0;
      const bFav = favoriteIds.has(b.id) ? 1 : 0;
      if (aFav !== bFav) return bFav - aFav;
      return a.name.localeCompare(b.name);
    });
    return items;
  }, [cameras, favoriteIds]);

  useEffect(() => {
    safeSetItem("blink_refresh_ms", String(refreshIntervalMs));
  }, [refreshIntervalMs]);

  useEffect(() => {
    const validIds = new Set(media.map(m => m.id));
    setSelectedMediaIds(prev => {
      const next = new Set<number>();
      for (const id of prev) {
        if (validIds.has(id)) next.add(id);
      }
      return next;
    });
  }, [media]);


  useEffect(() => {
    let cancelled = false;
    async function fillThumbCache() {
      if (!serverPort) return;
      for (const cam of cameras) {
        if (!cam.thumbnail) continue;
        if (thumbCache.has(cam.thumbnail)) continue;
        try {
          const cached = localStorage.getItem(`blink_thumb_${cam.thumbnail}`);
          if (cached) {
            setThumbCache(prev => {
              if (prev.has(cam.thumbnail)) return prev;
              const next = new Map(prev);
              next.set(cam.thumbnail, cached);
              return next;
            });
            continue;
          }
          const dataUrl = await invoke<string>("get_thumbnail_base64", { path: cam.thumbnail });
          if (cancelled) return;
          setThumbCache(prev => {
            if (prev.has(cam.thumbnail)) return prev;
            const next = new Map(prev);
            next.set(cam.thumbnail, dataUrl);
            while (next.size > 50) {
              const firstKey = next.keys().next().value;
              if (firstKey !== undefined) next.delete(firstKey);
              else break;
            }
            safeSetItem("blink_thumb_cache_v1", JSON.stringify(Array.from(next.entries())));
            safeSetItem(`blink_thumb_${cam.thumbnail}`, dataUrl);
            pruneThumbStorage(next);
            return next;
          });
        } catch {
          // Best-effort cache fill only.
        }
      }
    }
    fillThumbCache();
    return () => {
      cancelled = true;
    };
  }, [cameras, serverPort, thumbCache, pruneThumbStorage, safeSetItem]);

  useEffect(() => {
    let cancelled = false;
    async function fillMediaThumbCache() {
      if (!serverPort) return;
      for (const item of media) {
        const thumbPath = item.thumbnail_url || (typeof item.thumbnail === "string" ? item.thumbnail : "");
        if (!thumbPath) continue;
        if (mediaThumbCache.has(thumbPath)) continue;
        try {
          const dataUrl = await invoke<string>("get_thumbnail_base64", { path: thumbPath });
          if (cancelled) return;
          setMediaThumbCache(prev => {
            if (prev.has(thumbPath)) return prev;
            const next = new Map(prev);
            next.set(thumbPath, dataUrl);
            while (next.size > 100) {
              const firstKey = next.keys().next().value;
              if (firstKey !== undefined) next.delete(firstKey);
              else break;
            }
            return next;
          });
        } catch {
          // Best-effort cache fill only.
        }
      }
    }
    fillMediaThumbCache();
    return () => {
      cancelled = true;
    };
  }, [media, serverPort, mediaThumbCache]);

  async function handleLogin() {
    setLoading(true);
    setError("");
    try {
      const result = await invoke<string>("login", { email, password });
      if (result === "2FA_REQUIRED") {
        setStep("pin");
      } else {
        const port = await getServerPortWithRetry();
        setServerPort(port);
        await fetchData();
        setStep("dashboard");
      }
    } catch (e: any) {
      setError(typeof e === "string" ? e : e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  async function handleVerifyPin() {
    setLoading(true);
    setError("");
    try {
      await invoke("verify_pin", { pin });
      const port = await getServerPortWithRetry();
      setServerPort(port);
      await fetchData();
      setStep("dashboard");
    } catch (e: any) {
      setError(typeof e === "string" ? e : e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  const playingItem = playingItems.size > 0 ? Array.from(playingItems.values())[playingItems.size - 1] : null;

  if (step === "login") {
    return (
      <div className="app-shell flex h-screen w-screen items-center justify-center text-white p-6">
        <Card className="w-full max-w-[380px] border-white/10 bg-[var(--app-surface-2)] text-white relative z-10 shadow-2xl animate-in fade-in zoom-in duration-500">
          <CardHeader className="text-center pb-2">
            <div className="mx-auto bg-[var(--app-accent)]/15 border border-[var(--app-accent)]/30 w-12 h-12 rounded-2xl flex items-center justify-center mb-4">
              <CameraIcon className="w-6 h-6 text-[var(--app-accent)]" />
            </div>
            <CardTitle className="text-2xl font-semibold tracking-tight">Blink Monitor</CardTitle>
            <CardDescription className="text-slate-400">Sign in to your account</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Input
                type="email"
                placeholder="Email Address"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="h-11"
              />
            </div>
            <div className="space-y-1.5">
              <Input
                type="password"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="h-11"
              />
            </div>
            {error && (
              <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20">
                <p className="text-xs text-red-400 font-medium leading-relaxed">{error}</p>
              </div>
            )}
            <button 
              type="button"
              className="w-full bg-[var(--app-accent)] hover:bg-[var(--app-accent-strong)] text-white font-semibold h-11 transition-all rounded-lg disabled:opacity-50" 
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
      <div className="app-shell flex h-screen w-screen items-center justify-center text-white p-6">
        <Card className="w-full max-w-[380px] border-white/10 bg-[var(--app-surface-2)] text-white relative z-10 shadow-2xl">
          <CardHeader className="text-center">
            <CardTitle className="text-xl font-semibold">Two-Factor Auth</CardTitle>
            <CardDescription className="text-slate-400">Check your email for the 6-digit PIN</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <Input
              type="text"
              placeholder="0 0 0 0 0 0"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              className="text-center text-3xl h-14 font-mono tracking-[0.5em]"
              maxLength={6}
            />
            {error && (
              <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20">
                <p className="text-xs text-red-400 font-medium leading-relaxed text-center">{error}</p>
              </div>
            )}
            <button 
              type="button"
              className="w-full bg-[var(--app-accent)] hover:bg-[var(--app-accent-strong)] text-white font-semibold h-11 transition-all rounded-lg disabled:opacity-50" 
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
    <div className="app-shell h-screen w-screen text-white overflow-hidden flex">
      <Sidebar 
        activeTab={activeTab} 
        onTabChange={handleTabChange} 
        onLogout={handleLogout}
        badges={{ clips: newClipCount }}
      />

      <main className="flex-1 flex flex-col min-w-0">
        <header className="h-16 border-b border-white/5 flex items-center justify-between px-6 bg-[var(--app-surface)] sticky top-0 z-10 shadow-[0_10px_24px_rgba(0,0,0,0.22)]">
          <div>
            <h2 className="text-lg font-semibold text-white capitalize tracking-tight">{activeTab}</h2>
            <p className="text-xs text-slate-400">
              {activeTab === "clips" ? `${media.length} clips` : `${cameras.length} cameras`}
              {dashboardNotice ? (
                <span className="ml-2 text-[11px] text-red-400">{dashboardNotice}</span>
              ) : null}
            </p>
          </div>
          
          <div className="flex items-center gap-3">
            {playingItems.size > 0 && (
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={() => handleStop()}
                className="text-red-400 hover:text-red-300 hover:bg-[var(--app-surface-2)] border border-white/10 rounded-full px-4 h-9 mr-2 text-xs font-semibold"
              >
                Stop All ({playingItems.size})
              </Button>
            )}
            <div className="flex items-center gap-2">
              {networks.map(n => (
                <Button 
                  key={n.id} 
                  variant="outline"
                  size="sm"
                  className={cn(
                    "transition-all px-4 py-2 text-xs font-semibold h-9 rounded-full border border-white/10 bg-[var(--app-surface-2)] focus-visible:ring-0 focus-visible:outline-none",
                    n.armed 
                      ? "text-green-300 border-green-500/30 hover:bg-[var(--app-surface-3)]" 
                      : "text-red-300 border-red-500/30 hover:bg-[var(--app-surface-3)]"
                  )}
                  onClick={() => toggleArm(n.id, n.armed)}
                >
                  {n.armed ? (
                    <>
                      <span className="opacity-70">{n.name}:</span>
                      <span className="ml-1.5">Armed</span>
                    </>
                  ) : (
                    <>
                      <span className="opacity-70">{n.name}:</span>
                      <span className="ml-1.5">Disarmed</span>
                    </>
                  )}
                </Button>
              ))}
            </div>
            <div className="h-9 px-4 rounded-full border border-white/10 bg-[var(--app-surface-2)] text-[11px] text-slate-400 font-medium flex items-center tabular-nums">
              Refreshed {Math.round((new Date().getTime() - lastRefresh.getTime()) / 1000)}s ago
            </div>
            <div className="relative flex items-center rounded-full border border-white/10 bg-[var(--app-surface-2)] overflow-hidden focus-within:border-[var(--app-accent)]/50">
              <select
                value={refreshIntervalMs}
                onChange={(e) => setRefreshIntervalMs(Number(e.target.value))}
                className="appearance-none bg-transparent border-0 text-xs text-slate-200 rounded-full pl-4 pr-9 h-9 outline-none"
              >
                <option value={30000}>Refresh 30s</option>
                <option value={60000}>Refresh 1m</option>
                <option value={300000}>Refresh 5m</option>
              </select>
              <ChevronDown className="absolute right-12 w-3.5 h-3.5 text-slate-500 pointer-events-none" />
              <div className="h-6 w-px bg-white/10" />
              <Button
                variant="ghost"
                size="icon"
                onClick={fetchData}
                className="text-slate-300 hover:text-white hover:bg-[var(--app-surface-3)] rounded-full w-9 h-9 border-0"
                disabled={loading}
                title="Refresh now"
                aria-label="Refresh now"
              >
                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              </Button>
            </div>
          </div>
        </header>

        <div className="flex-1 overflow-auto p-6 sm:p-8 scroll-smooth">
          {activeTab === "cameras" && (
            <div className="grid grid-cols-[repeat(auto-fit,minmax(320px,1fr))] gap-6 animate-in fade-in slide-in-from-bottom-4 duration-500 w-full">
              {sortedCameras.map((camera) => {
                const isLive = playingItems.has(camera.id) && playingItems.get(camera.id)?.type === 'camera';
                const shouldSpan = isLive && playingItems.size === 1 && !theaterMode;
                return (
                  <div key={camera.id} className={cn(shouldSpan ? "md:col-span-2 lg:col-span-2" : "")}>
                    <CameraCard 
                      camera={camera} 
                      onLiveView={handleLiveView} 
                      serverPort={serverPort}
                      isPlaying={isLive}
                      playUrl={playingItems.get(camera.id)?.url}
                      suppressLivePlayback={theaterMode && playingItem?.type === 'camera' && playingItem.id === camera.id}
                      onStop={() => handleStop(camera.id)}
                      recording={recording}
                      onToggleRecording={handleToggleRecording}
                      isFavorite={favoriteIds.has(camera.id)}
                      onToggleFavorite={() => toggleFavorite(camera.id)}
                      thumbnailDataUrl={camera.thumbnail ? thumbCache.get(camera.thumbnail) : undefined}
                      onTheaterMode={() => {
                        setTheaterMode(true);
                        handleLiveView(camera, true);
                      }}
                    />
                  </div>
                );
              })}
              {cameras.length === 0 && !loading && (
                <div className="col-span-full flex flex-col items-center justify-center h-64 text-center">
                  <div className="w-12 h-12 rounded-full bg-[var(--app-accent)]/10 border border-[var(--app-accent)]/30 flex items-center justify-center text-[var(--app-accent)] mb-4">
                    <CameraIcon className="w-5 h-5" />
                  </div>
                  <p className="text-sm font-semibold text-white/90">No cameras detected</p>
                  <p className="text-xs text-slate-400 mt-1">Check your network or refresh to try again.</p>
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
              mediaThumbCache={mediaThumbCache}
              selectMode={selectMode}
              selectedIds={selectedMediaIds}
              onToggleSelect={toggleSelectMedia}
              onSelectAll={selectAllMedia}
              onClearSelection={clearSelectedMedia}
              onDeleteSelected={deleteSelectedMedia}
              deletingSelected={deletingSelected}
              onToggleSelectMode={toggleSelectMode}
              hasMore={mediaHasMore}
              onLoadMore={handleLoadMoreClips}
              loadingMore={loadingMoreClips}
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
                className={`bg-black/60 border border-white/10 text-xs font-semibold ${recording ? 'text-red-400' : 'text-slate-300'}`}
              >
                <Circle className={`w-3 h-3 mr-2 ${recording ? 'fill-current animate-pulse' : 'fill-slate-800'}`} />
                Record
              </Button>
              <Button 
                variant="ghost" 
                size="icon" 
                onClick={() => handleStop()} 
                className="bg-black/60 border border-white/10 text-white hover:bg-red-600 rounded-full w-10 h-10"
              >
                <X className="w-5 h-5" />
              </Button>
           </div>
           <div className="w-full h-full flex items-center justify-center">
              <MpegtsPlayer url={playingItem.url} />
           </div>
           <div className="absolute bottom-10 left-10 z-[110]">
              <h1 className="text-2xl font-semibold text-white shadow-lg">{playingItem.camera?.name}</h1>
              <p className="text-slate-400 text-sm font-medium">Live Stream</p>
           </div>
        </div>
      )}
    </div>
  );
}

export default App;
