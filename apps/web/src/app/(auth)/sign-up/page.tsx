import type { Metadata } from "next";

import { AuthPanel } from "@/components/auth/auth-panel";

export const metadata: Metadata = { title: "Sign up · Hacker House" };

export default function SignUpPage() {
  return <AuthPanel mode="sign-up" />;
}
