import { redirect } from "next/navigation";

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
 *
 * Wave 2 (dashboard-shell) adds the 255px sidebar and topbar around {children}.
 */
export default async function DashboardLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const configured = isSupabaseConfigured();

  if (configured) {
    const user = await getCurrentUser();
    if (!user) redirect("/login");
  }

  return (
    <div className={`amb-scope ${dashboardFontVariables} min-h-dvh`}>
      {!configured && (
        <p className="border-b border-amb-border bg-amb-warning-bg px-4 py-2 text-[12px] text-amb-warning-foreground">
          {SUPABASE_SETUP_HINT}
        </p>
      )}
      {children}
    </div>
  );
}
