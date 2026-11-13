import type { Metadata } from "next";
import { Inter, JetBrains_Mono, Roboto_Mono } from "next/font/google";

import "@hacker-house/ui/globals.css";
import { cn } from "@hacker-house/ui/lib/utils";

import { ThemeProvider } from "@/components/theme-provider";

// Design tokens (colours, radius, fonts) live in packages/ui/src/styles/globals.css.
const fontSans = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
});

const fontSerif = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-serif",
});

const fontMono = Roboto_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
});

export const metadata: Metadata = {
  title: "Hacker House",
  description: "Race-proof team formation for hackathons",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={cn("font-sans antialiased", fontSans.variable, fontMono.variable)}
    >
      <body
        className={`${fontSans.variable} ${fontSerif.variable} ${fontMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
