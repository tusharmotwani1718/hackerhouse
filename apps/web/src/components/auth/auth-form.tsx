"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { Button } from "@hacker-house/ui/components/button";
import { Input } from "@hacker-house/ui/components/input";
import { Label } from "@hacker-house/ui/components/label";
import { cn } from "@hacker-house/ui/lib/utils";

import { AFTER_AUTH_PATH, authClient } from "@/lib/auth-client";

export type AuthMode = "sign-in" | "sign-up";

type AuthError = { code?: string; message?: string; status?: number };

/** A message people can act on, from Better Auth's error (or our rate limiter's, same shape). */
function messageFor(error: AuthError): string {
  switch (error.code) {
    case "INVALID_EMAIL_OR_PASSWORD":
      return "Wrong email or password.";
    case "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL":
    case "USER_ALREADY_EXISTS":
      return "An account with this email already exists. Sign in instead.";
    case "RATE_LIMITED":
      return error.message ?? "Too many attempts. Please wait a little and try again.";
    case "RETRY_LATER":
      return "Something went wrong on our side. Please try again in a moment.";
  }
  if (!error.status) return "Can't reach the server. Check your connection and try again.";
  return error.message ?? "Something went wrong. Please try again.";
}

/** Email + password form for both tabs; sign-up also asks for a name (shown to teammates). */
export function AuthForm({ mode, className }: { mode: AuthMode; className?: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const signUp = mode === "sign-up";

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");

    setPending(true);
    setError(null);
    const result = signUp
      ? await authClient.signUp.email({
          name: String(form.get("name") ?? "").trim(),
          email,
          password,
        })
      : await authClient.signIn.email({ email, password });

    if (result.error) {
      setError(messageFor(result.error));
      setPending(false);
      return;
    }
    // Signed in (sign-up signs in too): the session cookie is set; re-render with it.
    setPending(false);
    router.replace(AFTER_AUTH_PATH);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className={cn("grid gap-5", className)} noValidate={false}>
      {signUp && (
        <div className="grid gap-2">
          <Label htmlFor="name">Full name</Label>
          <Input
            id="name"
            name="name"
            autoComplete="name"
            placeholder="Asha Rao"
            required
            maxLength={80}
            className="h-10"
          />
        </div>
      )}
      <div className="grid gap-2">
        <Label htmlFor="email">Email address</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          placeholder="you@example.com"
          required
          className="h-10"
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete={signUp ? "new-password" : "current-password"}
          placeholder={signUp ? "At least 8 characters" : "Enter your password"}
          required
          minLength={8}
          maxLength={128}
          className="h-10"
        />
      </div>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <Button type="submit" disabled={pending} className="mt-1 h-10 w-full">
        {pending
          ? signUp
            ? "Creating your account…"
            : "Signing in…"
          : signUp
            ? "Create account"
            : "Sign in"}
      </Button>
    </form>
  );
}
