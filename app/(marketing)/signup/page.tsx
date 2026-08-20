import type { Metadata } from "next";

import { AuthShell, AuthSwitch } from "@/components/marketing/auth-card";
import { SignupForm } from "@/components/marketing/signup-form";

export const metadata: Metadata = {
  title: "Sign up",
  description: "Create a DropShipping account with Google, or with an email and a password.",
};

/** Only same-origin paths survive, so a crafted `next` cannot bounce users off-site. */
function safeNext(value: string | string[] | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  return value.startsWith("/") && !value.startsWith("//") ? value : undefined;
}

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const { next } = await searchParams;

  return (
    <AuthShell
      eyebrow="Sign up"
      title={
        <>
          Start building<span className="dot">.</span>
        </>
      }
      subtitle="Continue with Google, or use an email and a password. Then describe a shop and version one gets written."
      footer={<AuthSwitch prompt="Already have an account?" href="/login" label="Log in" />}
    >
      <SignupForm next={safeNext(next)} />
    </AuthShell>
  );
}
