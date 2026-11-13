import Link from "next/link";

import { cn } from "@hacker-house/ui/lib/utils";

import { Logo } from "@/components/brand/logo";

import { AuthForm, type AuthMode } from "./auth-form";

const TABS: { mode: AuthMode; label: string; href: string }[] = [
  { mode: "sign-in", label: "Sign in", href: "/sign-in" },
  { mode: "sign-up", label: "Sign up", href: "/sign-up" },
];

/**
 * Right side of the auth page: heading, the Sign in / Sign up tabs (links between /sign-in and
 * /sign-up, so each tab has its own URL) and the form.
 */
export function AuthPanel({ mode }: { mode: AuthMode }) {
  const signUp = mode === "sign-up";
  return (
    <div className="w-full max-w-sm">
      <Logo className="mb-12 lg:hidden" />
      <h1 className="text-3xl font-semibold tracking-tight">Welcome to Hacker House</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        {signUp
          ? "Create an account to join hackathons and find your team."
          : "Sign in to find your team or manage the one you lead."}
      </p>

      <nav
        aria-label="Sign in or sign up"
        className="mt-8 grid grid-cols-2 rounded-lg bg-muted p-1"
      >
        {TABS.map((tab) => {
          const active = tab.mode === mode;
          return (
            <Link
              key={tab.mode}
              href={tab.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "rounded-md py-1.5 text-center text-sm font-medium transition-colors",
                active
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>

      {/* key: switching tabs starts a fresh form (no leftover error or pending state). */}
      <AuthForm key={mode} mode={mode} className="mt-7" />

      <p className="mt-6 text-center text-sm text-muted-foreground">
        {signUp ? "Already have an account? " : "Don't have an account? "}
        <Link
          href={signUp ? "/sign-in" : "/sign-up"}
          className="font-medium text-primary underline-offset-4 hover:underline"
        >
          {signUp ? "Sign in" : "Sign up"}
        </Link>
      </p>
    </div>
  );
}
