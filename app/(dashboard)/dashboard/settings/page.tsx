import type { Metadata } from "next";

import { ApiKeyForm } from "@/components/dashboard/api-key-form";
import { getDashboardSession } from "@/lib/dashboard/data";
import { getStoredAnthropicKeyPreview } from "@/lib/anthropic-key";
import { isEncryptionConfigured } from "@/lib/crypto";
import { SUPABASE_SETUP_HINT } from "@/lib/supabase/env";

export const metadata: Metadata = { title: "Settings" };

const ENCRYPTION_HINT =
  "APP_ENCRYPTION_KEY is not set, so a key cannot be stored securely. Generate one with `openssl rand -hex 32` and add it to .env.local.";

const PANEL = "rounded-amb-panel border border-amb-border bg-amb-card p-5 shadow-amb-sm";

export default async function SettingsPage() {
  const [session, maskedKey] = await Promise.all([
    getDashboardSession(),
    getStoredAnthropicKeyPreview(),
  ]);

  const envFallbackAvailable = Boolean(process.env.ANTHROPIC_API_KEY?.trim());

  let unavailableReason: string | null = null;
  if (session.status === "unconfigured") unavailableReason = SUPABASE_SETUP_HINT;
  else if (session.status === "signed_out") unavailableReason = "Sign in again to save a key.";
  else if (!isEncryptionConfigured()) unavailableReason = ENCRYPTION_HINT;

  return (
    <div className="px-4 pt-8 pb-16 sm:px-6 lg:px-8">
      <header>
        <h1 className="text-[30px] leading-[1.15] tracking-[-0.035em]">Settings</h1>
        <p className="mt-1 text-[14px] text-amb-muted-foreground">
          Keys and account details for this workspace.
        </p>
      </header>

      <div className="mt-8 flex max-w-[720px] flex-col gap-4">
        <section className={PANEL}>
          <h2 className="text-[14px] font-medium tracking-[-0.02em] text-amb-foreground">
            Claude API key
          </h2>
          <p className="mt-1 text-[13px] text-amb-muted-foreground">
            Stored encrypted against your profile and used for your generations. Only the masked
            preview is ever shown.{" "}
            {envFallbackAvailable
              ? "Without a key here, generation falls back to the server's ANTHROPIC_API_KEY."
              : "There is no server ANTHROPIC_API_KEY configured, so generation needs a key here."}
          </p>

          <div className="mt-4">
            <ApiKeyForm maskedKey={maskedKey} unavailableReason={unavailableReason} />
          </div>
        </section>

        <section className={PANEL}>
          <h2 className="text-[14px] font-medium tracking-[-0.02em] text-amb-foreground">
            Account
          </h2>
          <dl className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <dt className="text-[14px] text-amb-muted-foreground">Signed in as</dt>
            <dd className="text-[14px] text-amb-foreground">
              {session.user?.email ?? "Not signed in"}
            </dd>
          </dl>
          <p className="mt-3 text-[13px] text-amb-muted-foreground">
            Sign out from the bottom of the sidebar.
          </p>
        </section>
      </div>
    </div>
  );
}
