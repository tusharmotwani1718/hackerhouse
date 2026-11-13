import { cn } from "@hacker-house/ui/lib/utils";

/**
 * Small decorative charts at the bottom of the hero's feature cards (purely visual, hidden from
 * screen readers). Deterministic shapes, so they render the same on the server every time.
 */
export type FeatureVisualKind = "bars" | "arc" | "ticks" | "wave";

export function FeatureVisual({ kind }: { kind: FeatureVisualKind }) {
  switch (kind) {
    case "bars":
      return <Bars />;
    case "arc":
      return <Arc />;
    case "ticks":
      return <Ticks />;
    case "wave":
      return <Wave />;
  }
}

/** A few blocks, one highlighted. */
function Bars() {
  const heights = [42, 100, 74, 46, 66];
  return (
    <div className="flex h-14 items-end gap-1">
      {heights.map((height, i) => (
        <div
          key={i}
          className={cn("flex-1 rounded-[2px]", i === 1 ? "bg-primary" : "bg-primary/15")}
          style={{ height: `${height}%` }}
        />
      ))}
    </div>
  );
}

/** Thin lines tracing a dome, fading towards both ends. */
function Arc() {
  const count = 64;
  return (
    <div className="flex h-14 items-end justify-center gap-[1.5px]">
      {Array.from({ length: count }, (_, i) => {
        const curve = Math.sin((Math.PI * (i + 0.5)) / count);
        return (
          <div
            key={i}
            className="w-[1.5px] rounded-full bg-chart-2"
            style={{ height: `${28 + 72 * curve}%`, opacity: 0.2 + 0.8 * curve }}
          />
        );
      })}
    </div>
  );
}

/** A row of short ticks ending in a highlighted run of tall ones. */
function Ticks() {
  const count = 42;
  const highlighted = 10;
  return (
    <div className="flex h-14 items-end justify-between">
      {Array.from({ length: count }, (_, i) => {
        const on = i >= count - highlighted;
        return (
          <div
            key={i}
            className={cn("w-[2px] rounded-full", on ? "bg-primary" : "bg-muted-foreground/30")}
            style={{ height: on ? "100%" : "45%" }}
          />
        );
      })}
    </div>
  );
}

/** A glowing wave whose swing grows towards the right. */
function Wave() {
  const width = 200;
  const height = 56;
  const points = Array.from({ length: 81 }, (_, i) => {
    const x = (i / 80) * width;
    const amplitude = 8 + 14 * (i / 80);
    const y = height / 2 + amplitude * Math.sin((i / 80) * Math.PI * 7);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-14 w-full overflow-visible" fill="none">
      <polyline
        points={points.join(" ")}
        stroke="var(--primary)"
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{
          filter: "drop-shadow(0 4px 6px color-mix(in oklch, var(--primary) 45%, transparent))",
        }}
      />
    </svg>
  );
}
