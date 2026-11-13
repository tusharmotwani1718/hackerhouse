import Image from "next/image";
import { Suspense } from "react";

import { RedirectIfSignedIn } from "@/components/auth/redirect-if-signed-in";
import { Logo } from "@/components/brand/logo";

/**
 * Shared frame of /sign-in and /sign-up: illustration panel on the left (large screens only),
 * the page's form on the right. Switching tabs keeps this layout mounted. Signed-in users are
 * sent to /hackathons.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-svh items-center justify-center bg-muted p-3 sm:p-6">
      <Suspense fallback={null}>
        <RedirectIfSignedIn />
      </Suspense>
      <div className="grid w-full max-w-6xl overflow-hidden rounded-[2rem] bg-card shadow-xl ring-1 ring-border/70 lg:min-h-[680px] lg:grid-cols-[1.15fr_1fr]">
        <aside className="hidden flex-col bg-linear-to-br from-accent/70 via-secondary/40 to-card px-12 pt-12 pb-10 lg:flex">
          <Logo />
          <h2 className="mt-14 max-w-md text-5xl leading-[1.1] font-medium tracking-tight">
            Find your next <span className="text-primary">hackathon team</span>
          </h2>
          <div className="mt-auto pt-10">
            {/* Decorative; SVG served as-is (no image optimisation for vector files). */}
            <Image
              src="/images/auth-illustration.svg"
              alt=""
              width={750}
              height={500}
              priority
              unoptimized
              className="h-auto w-full"
            />
          </div>
        </aside>

        <section className="flex flex-col items-center px-6 py-12 sm:px-12">
          <div className="flex w-full flex-1 items-center justify-center">{children}</div>
          <p className="pt-10 text-xs text-muted-foreground">© Hacker House</p>
        </section>
      </div>
    </main>
  );
}
