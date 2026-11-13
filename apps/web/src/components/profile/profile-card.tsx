import { Pencil } from "lucide-react";

import { Button } from "@hacker-house/ui/components/button";

/** A section of the profile page: title, an Edit pill (when not editing), content. */
export function ProfileCard({
  title,
  description,
  editing,
  onEdit,
  children,
}: {
  title: string;
  description?: string;
  editing: boolean;
  onEdit: () => void;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl bg-card p-6 ring-1 ring-border">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-semibold">{title}</h2>
          {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
        </div>
        {!editing && (
          <Button variant="outline" onClick={onEdit} className="h-8 gap-1.5 rounded-full px-3">
            Edit
            <Pencil className="size-3.5" aria-hidden />
          </Button>
        )}
      </div>
      <div className="mt-5">{children}</div>
    </section>
  );
}

/** One label/value pair of the read-only view. */
export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-sm break-words">{children}</dd>
    </div>
  );
}
