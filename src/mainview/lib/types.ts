export type DeviceType = "laptop" | "phone" | "tablet" | "desktop";

export interface Device {
  id: string;
  name: string;
  type: DeviceType;
  ip: string;
  isActive?: boolean;
  lastSeen?: number;
  version?: string;
  versionMismatch?: boolean;
}

export type SharedContentType = "file" | "text" | "image";

export interface SharedContent {
  type: SharedContentType;
  name: string;
  size?: number;
  preview?: string;
  data?: File | string;
}

export type SharedContentCollection = SharedContent[];
