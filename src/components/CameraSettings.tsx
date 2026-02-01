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
      const payload = productType === "owl" || productType === "mini" ? config : { camera: config };
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
      <DialogContent className="bg-slate-900 border-slate-800 text-white max-w-md">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold">Camera Settings</DialogTitle>
          <DialogDescription className="text-slate-400">
            Configure {cameraName}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="py-12 flex flex-col items-center justify-center">
            <RefreshCw className="w-8 h-8 text-blue-500 animate-spin mb-4" />
            <p className="text-sm text-slate-400">Loading configuration...</p>
          </div>
        ) : error ? (
          <div className="py-8 text-center">
            <p className="text-red-400 text-sm mb-4">Error: {error}</p>
            <Button onClick={fetchConfig} variant="outline" className="border-slate-700 hover:bg-slate-800">
              Try Again
            </Button>
          </div>
        ) : config ? (
          <div className="space-y-6 py-4">
            {/* Motion Sensitivity */}
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <label htmlFor="sensitivity" className="text-sm font-bold uppercase tracking-wider text-slate-300">Motion Sensitivity</label>
                <span className="text-blue-400 font-bold">{config.motion_sensitivity}</span>
              </div>
              <input 
                id="sensitivity"
                type="range" 
                min="1" 
                max="9" 
                step="1"
                value={config.motion_sensitivity || 5}
                onChange={(e) => setConfig({ ...config, motion_sensitivity: parseInt(e.target.value) })}
                className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-blue-500"
              />
              <div className="flex justify-between text-[10px] text-slate-500 font-bold uppercase">
                <span>Low</span>
                <span>High</span>
              </div>
            </div>

            {/* Video Quality */}
            <div className="space-y-2">
              <label htmlFor="quality" className="text-sm font-bold uppercase tracking-wider text-slate-300">Video Quality</label>
              <select 
                id="quality"
                value={config.video_quality || 2}
                onChange={(e) => setConfig({ ...config, video_quality: parseInt(e.target.value) })}
                className="w-full bg-slate-800 border border-slate-700 rounded-md p-2 text-sm focus:ring-2 focus:ring-blue-600 outline-none"
              >
                <option value={1}>Saver (Low)</option>
                <option value={2}>Balanced (Medium)</option>
                <option value={3}>Best (High)</option>
              </select>
            </div>

            {/* Night Vision */}
            <div className="space-y-2">
              <label htmlFor="nightvision" className="text-sm font-bold uppercase tracking-wider text-slate-300">Night Vision Mode</label>
              <select 
                id="nightvision"
                value={config.night_vision_mode || "auto"}
                onChange={(e) => setConfig({ ...config, night_vision_mode: e.target.value })}
                className="w-full bg-slate-800 border border-slate-700 rounded-md p-2 text-sm focus:ring-2 focus:ring-blue-600 outline-none"
              >
                <option value="off">Off</option>
                <option value="on">On</option>
                <option value="auto">Auto</option>
              </select>
            </div>

            {/* Clip Length */}
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <label htmlFor="cliplen" className="text-sm font-bold uppercase tracking-wider text-slate-300">Clip Length</label>
                <span className="text-blue-400 font-bold">{config.video_length || 10}s</span>
              </div>
              <input 
                id="cliplen"
                type="range" 
                min="5" 
                max="60" 
                step="1"
                value={config.video_length || 10}
                onChange={(e) => setConfig({ ...config, video_length: parseInt(e.target.value) })}
                className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-blue-500"
              />
            </div>

            {/* Invert Video */}
            <div className="flex items-center justify-between p-3 bg-slate-800/50 rounded-lg border border-slate-800">
               <label htmlFor="invert" className="text-sm font-bold uppercase tracking-wider text-slate-300">Invert Video</label>
               <input 
                 id="invert"
                 type="checkbox"
                 checked={config.flip_video || false}
                 onChange={(e) => setConfig({ ...config, flip_video: e.target.checked })}
                 className="w-5 h-5 accent-blue-500"
               />
            </div>
          </div>
        ) : null}

        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={onClose} disabled={saving} className="text-slate-400 hover:text-white">
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={loading || saving} className="bg-blue-600 hover:bg-blue-700 min-w-[100px]">
            {saving ? <RefreshCw className="w-4 h-4 animate-spin mr-2" /> : <Save className="w-4 h-4 mr-2" />}
            Save Changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

