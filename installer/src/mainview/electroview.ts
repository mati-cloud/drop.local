import { Electroview } from "electrobun/view";

const statusListeners = new Set<(e: StatusEvent) => void>();

export const electroview = new Electroview({
  rpc: Electroview.defineRPC({
    handlers: {
      requests: {},
      messages: {
        onStatus: (payload: StatusEvent) => {
          for (const cb of statusListeners) cb(payload);
        },
        // oxlint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
    },
  }),
});

export function onStatus(cb: (e: StatusEvent) => void): () => void {
  statusListeners.add(cb);
  return () => statusListeners.delete(cb);
}

export interface StatusEvent {
  type:
    | "detecting"
    | "fetching-release"
    | "asset-found"
    | "downloading"
    | "extracting"
    | "installing"
    | "launching"
    | "benchmarking"
    | "done"
    | "error";
  platform?: string;
  arch?: string;
  version?: string;
  assetName?: string;
  size?: number;
  progress?: number;
  downloaded?: number;
  total?: number;
  message?: string;
  diskReadMBps?: number;
}
