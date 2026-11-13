import { Button } from "@hacker-house/ui/components/button";

export default function Home() {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-4 p-6">
      <h1 className="text-2xl font-semibold">Hacker House</h1>
      <p className="text-muted-foreground">The UI arrives in Phase 9 — shadcn is set up.</p>
      <Button>Button</Button>
    </main>
  );
}
