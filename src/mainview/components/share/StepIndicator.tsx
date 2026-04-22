import { motion } from "framer-motion";

export const StepIndicator = ({ current }: { current: 1 | 2 | 3 }) => {
  const steps = [
    { num: 1, label: "content" },
    { num: 2, label: "device" },
    { num: 3, label: "send" },
  ];

  return (
    <div className="flex items-center justify-center gap-2">
      {steps.map((s, i) => (
        <div key={s.num} className="flex items-center gap-2">
          <div className="flex items-center gap-1.5">
            <div
              className={`h-1.5 w-1.5 rounded-full transition-colors duration-300 ${
                current >= s.num ? "bg-foreground" : "bg-border"
              }`}
            />
            <span
              className={`font-mono text-[10px] uppercase tracking-widest transition-colors duration-300 ${
                current >= s.num
                  ? "text-foreground"
                  : "text-muted-foreground/50"
              }`}
            >
              {s.label}
            </span>
          </div>
          {i < steps.length - 1 && (
            <div
              className={`h-px w-8 transition-colors duration-300 ${
                current > s.num ? "bg-foreground" : "bg-border"
              }`}
            />
          )}
        </div>
      ))}
    </div>
  );
};
