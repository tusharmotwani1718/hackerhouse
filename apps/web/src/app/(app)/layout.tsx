import { Toaster } from "@hacker-house/ui/components/sonner";

import { AppHeader } from "@/components/app/app-header";

/** Signed-in area (/hackathons and below): app header + page. */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-svh bg-background">
      <AppHeader />
      <main className="mx-auto max-w-7xl px-4 py-10 sm:px-6">{children}</main>
      <Toaster position="bottom-right" richColors closeButton />
    </div>
  );
}
