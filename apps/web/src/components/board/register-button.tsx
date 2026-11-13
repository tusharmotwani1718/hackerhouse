"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@hacker-house/ui/components/button";

import { api } from "@/lib/api";

/** Register for the hackathon (Flow 5). A complete profile is required (409 PROFILE_INCOMPLETE). */
export function RegisterButton({ slug }: { slug: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function register() {
    setPending(true);
    setError(null);
    const result = await api(`/api/hackathons/${slug}/register`, { body: {}, idempotent: true });
    if (result.ok || result.code === "ALREADY_REGISTERED") {
      router.refresh(); // re-render the page as a registered participant
      return;
    }
    setError(
      result.code === "PROFILE_INCOMPLETE"
        ? `${result.message} The profile page is coming soon.`
        : result.message,
    );
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
    </div>
  );
}
