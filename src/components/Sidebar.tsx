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
    <aside className="w-20 md:w-64 bg-[var(--sidebar)] border-r border-white/5 flex flex-col shrink-0 transition-all">
      <div className="h-16 flex items-center px-4 md:px-5 border-b border-white/5">
         <div className="bg-[var(--app-accent)]/15 border border-[var(--app-accent)]/30 p-2 rounded-lg mr-0 md:mr-3">
           <Camera className="w-5 h-5 text-[var(--app-accent)]" />
         </div>
         <span className="font-semibold text-white tracking-tight hidden md:inline">Blink Monitor</span>
      </div>
      
      <nav className="flex-1 p-3 md:p-4 space-y-2">
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => onTabChange(item.id)}
            title={item.label}
            className={cn(
              "w-full flex items-center justify-center md:justify-start gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all relative",
              activeTab === item.id 
                ? "bg-[var(--app-surface-2)] text-white border border-white/10 before:content-[''] before:absolute before:left-1 before:top-2 before:bottom-2 before:w-1 before:rounded-full before:bg-[var(--app-accent)]" 
                : "text-slate-400 hover:text-white hover:bg-[var(--app-surface-2)]"
            )}
          >
            <item.icon className="w-5 h-5" />
            <span className="flex-1 text-left hidden md:inline">{item.label}</span>
            {badges?.[item.id] ? (
              <Badge variant="destructive" className="h-5 min-w-5 px-1.5 items-center justify-center text-[10px] font-bold hidden md:inline-flex">
                {badges[item.id]}
              </Badge>
            ) : null}
          </button>
        ))}
      </nav>

      <div className="p-3 md:p-4 border-t border-white/5">
        <button 
          type="button"
          onClick={onLogout}
          title="Sign Out"
          className="w-full flex items-center justify-center md:justify-start gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-slate-400 hover:text-red-400 hover:bg-[var(--app-surface-2)] transition-colors"
        >
          <LogOut className="w-5 h-5" />
          <span className="hidden md:inline">Sign Out</span>
        </button>
      </div>
    </aside>
  );
}
