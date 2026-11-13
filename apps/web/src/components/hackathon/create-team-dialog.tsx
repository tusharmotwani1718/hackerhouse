"use client";

import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { Button } from "@hacker-house/ui/components/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@hacker-house/ui/components/dialog";
import { Input } from "@hacker-house/ui/components/input";
import { Label } from "@hacker-house/ui/components/label";
import { Textarea } from "@hacker-house/ui/components/textarea";
import { cn } from "@hacker-house/ui/lib/utils";

import { fieldErrors } from "@/components/profile/types";
import { api } from "@/lib/api";

const LABELS = { name: "Team name", description: "Description" };

type Choice<T extends string> = { value: T; title: string; hint: string };
const POLICIES: Choice<"OPEN" | "APPROVAL">[] = [
  { value: "OPEN", title: "Open", hint: "Anyone can join instantly while seats are free." },
  { value: "APPROVAL", title: "Approval", hint: "People ask to join; you approve or decline." },
];
const ACCESS: Choice<"PUBLIC" | "INVITE_ONLY">[] = [
  { value: "PUBLIC", title: "Public", hint: "Listed on the board for everyone." },
  { value: "INVITE_ONLY", title: "Invite only", hint: "Joining needs your team's invite code." },
];

/**
 * Create a team (Flow 6) and become its leader. Enabled only when the viewer is registered and
 * not in a team (`disabledReason` explains otherwise); the API checks again.
 */
export function CreateTeamDialog({
  slug,
  disabledReason,
}: {
  slug: string;
  disabledReason: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [policy, setPolicy] = useState<"OPEN" | "APPROVAL">("OPEN");
  const [access, setAccess] = useState<"PUBLIC" | "INVITE_ONLY">("PUBLIC");
  const [looking, setLooking] = useState(true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function reset() {
    setPolicy("OPEN");
    setAccess("PUBLIC");
    setLooking(true);
    setErrors({});
    setFormError(null);
    setPending(false);
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setErrors({});
    setFormError(null);
    const result = await api(`/api/hackathons/${slug}/teams`, {
      body: {
        name: String(form.get("name") ?? ""),
        description: String(form.get("description") ?? ""),
        joinPolicy: policy,
        access,
        isLooking: looking,
      },
      idempotent: true,
    });
    if (result.ok) {
      setOpen(false);
      reset();
      router.push(`/hackathons/${slug}/team`);
      router.refresh();
      return;
    }
    if (result.code === "TEAM_NAME_TAKEN") {
      setErrors({ name: "Another team in this hackathon already has this name." });
    } else {
      const byField = fieldErrors(result.details, LABELS);
      if (Object.keys(byField).length) setErrors(byField);
      else setFormError(result.message);
    }
    setPending(false);
  }

  if (disabledReason) {
    return (
      <Button disabled title={disabledReason} className="h-9 gap-1.5">
        <Plus aria-hidden />
        Create team
      </Button>
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger
        render={
          <Button className="h-9 gap-1.5">
            <Plus aria-hidden />
            Create team
          </Button>
        }
      />
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Create a team</DialogTitle>
          <DialogDescription>
            You&apos;ll be its leader. Others can then join you.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="team-name">Team name</Label>
            <Input
              id="team-name"
              name="name"
              required
              minLength={3}
              maxLength={40}
              placeholder="Rocket Squad"
              aria-invalid={!!errors.name}
              className="h-10"
            />
            {errors.name && <p className="text-sm text-destructive">{errors.name}</p>}
          </div>

          <div className="grid gap-2">
            <Label htmlFor="team-description">Description</Label>
            <Textarea
              id="team-description"
              name="description"
              rows={3}
              maxLength={500}
              placeholder="What will you build? Who are you looking for?"
              aria-invalid={!!errors.description}
            />
            {errors.description && <p className="text-sm text-destructive">{errors.description}</p>}
          </div>

          <ChoiceGroup
            label="Who can join"
            choices={POLICIES}
            value={policy}
            onChange={setPolicy}
          />
          <ChoiceGroup label="Visibility" choices={ACCESS} value={access} onChange={setAccess} />
          <p className="-mt-2 text-xs text-muted-foreground">
            These two can&apos;t be changed after the team is created.
          </p>

          <label className="flex items-start gap-3 rounded-lg border p-3 text-sm">
            <input
              type="checkbox"
              checked={looking}
              onChange={(event) => setLooking(event.target.checked)}
              className="mt-0.5 size-4 accent-primary"
            />
            <span>
              <span className="font-medium">Looking for members</span>
              <span className="block text-muted-foreground">
                Show the team on the board while it has free seats. You can change this later.
              </span>
            </span>
          </label>

          {formError && (
            <p role="alert" className="text-sm text-destructive">
              {formError}
            </p>
          )}

          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
            <Button type="submit" disabled={pending}>
              {pending ? "Creating…" : "Create team"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ChoiceGroup<T extends string>({
  label,
  choices,
  value,
  onChange,
}: {
  label: string;
  choices: Choice<T>[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <fieldset className="grid gap-2">
      <legend className="mb-2 text-sm font-medium">{label}</legend>
      <div role="radiogroup" className="grid gap-2 sm:grid-cols-2">
        {choices.map((choice) => (
          <button
            key={choice.value}
            type="button"
            role="radio"
            aria-checked={value === choice.value}
            onClick={() => onChange(choice.value)}
            className={cn(
              "rounded-lg border p-3 text-left text-sm transition-colors",
              value === choice.value
                ? "border-primary bg-accent/50 ring-1 ring-primary"
                : "hover:bg-muted",
            )}
          >
            <span className="font-medium">{choice.title}</span>
            <span className="mt-0.5 block text-xs text-muted-foreground">{choice.hint}</span>
          </button>
        ))}
      </div>
    </fieldset>
  );
}
