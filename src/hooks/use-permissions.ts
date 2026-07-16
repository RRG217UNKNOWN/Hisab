import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useProfile, type TabKey } from "./use-profile";
import { can } from "@/lib/permissions";

// Fallback map — mirrors the existing hardcoded nav-gating logic in
// permissions.ts / AppShell exactly, for members with no role_group_id.
// This is intentionally the single place that translates can.view* into a
// per-tab lookup, so it can't drift from the seeded DB defaults (Part 3's
// migration seed was generated from this same source).
const hardcodedTabView: Record<TabKey, (role: Parameters<typeof can.viewInventory>[0]) => boolean> = {
  dashboard: () => true,
  create_bill: can.viewCreateBill,
  inventory: can.viewInventory,
  expenses: can.viewExpenses,
  reports: can.viewReports,
  parties: can.viewParties,
  vendors: can.viewVendors,
  team: can.viewTeam,
  activity: can.viewActivity,
  connections: can.manageConnections,
  requests: (role) => can.manageConnections(role) || can.fulfillRequests(role),
  import: can.viewImport,
  export: can.viewExport,
  settings: can.viewSettings,
  account: () => true,
};

export function usePermissions() {
  const { profile, loading: profileLoading } = useProfile();
  const [groupPerms, setGroupPerms] = useState<Record<string, boolean> | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!profile?.role_group_id) {
      setGroupPerms(null);
      return;
    }
    setLoading(true);
    const { data } = await supabase.rpc("effective_tab_permissions");
    const map: Record<string, boolean> = {};
    for (const row of (data as { tab_key: string; can_view: boolean }[] | null) ?? []) {
      map[row.tab_key] = row.can_view;
    }
    setGroupPerms(map);
    setLoading(false);
  }, [profile?.role_group_id]);

  useEffect(() => {
    void load();
  }, [load]);

  // A role_group_id is set but the RPC hasn't returned any rows yet -> use
  // the group (empty map = "no tabs" rather than silently falling back to
  // the hardcoded rules, since the member IS in a custom group).
  const canView = useCallback(
    (tab: TabKey): boolean => {
      if (profile?.role_group_id) {
        return groupPerms?.[tab] ?? false;
      }
      return hardcodedTabView[tab](profile?.role);
    },
    [profile?.role_group_id, profile?.role, groupPerms],
  );

  return { canView, loading: loading || profileLoading, reload: load };
}
