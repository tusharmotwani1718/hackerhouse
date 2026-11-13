import Link from "next/link";
import type { CSSProperties } from "react";

import { Button } from "@hacker-house/ui/components/button";

import { Logo } from "@/components/brand/logo";

import { FeatureCard, type FeatureCardProps } from "./feature-card";

// PLACEHOLDER content: the real copy for the four cards comes later.
const FEATURES: FeatureCardProps[] = [
  {
    eyebrow: "Race-proof",
    title: "Team joins",
    value: "0",
    note: "double-booked seats",
    visual: "bars",
  },
  {
    eyebrow: "Live",
    title: "Team board",
    value: "<1s",
    note: "to see every change",
    visual: "arc",
  },
  {
    eyebrow: "Smart",
    title: "Teammate picks",
    value: "12",
    note: "skills weighed",
    trend: true,
    visual: "ticks",
  },
  {
    eyebrow: "Fair",
    title: "Join requests",
    value: "100%",
    note: "decided in order",
    visual: "wave",
  },
];

// The glow behind the lower half of the hero, built from the theme's greens so it follows the
// tokens (and dark mode). Faded out towards the top by the mask.
const glow: CSSProperties = {
  background: [
    "radial-gradient(70% 55% at 0% 100%, color-mix(in oklch, var(--primary) 70%, transparent), transparent 70%)",
    "radial-gradient(55% 50% at 100% 78%, color-mix(in oklch, var(--chart-4) 80%, transparent), transparent 70%)",
    "radial-gradient(90% 60% at 50% 72%, color-mix(in oklch, var(--chart-5) 65%, transparent), transparent 80%)",
    "radial-gradient(60% 40% at 50% 100%, color-mix(in oklch, var(--chart-3) 70%, transparent), transparent 80%)",
  ].join(", "),
  maskImage: "linear-gradient(to bottom, transparent 18%, black 62%)",
};

// Dotted backdrop of the card tray.
const dotGrid: CSSProperties = {
  backgroundImage:
    "radial-gradient(color-mix(in oklch, var(--foreground) 14%, transparent) 1px, transparent 1.3px)",
  backgroundSize: "14px 14px",
};

// The bright strip along the bottom edge of the frame.
const bottomStrip: CSSProperties = {
  background:
    "linear-gradient(90deg, var(--chart-4), var(--primary), var(--chart-2), var(--chart-3), var(--chart-5))",
};

/** Landing page hero: header, headline, description, CTA and the feature tray. */
export function Hero() {
  return (
    <section className="">
      <div className="relative isolate mx-auto overflow-hidden bg-card ring-1 ring-border/70">
        <div aria-hidden className="absolute inset-0 -z-10" style={glow} />

        <header className="flex items-center justify-between px-5 py-5 sm:px-10">
          <Logo />
          <nav className="flex items-center gap-2">
            <Button
              variant="outline"
              nativeButton={false}
              render={<Link href="/sign-in" />}
              className="h-9 rounded-full bg-card px-4 shadow-sm ring-1 ring-border"
            >
              Sign in
            </Button>
            <Button
              nativeButton={false}
              render={<Link href="/sign-up" />}
              className="hidden h-9 rounded-full bg-foreground px-4 text-background hover:bg-foreground/85 sm:inline-flex"
            >
              Get started
            </Button>
          </nav>
        </header>

        <div className="px-6 pt-16 pb-12 text-center sm:pt-24 sm:pb-14">
          <h1 className="mx-auto max-w-5xl text-[2.6rem] leading-[1.04] font-normal opacity-85 tracking-tighter text-balance sm:text-6xl lg:text-7xl">
            Find your next hackathon team in minutes
          </h1>
          <p className="mx-auto mt-6 max-w-3xl text-base text-balance text-muted-foreground sm:text-lg">
            HackerHouse is a resilient and reliable team formation engine for hackathons. It is race
            proof, fast and modern way of participating and building teams for your hackathon.
          </p>
          <div className="mt-9 flex justify-center">
            <Button
              nativeButton={false}
              render={<Link href="/sign-up" />}
              className="h-11 rounded-full px-6 text-[0.95rem] shadow-[0_12px_32px_-10px_var(--primary)] ring-1 ring-white/30 ring-inset hover:bg-primary/90"
            >
              Get started
            </Button>
          </div>
        </div>

        <div className="px-3 pb-10 sm:px-10 lg:px-14">
          <div className="rounded-[1.75rem] bg-white/40 p-2.5 ring-1 ring-white/60 backdrop-blur-md sm:p-3 dark:bg-white/5 dark:ring-white/10">
            <div
              className="grid gap-3 rounded-[1.4rem] bg-muted/80 p-3 sm:grid-cols-2 sm:p-6 lg:grid-cols-4 lg:gap-4"
              style={dotGrid}
            >
              {FEATURES.map((feature) => (
                <FeatureCard key={feature.title} {...feature} />
              ))}
            </div>
          </div>
        </div>

        <div aria-hidden className="absolute inset-x-0 bottom-0 h-1.5" style={bottomStrip} />
      </div>
    </section>
  );
}
