import type { Metadata } from "next";

export const metadata: Metadata = { title: "Settings" };

/* PLACEHOLDER — Wave 2 (dashboard-shell) replaces this with the settings page.
   The Claude API key field should call `saveAnthropicKey` / `clearAnthropicKey`
   from lib/anthropic-key.ts inside a server action, and render
   `getStoredAnthropicKeyPreview()` rather than the key itself. */
export default function SettingsPage() {
  return (
    <div className="px-8 py-16">
      <h1>Settings</h1>
      <p className="mt-4 text-amb-muted-foreground">
        Scaffold only — the Claude API key field lands in Wave 2.
      </p>
    </div>
  );
}
