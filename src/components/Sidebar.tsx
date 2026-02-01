import { Camera, Film, LogOut } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "./ui/badge";

interface SidebarProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
  onLogout: () => void;
  badges?: Record<string, number>;
}

export function Sidebar({ activeTab, onTabChange, onLogout, badges }: SidebarProps) {
  const items = [
    { id: "cameras", label: "Cameras", icon: Camera },
    { id: "clips", label: "Activity", icon: Film },
  ];

  return (
    <aside className="w-64 bg-slate-900 border-r border-slate-800 flex flex-col shrink-0">
      <div className="h-16 flex items-center px-6 border-b border-slate-800">
         <div className="bg-blue-600 p-1.5 rounded-lg mr-3 shadow-lg shadow-blue-600/20">
           <Camera className="w-5 h-5 text-white" />
         </div>
         <span className="font-bold text-white tracking-tight">Blink Monitor</span>
      </div>
      
      <nav className="flex-1 p-4 space-y-2">
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => onTabChange(item.id)}
            className={cn(
              "w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-all",
              activeTab === item.id 
                ? "bg-blue-600 text-white shadow-lg shadow-blue-600/10" 
                : "text-slate-400 hover:text-white hover:bg-slate-800"
            )}
          >
            <item.icon className="w-5 h-5" />
            <span className="flex-1 text-left">{item.label}</span>
            {badges?.[item.id] ? (
              <Badge variant="destructive" className="h-5 min-w-5 px-1.5 flex items-center justify-center text-[10px] font-bold">
                {badges[item.id]}
              </Badge>
            ) : null}
          </button>
        ))}
      </nav>

      <div className="p-4 border-t border-slate-800">
        <button 
          type="button"
          onClick={onLogout}
          className="w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium text-slate-400 hover:text-red-400 hover:bg-slate-800/50 transition-colors"
        >
          <LogOut className="w-5 h-5" />
          Sign Out
        </button>
      </div>
    </aside>
  );
}
