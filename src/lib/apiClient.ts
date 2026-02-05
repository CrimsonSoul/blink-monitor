type DownloadProgressEvent = {
  id: string;
  received: number;
  total?: number;
};

type DownloadOptions = {
  url: string;
  defaultFileName: string;
  downloadId?: string;
  onProgress?: (pct: number) => void;
};

type NotificationPayload = {
  title: string;
  body?: string;
  icon?: string;
};

const target = (import.meta.env.VITE_TARGET ?? "").toLowerCase();
const apiBase = (import.meta.env.VITE_API_BASE ?? "/api").replace(/\/$/, "");
const isDesktop =
  typeof window !== "undefined" &&
  (window as any).__TAURI__ &&
  target !== "web";

async function apiFetchText(path: string, options: RequestInit = {}) {
  const headers: HeadersInit = {
    ...(options.body ? { "Content-Type": "application/json" } : {}),
    ...(options.headers ?? {})
  };
  const res = await fetch(`${apiBase}${path}`, { ...options, headers });
  if (!res.ok) {
    const message = await res.text();
    throw new Error(message || res.statusText);
  }
  return res.text();
}

async function apiFetchJson<T>(path: string, options: RequestInit = {}) {
  const headers: HeadersInit = {
    ...(options.body ? { "Content-Type": "application/json" } : {}),
    ...(options.headers ?? {})
  };
  const res = await fetch(`${apiBase}${path}`, { ...options, headers });
  if (!res.ok) {
    const message = await res.text();
    throw new Error(message || res.statusText);
  }
  return res.json() as Promise<T>;
}

async function tauriInvoke<T>(command: string, args?: Record<string, any>) {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(command, args);
}

async function tauriListen<T>(event: string, handler: (event: { payload: T }) => void) {
  const { listen } = await import("@tauri-apps/api/event");
  return listen<T>(event, handler);
}

