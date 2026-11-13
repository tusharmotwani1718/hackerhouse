"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@hacker-house/ui/components/button";

import { api } from "@/lib/api";

/**
 * Register for the hackathon (Flow 5). A complete profile is required (409 PROFILE_INCOMPLETE):
 * then a link to /profile, which brings the user back here once the profile is complete.
 */
export function RegisterButton({ slug }: { slug: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsProfile, setNeedsProfile] = useState(false);

  async function register() {
    setPending(true);
    setError(null);
    const result = await api(`/api/hackathons/${slug}/register`, { body: {}, idempotent: true });
    if (result.ok || result.code === "ALREADY_REGISTERED") {
      router.refresh(); // re-render the page as a registered participant
      return;
    }
    setNeedsProfile(result.code === "PROFILE_INCOMPLETE");
    setError(result.message);
    setPending(false);
  }

  return (
    <div className="grid gap-2">
      <Button onClick={register} disabled={pending} className="h-10 w-full">
        {pending ? "Registering…" : "Register"}
      </Button>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {needsProfile && (
        <Button
          variant="outline"
          nativeButton={false}
          render={<Link href={`/profile?next=${encodeURIComponent(`/hackathons/${slug}`)}`} />}
          className="h-9 w-full"
        >
          Complete your profile
        </Button>
      )}
    </div>
  );
}
