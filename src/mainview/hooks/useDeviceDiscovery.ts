import { useState, useEffect } from "react";
import type { Device } from "../lib/types";
import { electroview, onDeviceEvent } from "../electroview";

interface DiscoveredDevice {
  id: string;
  name: string;
  type: "laptop" | "phone" | "tablet" | "desktop";
  ip: string;
  port: number;
  lastSeen: number;
}

export function useDeviceDiscovery() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [hasPermission, setHasPermission] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const initDiscovery = async () => {
      try {
        console.log("✓ Initializing fully event-driven device discovery...");
        
        // Check if we're in Electrobun environment
        if (electroview && electroview.rpc && electroview.rpc.request) {
          console.log("✓ Electrobun RPC found!");
          
          // Listen for device events FIRST
          const unsubscribe = onDeviceEvent((event) => {
            console.log("📡 Device event:", event.type, event.device.name);
            
            setDevices((prevDevices) => {
              switch (event.type) {
                case "device-joined":
                  // Check if device already exists (avoid duplicates)
                  if (prevDevices.some((d) => d.id === event.device.id)) {
                    return prevDevices;
                  }
                  
                  // Add new device
                  return [
                    ...prevDevices,
                    {
                      id: event.device.id,
                      name: event.device.name,
                      type: event.device.type,
                      ip: event.device.ip,
                      isActive: true,
                      lastSeen: event.device.lastSeen,
                    },
                  ];
                
                case "device-left":
                  // Remove device
                  return prevDevices.filter((d) => d.id !== event.device.id);
                
                case "device-updated":
                  // Update device lastSeen
                  return prevDevices.map((d) =>
                    d.id === event.device.id
                      ? { ...d, lastSeen: event.device.lastSeen, isActive: true }
                      : d
                  );
                
                default:
                  return prevDevices;
              }
            });
          });

          // Subscribe to device events - backend will push initial devices
          await electroview.rpc.request.subscribeToDeviceEvents();
          console.log("✓ Subscribed - waiting for device events...");
          
          setIsLoading(false);

          // Return cleanup function
          return unsubscribe;
        } else {
          // Not in Electrobun - no devices available
          console.log("⟳ Not in Electrobun environment, no devices available");
          setDevices([]);
          setIsLoading(false);
        }
      } catch (err) {
        console.error("✗ Error initializing device discovery:", err);
        setError("Failed to initialize device discovery");
        setIsLoading(false);
      }
    };

    const cleanup = initDiscovery();

    return () => {
      // Cleanup event listener
      if (cleanup instanceof Promise) {
        cleanup.then((unsubscribe) => {
          if (unsubscribe) unsubscribe();
        });
      }
    };
  }, []);

  return {
    devices,
    isLoading,
    hasPermission,
    error,
  };
}
