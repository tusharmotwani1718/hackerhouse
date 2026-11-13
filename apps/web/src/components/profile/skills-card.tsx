"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@hacker-house/ui/components/button";
import { cn } from "@hacker-house/ui/lib/utils";

import { api } from "@/lib/api";
import { SKILL_LABELS } from "@/lib/skills";

import { ProfileCard } from "./profile-card";
import { LEVELS, type ProfileData } from "./types";

const SKILLS = Object.keys(SKILL_LABELS);
const levelLabel = (level: number) => LEVELS.find((l) => l.level === level)?.label ?? "";

/**
 * Skills, each 1–5 (04 §1.1 rubric); 0 = not listed. Saving replaces the whole set
 * (PATCH /api/me `skills`); at least one skill is required.
 */
export function SkillsCard({ profile }: { profile: ProfileData }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [levels, setLevels] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const current = Object.entries(profile.skills)
    .filter((entry): entry is [string, number] => typeof entry[1] === "number")
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

  function edit() {
    setLevels(Object.fromEntries(current));
    setError(null);
    setEditing(true);
  }

  async function save() {
    const chosen = Object.fromEntries(Object.entries(levels).filter(([, level]) => level >= 1));
    if (Object.keys(chosen).length === 0) {
      setError("Pick at least one skill.");
      return;
    }
    setPending(true);
    setError(null);
    const result = await api("/api/me", { method: "PATCH", body: { skills: chosen } });
    setPending(false);
    if (result.ok) {
      setEditing(false);
      router.refresh();
      return;
    }
    setError(result.message);
  }

  return (
    <ProfileCard
      title="Skills"
      description="Rate yourself honestly: leaders see these, and suggestions are based on them."
      editing={editing}
      onEdit={edit}
    >
      {!editing ? (
        current.length === 0 ? (
          <p className="text-sm font-medium text-destructive">
            No skills yet: add at least one to register for hackathons.
          </p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {current.map(([skill, level]) => (
              <li
                key={skill}
                className="inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm"
              >
                {SKILL_LABELS[skill] ?? skill}
                <span className="text-xs text-muted-foreground">
                  {level}/5 · {levelLabel(level)}
                </span>
              </li>
            ))}
          </ul>
        )
      ) : (
        <div className="grid gap-5">
          <dl className="grid gap-x-6 gap-y-1 rounded-lg bg-muted/60 p-3 text-xs sm:grid-cols-5">
            {LEVELS.map((l) => (
              <div key={l.level}>
                <dt className="font-medium">
                  {l.level} · {l.label}
                </dt>
                <dd className="text-muted-foreground">{l.hint}</dd>
              </div>
            ))}
          </dl>

          <ul className="grid gap-2">
            {SKILLS.map((skill) => {
              const value = levels[skill] ?? 0;
              return (
                <li
                  key={skill}
                  className="flex flex-wrap items-center justify-between gap-2 border-b pb-2 last:border-0"
                >
                  <span className="text-sm font-medium">{SKILL_LABELS[skill]}</span>
                  <div
                    role="radiogroup"
                    aria-label={`${SKILL_LABELS[skill]} level`}
                    className="flex gap-1"
                  >
                    {[0, 1, 2, 3, 4, 5].map((level) => (
                      <button
                        key={level}
                        type="button"
                        role="radio"
                        aria-checked={value === level}
                        title={level === 0 ? "None" : levelLabel(level)}
                        onClick={() => setLevels((prev) => ({ ...prev, [skill]: level }))}
                        className={cn(
                          "size-8 rounded-md border text-xs font-medium transition-colors",
                          value === level
                            ? level === 0
                              ? "border-foreground/30 bg-muted text-foreground"
                              : "border-primary bg-primary text-primary-foreground"
                            : "text-muted-foreground hover:bg-muted",
                        )}
                      >
                        {level === 0 ? "–" : level}
                      </button>
                    ))}
                  </div>
                </li>
              );
            })}
          </ul>

          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setEditing(false)}
              className="h-9"
            >
              Cancel
            </Button>
            <Button type="button" onClick={save} disabled={pending} className="h-9">
              {pending ? "Saving…" : "Save skills"}
            </Button>
          </div>
        </div>
      )}
    </ProfileCard>
  );
}
