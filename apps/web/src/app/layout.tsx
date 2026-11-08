import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Hacker House",
  description: "Race-proof team formation for hackathons",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
