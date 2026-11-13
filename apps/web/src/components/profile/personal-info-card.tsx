"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { Button } from "@hacker-house/ui/components/button";
import { Input } from "@hacker-house/ui/components/input";
import { Label } from "@hacker-house/ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@hacker-house/ui/components/select";

import { api } from "@/lib/api";

import { Field, ProfileCard } from "./profile-card";
import { fieldErrors, type ProfileData } from "./types";

const LABELS = {
  name: "Name",
  githubUsername: "GitHub username",
  portfolioUrl: "Portfolio URL",
  timezone: "Timezone",
};

/** Name, GitHub username, portfolio link, timezone. Email is read-only (it's the sign-in). */
export function PersonalInfoCard({
  profile,
  timezones,
}: {
  profile: ProfileData;
  timezones: readonly string[];
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [timezone, setTimezone] = useState(profile.timezone);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const githubMissing = profile.missing.includes("githubUsername");

  function close() {
    setEditing(false);
    setErrors({});
    setFormError(null);
    setTimezone(profile.timezone);
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const github = String(form.get("githubUsername") ?? "").trim();
    const portfolio = String(form.get("portfolioUrl") ?? "").trim();
    setErrors({});
    setFormError(null);
    // Once set, the GitHub username can be changed but not removed (04 §1.2).
    if (!github && profile.githubUsername) {
      setErrors({ githubUsername: "GitHub username can be changed, but not removed." });
      return;
    }
    setPending(true);
    const result = await api("/api/me", {
      method: "PATCH",
      body: {
        name: String(form.get("name") ?? ""),
        ...(github ? { githubUsername: github } : {}),
        portfolioUrl: portfolio || null,
        timezone,
      },
    });
    setPending(false);
    if (result.ok) {
      setEditing(false);
      router.refresh();
      return;
    }
    const byField = fieldErrors(result.details, LABELS);
    if (Object.keys(byField).length) setErrors(byField);
    else setFormError(result.message);
  }

  return (
    <ProfileCard title="Personal information" editing={editing} onEdit={() => setEditing(true)}>
      {!editing ? (
        <dl className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
          <Field label="Name">{profile.name}</Field>
          <Field label="Email address">{profile.email}</Field>
          <Field label="GitHub username">
            {profile.githubUsername ? (
              <span className="inline-flex items-center gap-2">
                @{profile.githubUsername}
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                  unverified
                </span>
              </span>
            ) : (
              <span className="font-medium text-destructive">Not set (required)</span>
            )}
          </Field>
          <Field label="Portfolio / resume">
            {profile.portfolioUrl ? (
              <a
                href={profile.portfolioUrl}
                target="_blank"
                rel="noreferrer"
                className="text-primary underline-offset-4 hover:underline"
              >
                {profile.portfolioUrl}
              </a>
            ) : (
              <span className="text-muted-foreground">Not set</span>
            )}
          </Field>
          <Field label="Timezone">{profile.timezone}</Field>
        </dl>
      ) : (
        <form onSubmit={onSubmit} className="grid gap-5">
          <div className="grid gap-5 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="profile-name">Name</Label>
              <Input
                id="profile-name"
                name="name"
                defaultValue={profile.name}
                required
                maxLength={80}
                aria-invalid={!!errors.name}
                className="h-10"
              />
              {errors.name && <p className="text-sm text-destructive">{errors.name}</p>}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="profile-email">Email address</Label>
              <Input id="profile-email" value={profile.email} disabled className="h-10" />
              <p className="text-xs text-muted-foreground">
                Used to sign in; can&apos;t be changed.
              </p>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="profile-github">
                GitHub username {githubMissing && <span className="text-destructive">*</span>}
              </Label>
              <Input
                id="profile-github"
                name="githubUsername"
                defaultValue={profile.githubUsername ?? ""}
                placeholder="octocat"
                maxLength={40}
                autoComplete="off"
                aria-invalid={!!errors.githubUsername}
                className="h-10"
              />
              {errors.githubUsername ? (
                <p className="text-sm text-destructive">{errors.githubUsername}</p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Leaders see it when you ask to join. Shown as unverified.
                </p>
              )}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="profile-portfolio">Portfolio / resume URL</Label>
              <Input
                id="profile-portfolio"
                name="portfolioUrl"
                type="url"
                defaultValue={profile.portfolioUrl ?? ""}
                placeholder="https://…"
                aria-invalid={!!errors.portfolioUrl}
                className="h-10"
              />
              {errors.portfolioUrl && (
                <p className="text-sm text-destructive">{errors.portfolioUrl}</p>
              )}
            </div>
            <div className="grid gap-2 sm:col-span-2">
              <Label>Timezone</Label>
              <div className="flex flex-wrap items-center gap-2">
                <Select
                  items={timezones.map((zone) => ({ value: zone, label: zone }))}
                  value={timezone}
                  onValueChange={(next) => {
                    if (typeof next === "string") setTimezone(next);
                  }}
                >
                  <SelectTrigger className="h-10 w-full sm:w-80" aria-label="Timezone">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="max-h-72">
                    {timezones.map((zone) => (
                      <SelectItem key={zone} value={zone}>
                        {zone}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  variant="ghost"
                  className="h-10"
                  onClick={() => {
                    const local = Intl.DateTimeFormat().resolvedOptions().timeZone;
                    // The browser may report an alias (Asia/Calcutta); the server accepts it
                    // and stores the canonical name, so keep it even if it isn't in the list.
                    if (local) setTimezone(local);
                  }}
                >
                  Use my timezone
                </Button>
              </div>
              {errors.timezone ? (
                <p className="text-sm text-destructive">{errors.timezone}</p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Used to suggest teammates with overlapping working hours.
                </p>
              )}
            </div>
          </div>

          {formError && (
            <p role="alert" className="text-sm text-destructive">
              {formError}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={close} className="h-9">
              Cancel
            </Button>
            <Button type="submit" disabled={pending} className="h-9">
              {pending ? "Saving…" : "Save"}
            </Button>
          </div>
        </form>
      )}
    </ProfileCard>
  );
}
