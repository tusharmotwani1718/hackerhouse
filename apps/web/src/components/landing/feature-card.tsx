import { ArrowUp } from "lucide-react";

import { FeatureVisual, type FeatureVisualKind } from "./feature-visuals";

export type FeatureCardProps = {
  /** First, muted line of the label (e.g. "Race-proof"). */
  eyebrow: string;
  /** Second, strong line of the label (e.g. "Team joins"). */
  title: string;
  /** The big figure. */
  value: string;
  /** Small note next to the figure. */
  note: string;
  /** Show an up arrow before the note. */
  trend?: boolean;
  visual: FeatureVisualKind;
};

/** One card of the hero's feature tray. */
export function FeatureCard({ eyebrow, title, value, note, trend, visual }: FeatureCardProps) {
  return (
    <article className="flex min-h-56 flex-col rounded-2xl bg-card p-5 shadow-sm ring-1 ring-border/60 sm:p-6">
      <h3 className="text-[1.05rem] leading-snug">
        <span className="block text-muted-foreground">{eyebrow}</span>
        <span className="block font-medium text-card-foreground">{title}</span>
      </h3>
      <p className="mt-6 flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <span className="text-4xl font-semibold tracking-tight tabular-nums">{value}</span>
        <span className="inline-flex items-center gap-1 text-xs font-medium text-primary">
          {trend && <ArrowUp className="size-3" aria-hidden />}
          {note}
        </span>
      </p>
      <div className="mt-auto pt-6" aria-hidden>
        <FeatureVisual kind={visual} />
      </div>
    </article>
  );
}
