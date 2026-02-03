import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { RefreshCw, Save } from "lucide-react";

interface CameraSettingsProps {
  isOpen: boolean;
  onClose: () => void;
  networkId: number;
  cameraId: number;
  productType: string;
  cameraName: string;
}

export function CameraSettings({ isOpen, onClose, networkId, cameraId, productType, cameraName }: CameraSettingsProps) {
  const [config, setConfig] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchConfig = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await invoke<any>("get_camera_config", { networkId, cameraId, productType });
      setConfig(res.camera || res);
    } catch (e: any) {
      setError(e.toString());
    } finally {
      setLoading(false);
    }
  }, [networkId, cameraId, productType]);

  useEffect(() => {
    if (isOpen) {
      fetchConfig();
    }
  }, [isOpen, fetchConfig]);

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const payload = productType === "owl" || productType === "mini" || productType === "tulip" || productType === "doorbell"
        ? config
        : { camera: config };
      await invoke("update_camera_config", { networkId, cameraId, productType, config: payload });
      onClose();
    } catch (e: any) {
      setError(e.toString());
    } finally {
      setSaving(false);
    }
  }

  if (!isOpen) return null;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="bg-[var(--app-surface-2)] border-white/10 text-white max-w-md rounded-2xl shadow-2xl">
        <DialogHeader>
          <DialogTitle className="text-xl font-semibold">Camera Settings</DialogTitle>
          <DialogDescription className="text-slate-400">
            Configure {cameraName}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="py-12 flex flex-col items-center justify-center">
            <RefreshCw className="w-8 h-8 text-[var(--app-accent)] animate-spin mb-4" />
            <p className="text-sm text-slate-400">Loading configuration...</p>
          </div>
        ) : error ? (
          <div className="py-8 text-center">
            <p className="text-red-400 text-sm mb-4">Error: {error}</p>
            <Button onClick={fetchConfig} variant="outline" className="border-white/15 hover:bg-[var(--app-surface-3)]">
              Try Again
            </Button>
          </div>
        ) : config ? (
          <div className="space-y-5 py-4">
            {/* Motion Sensitivity */}
            <div className="space-y-3 rounded-xl border border-white/10 bg-[var(--app-surface-3)] p-4">
              <div className="flex justify-between items-center">
                <label htmlFor="sensitivity" className="text-sm font-medium text-slate-200">Motion Sensitivity</label>
                <span className="text-xs font-semibold text-[var(--app-accent)]">{config.motion_sensitivity}</span>
              </div>
              <input 
                id="sensitivity"
                type="range" 
                min="1" 
                max="9" 
                step="1"
                value={config.motion_sensitivity || 5}
                onChange={(e) => setConfig({ ...config, motion_sensitivity: parseInt(e.target.value) })}
                className="w-full h-1.5 bg-[var(--app-surface-2)] rounded-lg appearance-none cursor-pointer accent-[var(--app-accent)]"
              />
              <div className="flex justify-between text-[11px] text-slate-500">
                <span>Low</span>
                <span>High</span>
              </div>
            </div>

            {/* Video Quality */}
            <div className="space-y-2 rounded-xl border border-white/10 bg-[var(--app-surface-3)] p-4">
              <label htmlFor="quality" className="text-sm font-medium text-slate-200">Video Quality</label>
              <select 
                id="quality"
                value={config.video_quality || 2}
                onChange={(e) => setConfig({ ...config, video_quality: parseInt(e.target.value) })}
                className="w-full rounded-lg border border-white/10 bg-[var(--app-surface-2)] px-3 py-2 text-sm text-slate-100 focus:border-[var(--app-accent)] focus:ring-2 focus:ring-[var(--app-accent-soft)] outline-none"
              >
                <option value={1}>Saver (Low)</option>
                <option value={2}>Balanced (Medium)</option>
                <option value={3}>Best (High)</option>
              </select>
            </div>

            {/* Night Vision */}
            <div className="space-y-2 rounded-xl border border-white/10 bg-[var(--app-surface-3)] p-4">
              <label htmlFor="nightvision" className="text-sm font-medium text-slate-200">Night Vision Mode</label>
              <select 
                id="nightvision"
                value={config.night_vision_mode || "auto"}
                onChange={(e) => setConfig({ ...config, night_vision_mode: e.target.value })}
                className="w-full rounded-lg border border-white/10 bg-[var(--app-surface-2)] px-3 py-2 text-sm text-slate-100 focus:border-[var(--app-accent)] focus:ring-2 focus:ring-[var(--app-accent-soft)] outline-none"
              >
                <option value="off">Off</option>
                <option value="on">On</option>
                <option value="auto">Auto</option>
              </select>
            </div>

            {/* Clip Length */}
            <div className="space-y-3 rounded-xl border border-white/10 bg-[var(--app-surface-3)] p-4">
              <div className="flex justify-between items-center">
                <label htmlFor="cliplen" className="text-sm font-medium text-slate-200">Clip Length</label>
                <span className="text-xs font-semibold text-[var(--app-accent)]">{config.video_length || 10}s</span>
              </div>
              <input 
                id="cliplen"
                type="range" 
                min="5" 
                max="60" 
                step="1"
                value={config.video_length || 10}
                onChange={(e) => setConfig({ ...config, video_length: parseInt(e.target.value) })}
                className="w-full h-1.5 bg-[var(--app-surface-2)] rounded-lg appearance-none cursor-pointer accent-[var(--app-accent)]"
              />
            </div>

            {/* Invert Video */}
            <div className="flex items-center justify-between p-4 bg-[var(--app-surface-3)] rounded-xl border border-white/10">
               <label htmlFor="invert" className="text-sm font-medium text-slate-200">Invert Video</label>
               <input 
                 id="invert"
                 type="checkbox"
                 checked={config.flip_video || false}
                 onChange={(e) => setConfig({ ...config, flip_video: e.target.checked })}
                 className="h-4 w-4 accent-[var(--app-accent)]"
               />
            </div>

          </div>
        ) : null}

        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={onClose} disabled={saving} className="text-slate-400 hover:text-white hover:bg-[var(--app-surface-3)]">
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={loading || saving} className="bg-[var(--app-accent)] hover:bg-[var(--app-accent-strong)] min-w-[120px]">
            {saving ? <RefreshCw className="w-4 h-4 animate-spin mr-2" /> : <Save className="w-4 h-4 mr-2" />}
            Save Changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