const apiClient = {
  isDesktop,
  apiBase,
  buildMediaBaseUrl(serverPort?: number | null) {
    if (isDesktop) {
      if (!serverPort) return "";
      return `http://localhost:${serverPort}`;
    }
    return apiBase;
  },
  async getServerPort() {
    if (!isDesktop) return null;
    return tauriInvoke<number>("get_server_port");
  },
  async checkAuth() {
    if (isDesktop) return tauriInvoke<boolean>("check_auth");
    return apiFetchJson<boolean>("/check-auth");
  },
  async login(email: string, password: string) {
    if (isDesktop) return tauriInvoke<string>("login", { email, password });
    return apiFetchText("/login", { method: "POST", body: JSON.stringify({ email, password }) });
  },
  async verifyPin(pin: string) {
    if (isDesktop) return tauriInvoke<string>("verify_pin", { pin });
    return apiFetchText("/verify-pin", { method: "POST", body: JSON.stringify({ pin }) });
  },
  async logout() {
    if (isDesktop) return tauriInvoke<string>("logout");
    await apiFetchText("/logout", { method: "POST" });
  },
  async getRawHomescreen() {
    if (isDesktop) return tauriInvoke<string>("get_raw_homescreen");
    return apiFetchText("/homescreen");
  },
  async getRawMediaPage(page: number, sinceDays: number) {
    if (isDesktop) return tauriInvoke<string>("get_raw_media_page", { page, sinceDays });
    return apiFetchText(`/media?page=${page}&sinceDays=${sinceDays}`);
  },
  async setNetworkArm(networkId: number, arm: boolean) {
    if (isDesktop) return tauriInvoke<string>("set_network_arm", { networkId, arm });
    return apiFetchText("/set-arm", { method: "POST", body: JSON.stringify({ networkId, arm }) });
  },
  async deleteMediaItems(items: any[]) {
    if (isDesktop) return tauriInvoke<number[]>("delete_media_items", { items });
    return apiFetchJson<number[]>("/delete-media", { method: "POST", body: JSON.stringify({ items }) });
  },
  async getThumbnailBase64(path: string) {
    if (isDesktop) return tauriInvoke<string>("get_thumbnail_base64", { path });
    return apiFetchText(`/thumbnail-base64?path=${encodeURIComponent(path)}`);
  },
  async getCameraConfig(networkId: number, cameraId: number, productType: string) {
    if (isDesktop) return tauriInvoke<any>("get_camera_config", { networkId, cameraId, productType });
    return apiFetchJson<any>(`/camera-config?networkId=${networkId}&cameraId=${cameraId}&productType=${encodeURIComponent(productType)}`);
  },
  async updateCameraConfig(networkId: number, cameraId: number, productType: string, config: any) {
    if (isDesktop) return tauriInvoke<void>("update_camera_config", { networkId, cameraId, productType, config });
    await apiFetchText("/camera-config", { method: "POST", body: JSON.stringify({ networkId, cameraId, productType, config }) });
  },
  async resolveNotificationIcon() {
    if (isDesktop) {
      const { resolveResource } = await import("@tauri-apps/api/path");
      return resolveResource("icons/icon.png");
    }
    return null;
  },
  async isNotificationPermissionGranted() {
    if (isDesktop) {
      const { isPermissionGranted } = await import("@tauri-apps/plugin-notification");
      return isPermissionGranted();
    }
    if (typeof Notification === "undefined") return false;
    return Notification.permission === "granted";
  },
  async requestNotificationPermission() {
    if (isDesktop) {
      const { requestPermission } = await import("@tauri-apps/plugin-notification");
      return requestPermission();
    }
    if (typeof Notification === "undefined") return false;
    const result = await Notification.requestPermission();
    return result === "granted";
  },
  async sendNotification(payload: NotificationPayload) {
    if (isDesktop) {
      const { sendNotification } = await import("@tauri-apps/plugin-notification");
      sendNotification(payload);
      return;
    }
    if (typeof Notification === "undefined") return;
    if (Notification.permission !== "granted") return;
    new Notification(payload.title, { body: payload.body, icon: payload.icon });
  },
  async onDownloadProgress(handler: (event: DownloadProgressEvent) => void) {
    if (!isDesktop) {
      return () => {};
    }
    const unlisten = await tauriListen<DownloadProgressEvent>("download-progress", (event) => {
      handler(event.payload);
    });
    return () => {
      unlisten();
    };
  },
  async downloadClip(options: DownloadOptions): Promise<boolean> {
    const { url, defaultFileName, downloadId, onProgress } = options;
    if (isDesktop) {
      const { save } = await import("@tauri-apps/plugin-dialog");
      const path = await save({
        defaultPath: defaultFileName,
        filters: [{ name: "Video", extensions: ["mp4"] }]
      });
      if (!path) return false;
      const id = downloadId ?? (
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `download-${Date.now()}`
      );
      await tauriInvoke("download_clip_with_progress", { url, path, download_id: id });
      return true;
    }

    const res = await fetch(`${apiBase}/proxy?url=${encodeURIComponent(url)}`);
    if (!res.ok) {
      const message = await res.text();
      throw new Error(message || res.statusText);
    }

    const total = Number(res.headers.get("content-length") ?? 0) || undefined;
    if (res.body?.getReader) {
      const reader = res.body.getReader();
      const chunks: Uint8Array[] = [];
      let received = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          chunks.push(value);
          received += value.length;
          if (total && onProgress) {
            const pct = Math.min(100, Math.round((received / total) * 100));
            onProgress(pct);
          }
        }
      }
      const blob = new Blob(chunks, { type: res.headers.get("content-type") || "video/mp4" });
      const link = document.createElement("a");
      const objectUrl = URL.createObjectURL(blob);
      link.href = objectUrl;
      link.download = defaultFileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
      if (onProgress) onProgress(100);
      return true;
    }

    const blob = await res.blob();
    const link = document.createElement("a");
    const objectUrl = URL.createObjectURL(blob);
    link.href = objectUrl;
    link.download = defaultFileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    if (onProgress) onProgress(100);
    return true;
  }
};

export default apiClient;
