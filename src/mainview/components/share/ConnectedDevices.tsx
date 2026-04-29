import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Laptop, Smartphone, Tablet, Monitor, Wifi } from "lucide-react";
import type { Device } from "@/lib/types";

const DEVICE_ICONS = {
  laptop: Laptop,
  phone: Smartphone,
  tablet: Tablet,
  desktop: Monitor,
};

interface ConnectedDevicesProps {
  devices: Device[];
}

export const ConnectedDevices = ({ devices }: ConnectedDevicesProps) => {
  const [visible, setVisible] = useState<string[]>([]);

  const timerRefs = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    timerRefs.current.forEach(clearTimeout);
    timerRefs.current = [];
    // Schedule staggered visibility — setState inside async callback is fine
    const timers = devices.map((d, i) =>
      setTimeout(
        () => {
          setVisible((prev) => [...prev, d.id]);
        },
        300 + i * 150,
      ),
    );
    timerRefs.current = timers;
    return () => {
      timers.forEach(clearTimeout);
      setVisible([]);
    };
  }, [devices]);

  if (devices.length === 0) {
    return (
      <div className="mt-10">
        <div className="mb-3 flex items-center gap-2">
          <Wifi className="h-3 w-3 text-muted-foreground" strokeWidth={1.5} />
          <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            No devices discovered yet
          </span>
        </div>
        <div className="rounded-xl border border-dashed border-border bg-muted/20 px-4 py-8 text-center">
          <p className="text-sm text-muted-foreground">Searching for devices on your network...</p>
          <p className="mt-1 font-mono text-xs text-muted-foreground">
            Make sure Drop Local is running on other devices
          </p>
        </div>
      </div>
    );
  }

  const activeDevices = devices.filter((d) => d.isActive);
  const inactiveDevices = devices.filter((d) => !d.isActive);

  return (
    <div className="mt-10">
      <div className="mb-3 flex items-center gap-2">
        <Wifi className="h-3 w-3 text-muted-foreground" strokeWidth={1.5} />
        <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          {activeDevices.length} active {activeDevices.length === 1 ? "device" : "devices"} on
          network
        </span>
      </div>

      <div className="flex flex-wrap gap-3">
        {devices.map((device) => {
          const Icon = DEVICE_ICONS[device.type];
          const isVisible = visible.includes(device.id);
          const isActive = device.isActive ?? false;

          return (
            <motion.div
              key={device.id}
              initial={{ opacity: 0, scale: 0.8, y: 10 }}
              animate={
                isVisible ? { opacity: 1, scale: 1, y: 0 } : { opacity: 0, scale: 0.8, y: 10 }
              }
              transition={{ type: "spring", stiffness: 300, damping: 25 }}
              className={`group relative flex items-center gap-3 rounded-xl border px-4 py-3 transition-all ${
                isActive
                  ? "border-border bg-card hover:bg-accent"
                  : "border-border/50 bg-muted/30 opacity-60"
              }`}
            >
              <div className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-muted/50">
                <Icon
                  className={`h-5 w-5 transition-colors ${
                    isActive
                      ? "text-muted-foreground group-hover:text-foreground"
                      : "text-muted-foreground/50"
                  }`}
                  strokeWidth={1.5}
                />
                {/* Online/Offline indicator */}
                {isActive ? (
                  <span className="absolute -right-1 -top-1 flex h-2.5 w-2.5">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-foreground/30" />
                    <span className="relative inline-flex h-2.5 w-2.5 rounded-full border-2 border-background bg-foreground" />
                  </span>
                ) : (
                  <span className="absolute -right-1 -top-1 flex h-2.5 w-2.5">
                    <span className="relative inline-flex h-2.5 w-2.5 rounded-full border-2 border-background bg-muted-foreground/50" />
                  </span>
                )}
              </div>
              <div className="flex flex-col">
                <p
                  className={`text-sm font-medium ${isActive ? "text-foreground" : "text-muted-foreground"}`}
                >
                  {device.name}
                </p>
                <p className="font-mono text-xs text-muted-foreground">{device.ip}</p>
              </div>
              {!isActive && (
                <span className="ml-auto font-mono text-[10px] uppercase tracking-wider text-muted-foreground/70">
                  offline
                </span>
              )}
            </motion.div>
          );
        })}
      </div>
    </div>
  );
};
