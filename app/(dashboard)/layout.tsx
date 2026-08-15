import { redirect } from "next/navigation";

import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { dashboardFontVariables } from "@/lib/fonts";
import { isSupabaseConfigured, SUPABASE_SETUP_HINT } from "@/lib/supabase/env";
import { getCurrentUser } from "@/lib/supabase/server";

/**
 * Dashboard subtree. `amb-scope` is the only place the
 * amboras-admin-design-system tokens exist; utilities are namespaced `amb-*`
 * (bg-amb-primary, rounded-amb-feature, shadow-amb-float, w-amb-sidebar).
 *
 * Auth guard runs here as well as in middleware. When Supabase is unconfigured
 * the guard steps aside so the console can still be developed locally.
 */
export default async function DashboardLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const configured = isSupabaseConfigured();
  let email: string | null = null;

  if (configured) {
    const user = await getCurrentUser();
    if (!user) redirect("/login");
    email = user.email ?? null;
  }

  return (
    <div className={`amb-scope ${dashboardFontVariables} min-h-dvh`}>
      <DashboardShell email={email} notice={configured ? null : SUPABASE_SETUP_HINT}>
        {children}
      </DashboardShell>
    </div>
  );
}
