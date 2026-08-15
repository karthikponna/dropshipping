import type { Metadata } from "next";

import { AuthShell, AuthSwitch } from "@/components/marketing/auth-card";
import { LoginForm } from "@/components/marketing/login-form";

export const metadata: Metadata = {
  title: "Log in",
  description: "Sign in to DropShipping with your email and password.",
};

/** Only same-origin paths survive, so a crafted `next` cannot bounce users off-site. */
function safeNext(value: string | string[] | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  return value.startsWith("/") && !value.startsWith("//") ? value : undefined;
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const { next } = await searchParams;

  return (
    <AuthShell
      eyebrow="Log in"
      title={
        <>
          Welcome back<span className="dot">.</span>
        </>
      }
      subtitle="Sign in to your dashboard and pick up the last generation where it stopped."
      footer={<AuthSwitch prompt="No account yet?" href="/signup" label="Create one" />}
    >
      <LoginForm next={safeNext(next)} />
    </AuthShell>
  );
}
