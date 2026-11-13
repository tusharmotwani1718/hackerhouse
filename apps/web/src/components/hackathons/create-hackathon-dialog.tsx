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

import { SLUG_MAX, slugify } from "@/lib/slugify";

type Field = "name" | "slug" | "description" | "minTeamSize" | "maxTeamSize";
type FieldErrors = Partial<Record<Field, string>>;
type ApiError = { code?: string; message?: string; details?: { path: string; message: string }[] };

const LABELS: Record<Field, string> = {
  name: "Name",
  slug: "URL name",
  description: "Description",
  minTeamSize: "Min team size",
  maxTeamSize: "Max team size",
};

/**
 * Admins only (the button is rendered for admins; the API checks again). Creates a hackathon
 * through POST /api/hackathons, then refreshes the list. The slug follows the name until the
 * admin edits it.
 */
export function CreateHackathonDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function reset() {
    setName("");
    setSlug("");
    setSlugEdited(false);
    setErrors({});
    setFormError(null);
    setPending(false);
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const minTeamSize = Number(form.get("minTeamSize"));
    const maxTeamSize = Number(form.get("maxTeamSize"));
    setErrors({});
    setFormError(null);
    // Checked here too, with a plain message (the API's says "minTeamSize").
    if (minTeamSize > maxTeamSize) {
      setErrors({ maxTeamSize: "Max team size can't be smaller than the min team size." });
      return;
    }
    setPending(true);

    let response: Response;
    try {
      response = await fetch("/api/hackathons", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          ...(slug.trim() ? { slug: slug.trim() } : {}),
          description: String(form.get("description") ?? ""),
          minTeamSize,
          maxTeamSize,
        }),
      });
    } catch {
      setFormError("Can't reach the server. Check your connection and try again.");
      setPending(false);
      return;
    }

    if (response.ok) {
      setOpen(false);
      reset();
      router.refresh(); // re-render the list with the new hackathon
      return;
    }

    const { error } = ((await response.json().catch(() => ({}))) as { error?: ApiError }) ?? {};
    if (error?.code === "VALIDATION_FAILED" && error.details?.length) {
      const next: FieldErrors = {};
      for (const detail of error.details) {
        const field = detail.path as Field;
        if (field in LABELS) next[field] ??= `${LABELS[field]} ${detail.message}.`;
      }
      setErrors(next);
      if (Object.keys(next).length === 0) setFormError(error.message ?? "Please check the form.");
    } else if (error?.code === "SLUG_TAKEN") {
      setErrors({ slug: "Another hackathon already uses this URL name. Choose another one." });
    } else {
      setFormError(error?.message ?? "Something went wrong. Please try again.");
    }
    setPending(false);
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
          <Button className="h-10 gap-1.5 px-4">
            <Plus aria-hidden />
            Create hackathon
          </Button>
        }
      />
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Create a hackathon</DialogTitle>
          <DialogDescription>
            Participants register for it and form teams inside it.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="hackathon-name">Name</Label>
            <Input
              id="hackathon-name"
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                if (!slugEdited) setSlug(slugify(event.target.value));
              }}
              placeholder="HackFest 2026"
              required
              minLength={3}
              maxLength={100}
              aria-invalid={!!errors.name}
              className="h-10"
            />
            {errors.name && <p className="text-sm text-destructive">{errors.name}</p>}
          </div>

          <div className="grid gap-2">
            <Label htmlFor="hackathon-slug">URL name</Label>
            <div className="flex h-10 items-center rounded-lg border border-input pl-2.5 text-sm text-muted-foreground focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50">
              /hackathons/
              <input
                id="hackathon-slug"
                value={slug}
                onChange={(event) => {
                  setSlug(event.target.value);
                  setSlugEdited(true);
                }}
                placeholder="hackfest-2026"
                maxLength={SLUG_MAX}
                aria-invalid={!!errors.slug}
                className="h-full min-w-0 flex-1 bg-transparent pr-2.5 text-foreground outline-none"
              />
            </div>
            {errors.slug ? (
              <p className="text-sm text-destructive">{errors.slug}</p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Lowercase letters, digits and hyphens. Filled in from the name.
              </p>
            )}
          </div>

          <div className="grid gap-2">
            <Label htmlFor="hackathon-description">Description</Label>
            <Textarea
              id="hackathon-description"
              name="description"
              rows={3}
              maxLength={5000}
              placeholder="What is it about, who is it for?"
              aria-invalid={!!errors.description}
            />
            {errors.description && <p className="text-sm text-destructive">{errors.description}</p>}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label htmlFor="hackathon-min">Min team size</Label>
              <Input
                id="hackathon-min"
                name="minTeamSize"
                type="number"
                min={1}
                max={10}
                defaultValue={1}
                required
                aria-invalid={!!errors.minTeamSize}
                className="h-10"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="hackathon-max">Max team size</Label>
              <Input
                id="hackathon-max"
                name="maxTeamSize"
                type="number"
                min={1}
                max={10}
                defaultValue={4}
                required
                aria-invalid={!!errors.maxTeamSize}
                className="h-10"
              />
            </div>
          </div>
          {(errors.minTeamSize || errors.maxTeamSize) && (
            <p className="-mt-2 text-sm text-destructive">
              {errors.minTeamSize ?? errors.maxTeamSize}
            </p>
          )}
          <p className="-mt-2 text-xs text-muted-foreground">
            Team sizes can&apos;t be changed after the hackathon is created.
          </p>

          {formError && (
            <p role="alert" className="text-sm text-destructive">
              {formError}
            </p>
          )}

          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
            <Button type="submit" disabled={pending}>
              {pending ? "Creating…" : "Create hackathon"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
