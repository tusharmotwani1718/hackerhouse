import { ArrowRight, CircleAlert, CircleCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { Button } from "@hacker-house/ui/components/button";

import { PersonalInfoCard } from "@/components/profile/personal-info-card";
import { SkillsCard } from "@/components/profile/skills-card";
import type { ProfileData } from "@/components/profile/types";
import { initials } from "@/lib/initials";
import { getCurrentSession } from "@/server/auth/current-session";
import { runReadTx } from "@/server/core/tx";
import { getProfile } from "@/server/modules/profile/service";
import { CANONICAL_TIMEZONES } from "@/server/modules/profile/timezones.data";

export const metadata: Metadata = { title: "My profile · Hacker House" };

/** Only same-site paths are followed after completing the profile (no open redirect). */
function safeNext(value: string | string[] | undefined): string | null {
  const next = Array.isArray(value) ? value[0] : value;
  return next && next.startsWith("/") && !next.startsWith("//") ? next : null;
}

/**
 * /profile: what leaders see about you, and what registration needs (04 §1.2: a GitHub
 * username + at least one skill). `?next=/hackathons/x` → a "Continue" link once complete.
 */
export default function ProfilePage({ searchParams }: PageProps<"/profile">) {
  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-semibold tracking-tight">My profile</h1>
      <Suspense fallback={<ProfileSkeleton />}>
        <Profile searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function Profile({ searchParams }: Pick<PageProps<"/profile">, "searchParams">) {
  const session = await getCurrentSession();
  if (!session) redirect("/sign-in");
  const next = safeNext((await searchParams).next);
  const raw = await runReadTx((tx) => getProfile(tx, session.user.id));
  const profile: ProfileData = {
    name: raw.name,
    email: raw.email,
    role: raw.role,
    timezone: raw.timezone,
    githubUsername: raw.githubUsername,
    portfolioUrl: raw.portfolioUrl,
    skills: raw.skills,
    profileComplete: raw.profileComplete,
    missing: raw.missing,
  };

  return (
    <div className="mt-6 grid gap-5">
      <section className="flex flex-wrap items-center gap-5 rounded-2xl bg-card p-6 ring-1 ring-border">
        <span
          aria-hidden
          className="flex size-16 shrink-0 items-center justify-center rounded-full bg-primary text-xl font-semibold text-primary-foreground"
        >
          {initials(profile.name)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 text-lg font-semibold">
            {profile.name}
            {profile.role === "ADMIN" && (
              <span className="rounded-full bg-accent px-2 py-0.5 text-xs font-medium text-accent-foreground">
                Admin
              </span>
            )}
          </p>
          <p className="truncate text-sm text-muted-foreground">{profile.email}</p>
          <p className="text-sm text-muted-foreground">
            {profile.githubUsername ? `@${profile.githubUsername} · ` : ""}
            {profile.timezone}
          </p>
        </div>
      </section>

      {profile.profileComplete ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-accent/60 px-4 py-3 text-sm">
          <p className="flex items-center gap-2 font-medium text-accent-foreground">
            <CircleCheck className="size-4" aria-hidden />
            Your profile is complete: you can register for hackathons.
          </p>
          {next && (
            <Button nativeButton={false} render={<Link href={next} />} className="h-8 gap-1.5">
              Continue
              <ArrowRight aria-hidden />
            </Button>
          )}
        </div>
      ) : (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm">
          <p className="flex items-center gap-2 font-medium">
            <CircleAlert className="size-4 text-destructive" aria-hidden />
            Complete your profile to register for hackathons
          </p>
          <ul className="mt-1.5 ml-6 list-disc text-muted-foreground">
            {profile.missing.includes("githubUsername") && (
              <li>Add your GitHub username (Personal information → Edit)</li>
            )}
            {profile.missing.includes("skills") && <li>Add at least one skill (Skills → Edit)</li>}
          </ul>
        </div>
      )}

      <PersonalInfoCard profile={profile} timezones={CANONICAL_TIMEZONES} />
      <SkillsCard profile={profile} />
    </div>
  );
}

function ProfileSkeleton() {
  return (
    <div className="mt-6 grid gap-5" aria-hidden>
      <div className="h-28 animate-pulse rounded-2xl bg-muted" />
      <div className="h-12 animate-pulse rounded-xl bg-muted" />
      <div className="h-56 animate-pulse rounded-2xl bg-muted" />
      <div className="h-40 animate-pulse rounded-2xl bg-muted" />
    </div>
  );
}
