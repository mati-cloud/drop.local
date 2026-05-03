import { useState, useCallback, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { DropZone } from "@/components/share/DropZone";
import { DeviceSelector } from "@/components/share/DeviceSelector";
import { TransferStatus } from "@/components/share/TransferStatus";
import { StepIndicator } from "@/components/share/StepIndicator";
import { ThemeToggle } from "@/components/share/ThemeToggle";
import { ConnectedDevices } from "@/components/share/ConnectedDevices";
import { MessageToast } from "../components/share/MessageToast";
import { useDeviceDiscovery } from "../hooks/useDeviceDiscovery";
import { useFileTransfer } from "../hooks/useFileTransfer-tcp";
import { electroview, onUpdateReady, restartToUpdate } from "../electroview";
import type { Device, SharedContent, SharedContentCollection } from "@/lib/types";

export type { Device, SharedContent, SharedContentCollection };

const Index = () => {
  const { devices, isLoading, hasPermission, error } = useDeviceDiscovery();
  const { sendFiles, isTransferring, transfers, receivedMessages, clearMessage } =
    useFileTransfer();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [contents, setContents] = useState<SharedContent[]>([]);
  const [selectedDevices, setSelectedDevices] = useState<Device[]>([]);
  const [localName, setLocalName] = useState<string | null>(null);
  const [updateVersion, setUpdateVersion] = useState<string | null>(null);

  useEffect(() => {
    return onUpdateReady((version) => setUpdateVersion(version || "new version"));
  }, []);

  useEffect(() => {
    if (electroview?.rpc?.request) {
      // oxlint-disable-next-line @typescript-eslint/no-explicit-any
      (electroview.rpc as any).request
        .getLocalDeviceName()
        .then((name: string) => setLocalName(name))
        .catch(() => {});
    }
  }, []);

  const handleContent = useCallback((c: SharedContent) => {
    setContents((prev) => [...prev, c]);
    setStep(2);
  }, []);

  const handleRemoveContent = useCallback((index: number) => {
    setContents((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleDeviceSelect = useCallback((d: Device) => {
    // Only allow selection of active devices
    if (!d.isActive) return;

    setSelectedDevices((prev) => {
      const isAlreadySelected = prev.some((device) => device.id === d.id);
      if (isAlreadySelected) {
        return prev.filter((device) => device.id !== d.id);
      }
      return [...prev, d];
    });
  }, []);

  // Derive active selection — drop devices that went offline
  const activeSelectedDevices = selectedDevices.filter((selected) => {
    const device = devices.find((d) => d.id === selected.id);
    return device?.isActive ?? false;
  });

  const handleProceedToSend = useCallback(() => {
    if (activeSelectedDevices.length > 0) {
      setStep(3);
      // Start the actual file transfer
      void sendFiles(contents, activeSelectedDevices);
    }
  }, [activeSelectedDevices, contents, sendFiles]);

  const handleReset = useCallback(() => {
    setContents([]);
    setSelectedDevices([]);
    setStep(1);
  }, []);

  const handleBackToContent = useCallback(() => {
    setStep(1);
  }, []);

  const handleBackToDeviceSelection = useCallback(() => {
    setStep(2);
  }, []);

  const handleAddFiles = useCallback(() => {
    setStep(1);
  }, []);

  const handleUndo = useCallback(() => {
    setStep(2);
  }, []);

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center bg-background px-4">
      {/* Theme toggle - top right */}
      <div className="absolute right-4 top-4">
        <ThemeToggle />
      </div>
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="w-full max-w-xl"
      >
        {/* Header */}
        <div className="mb-10 text-center">
          <h1 className="font-heading text-2xl font-semibold tracking-tight text-foreground">
            drop
            <span className="text-muted-foreground">.</span>
            local
          </h1>
          <p className="mt-1 font-mono text-xs text-muted-foreground tracking-wide">
            {localName ? (
              <>
                <span className="text-foreground">{localName}</span>
                <span className="mx-1 opacity-40">·</span>
              </>
            ) : null}
            share across your devices
          </p>
        </div>

        <StepIndicator current={step} />

        <div className="mt-8">
          <AnimatePresence mode="wait">
            {step === 1 && (
              <motion.div
                key="drop"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                transition={{ duration: 0.3 }}
              >
                <DropZone onContent={handleContent} />
              </motion.div>
            )}
            {step === 2 && contents.length > 0 && (
              <motion.div
                key="device"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                transition={{ duration: 0.3 }}
              >
                <DeviceSelector
                  devices={devices}
                  contents={contents}
                  selectedDevices={selectedDevices}
                  onSelect={handleDeviceSelect}
                  onBack={handleBackToContent}
                  onRemoveContent={handleRemoveContent}
                  onAddFiles={handleAddFiles}
                  onProceed={handleProceedToSend}
                />
              </motion.div>
            )}
            {step === 3 && contents.length > 0 && activeSelectedDevices.length > 0 && (
              <motion.div
                key="transfer"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                transition={{ duration: 0.3 }}
              >
                <TransferStatus
                  contents={contents}
                  devices={selectedDevices}
                  onReset={handleReset}
                  transfers={transfers}
                  isTransferring={isTransferring}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Permission/Loading/Error states */}
        {!hasPermission && !isLoading && (
          <div className="mt-8 text-center">
            <p className="text-sm text-muted-foreground">
              {error || "Network permission required to discover devices"}
            </p>
          </div>
        )}

        {/* Connected devices visualization - only show on step 1 */}
        {step === 1 && !isLoading && <ConnectedDevices devices={devices} />}

        {/* Loading state */}
        {isLoading && (
          <div className="mt-8 text-center">
            <p className="text-sm text-muted-foreground animate-pulse">
              Discovering devices on your network...
            </p>
          </div>
        )}
      </motion.div>

      {/* Message notifications */}
      <MessageToast messages={receivedMessages} onDismiss={clearMessage} />

      {/* Update ready bar */}
      <AnimatePresence>
        {updateVersion && (
          <motion.div
            key="update-bar"
            initial={{ y: 64, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 64, opacity: 0 }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            className="fixed bottom-0 left-0 right-0 z-50 flex items-center justify-between gap-4 border-t border-border bg-background/95 px-5 py-3 backdrop-blur-sm"
          >
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
              <span className="font-mono text-xs text-muted-foreground">
                update ready
                <span className="mx-1 opacity-40">·</span>
                <span className="text-foreground">{updateVersion}</span>
              </span>
            </div>
            <button
              onClick={restartToUpdate}
              className="rounded-md bg-foreground px-3 py-1 font-mono text-xs text-background transition-opacity hover:opacity-80"
            >
              restart
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default Index;
