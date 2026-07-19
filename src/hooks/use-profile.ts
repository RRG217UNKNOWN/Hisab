import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./use-auth";

export type Role = "owner" | "manager" | "staff" | "accountant";

// Fixed set of tab identifiers used by the role-group permission system
// (Part 3) — kept here alongside `Role` so every consumer (permissions.ts,
// use-permissions.ts, Team's "Manage roles" UI) shares one definition.
export const TAB_KEYS = [
  "dashboard",
  "create_bill",
  "inventory",
  "expenses",
  "reports",
  "parties",
  "vendors",
  "team",
  "activity",
  "connections",
  "requests",
  "import",
  "export",
  "settings",
  "account",
] as const;
export type TabKey = (typeof TAB_KEYS)[number];

export type RoleGroup = {
  id: string;
  org_id: string;
  name: string;
  base_role: Role;
};

export type Organization = {
  id: string;
  name: string;
  org_code: string;
  created_by: string | null;
  business_address: string | null;
  gstin: string | null;
  state: string | null;
};

export type Profile = {
  id: string;
  full_name: string | null;
  phone: string | null;
  org_id: string | null;
  role: Role;
  role_group_id: string | null;
  language: string | null;
  org: Organization | null;
  // Seller-identity fallback for legacy org_id-less accounts.
  business_address: string | null;
  gstin: string | null;
  state: string | null;
};

export function useProfile() {
  const { user, loading: authLoading } = useAuth();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    if (!user) {
      setProfile(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data } = await supabase
      .from("profiles")
      .select("id, full_name, phone, org_id, role, role_group_id, language, business_address, gstin, state")
      .eq("id", user.id)
      .maybeSingle();
    let org: Organization | null = null;
    const orgId = (data as { org_id?: string | null } | null)?.org_id ?? null;
    if (orgId) {
      const { data: o } = await (supabase as unknown as {
        from: (t: string) => {
          select: (s: string) => {
            eq: (c: string, v: string) => { maybeSingle: () => Promise<{ data: Organization | null }> };
          };
        };
      })
        .from("organizations")
        .select("id, name, org_code, created_by, business_address, gstin, state")
        .eq("id", orgId)
        .maybeSingle();
      org = o ?? null;
    }
    setProfile(
      data
        ? {
            id: (data as { id: string }).id,
            full_name: (data as { full_name: string | null }).full_name,
            phone: (data as { phone: string | null }).phone,
            language: (data as { language: string | null }).language ?? null,
            org_id: orgId,
            role: ((data as { role?: Role }).role ?? "owner") as Role,
            role_group_id: (data as { role_group_id?: string | null }).role_group_id ?? null,
            business_address: (data as { business_address?: string | null }).business_address ?? null,
            gstin: (data as { gstin?: string | null }).gstin ?? null,
            state: (data as { state?: string | null }).state ?? null,
            org,
          }
        : null,
    );
    setLoading(false);
  }, [user]);

  useEffect(() => {
    if (authLoading) return;
    void reload();
  }, [authLoading, reload]);

  return { profile, loading: loading || authLoading, reload };
}
