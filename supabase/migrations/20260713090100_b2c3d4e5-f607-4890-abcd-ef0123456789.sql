-- =========================================================================
-- Part 3 — Editable job roles with tab/group-level permissions.
--
-- Adds an optional layer on top of the existing hardcoded `role` column:
-- an org owner can define named "role groups" (e.g. "Cashier") and control
-- which of a fixed set of tabs each group can see. A member with
-- profiles.role_group_id set gets that group's tab visibility; a member
-- with it left NULL keeps exactly today's behavior (the hardcoded
-- permissions.ts rules for their `role`). Write-permission checks
-- (can.write*) are untouched — this is view/visibility only.
-- =========================================================================

-- ============ Tables ============
CREATE TABLE IF NOT EXISTS public.role_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  base_role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, name)
);

CREATE TABLE IF NOT EXISTS public.role_group_permissions (
  role_group_id uuid NOT NULL REFERENCES public.role_groups(id) ON DELETE CASCADE,
  tab_key text NOT NULL CHECK (tab_key IN (
    'dashboard', 'create_bill', 'inventory', 'expenses', 'reports',
    'parties', 'vendors', 'team', 'activity', 'connections',
    'requests', 'import', 'export', 'settings', 'account'
  )),
  can_view boolean NOT NULL DEFAULT false,
  PRIMARY KEY (role_group_id, tab_key)
);

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS role_group_id uuid REFERENCES public.role_groups(id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.role_groups TO authenticated;
GRANT ALL ON public.role_groups TO service_role;
ALTER TABLE public.role_groups ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.role_group_permissions TO authenticated;
GRANT ALL ON public.role_group_permissions TO service_role;
ALTER TABLE public.role_group_permissions ENABLE ROW LEVEL SECURITY;

-- ============ RLS: owners manage, everyone in-org can read ============
-- (read access is needed so a non-owner member's session can resolve their
-- own effective tab permissions via the function below)
DROP POLICY IF EXISTS "role_groups_select" ON public.role_groups;
CREATE POLICY "role_groups_select" ON public.role_groups FOR SELECT TO authenticated
  USING (org_id = public.current_org_id());

DROP POLICY IF EXISTS "role_groups_insert" ON public.role_groups;
CREATE POLICY "role_groups_insert" ON public.role_groups FOR INSERT TO authenticated
  WITH CHECK (public.current_role() = 'owner' AND org_id = public.current_org_id());

DROP POLICY IF EXISTS "role_groups_update" ON public.role_groups;
CREATE POLICY "role_groups_update" ON public.role_groups FOR UPDATE TO authenticated
  USING (public.current_role() = 'owner' AND org_id = public.current_org_id());

DROP POLICY IF EXISTS "role_groups_delete" ON public.role_groups;
CREATE POLICY "role_groups_delete" ON public.role_groups FOR DELETE TO authenticated
  USING (public.current_role() = 'owner' AND org_id = public.current_org_id());

DROP POLICY IF EXISTS "rgp_select" ON public.role_group_permissions;
CREATE POLICY "rgp_select" ON public.role_group_permissions FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.role_groups rg WHERE rg.id = role_group_id AND rg.org_id = public.current_org_id()));

DROP POLICY IF EXISTS "rgp_insert" ON public.role_group_permissions;
CREATE POLICY "rgp_insert" ON public.role_group_permissions FOR INSERT TO authenticated
  WITH CHECK (
    public.current_role() = 'owner'
    AND EXISTS (SELECT 1 FROM public.role_groups rg WHERE rg.id = role_group_id AND rg.org_id = public.current_org_id())
  );

DROP POLICY IF EXISTS "rgp_update" ON public.role_group_permissions;
CREATE POLICY "rgp_update" ON public.role_group_permissions FOR UPDATE TO authenticated
  USING (
    public.current_role() = 'owner'
    AND EXISTS (SELECT 1 FROM public.role_groups rg WHERE rg.id = role_group_id AND rg.org_id = public.current_org_id())
  );

DROP POLICY IF EXISTS "rgp_delete" ON public.role_group_permissions;
CREATE POLICY "rgp_delete" ON public.role_group_permissions FOR DELETE TO authenticated
  USING (
    public.current_role() = 'owner'
    AND EXISTS (SELECT 1 FROM public.role_groups rg WHERE rg.id = role_group_id AND rg.org_id = public.current_org_id())
  );

-- ============ Block deleting a group that still has members ============
CREATE OR REPLACE FUNCTION public.block_role_group_delete_if_assigned() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.profiles WHERE role_group_id = OLD.id) THEN
    RAISE EXCEPTION 'Reassign members out of this role group before deleting it';
  END IF;
  RETURN OLD;
END; $$;

DROP TRIGGER IF EXISTS block_role_group_delete_if_assigned ON public.role_groups;
CREATE TRIGGER block_role_group_delete_if_assigned BEFORE DELETE ON public.role_groups
  FOR EACH ROW EXECUTE FUNCTION public.block_role_group_delete_if_assigned();

REVOKE EXECUTE ON FUNCTION public.block_role_group_delete_if_assigned() FROM anon, public;

-- ============ Resolution: current user's effective tab permissions ============
-- Returns zero rows when the caller has no role_group_id — the frontend
-- reads that as "no custom group, use the hardcoded permissions.ts fallback
-- for my `role`", per the task's fallback rule.
CREATE OR REPLACE FUNCTION public.effective_tab_permissions() RETURNS TABLE(tab_key text, can_view boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT rgp.tab_key, rgp.can_view
  FROM public.profiles p
  JOIN public.role_group_permissions rgp ON rgp.role_group_id = p.role_group_id
  WHERE p.id = auth.uid();
$$;

REVOKE EXECUTE ON FUNCTION public.effective_tab_permissions() FROM anon, public;
GRANT EXECUTE ON FUNCTION public.effective_tab_permissions() TO authenticated;

-- ============ One-time seed: default groups mirroring today's behavior ============
-- For every org, one role_groups row per app_role actually in use, with
-- role_group_permissions translated 1:1 from src/lib/permissions.ts's
-- can.view* functions as of this migration. Existing members'
-- profiles.role_group_id is deliberately left NULL — nothing is
-- auto-assigned, so nobody's access changes until an owner explicitly
-- assigns someone to a group from the new "Manage roles" UI. These seeded
-- groups just give the owner a sensible, accurate starting point to
-- duplicate/edit instead of starting from a blank slate.
DO $$
DECLARE
  org_role RECORD;
  target_group_id uuid;
  role_label text;
BEGIN
  FOR org_role IN
    SELECT DISTINCT org_id, role FROM public.profiles WHERE org_id IS NOT NULL
  LOOP
    target_group_id := NULL;
    role_label := CASE org_role.role
      WHEN 'owner' THEN 'Owner'
      WHEN 'manager' THEN 'Manager'
      WHEN 'staff' THEN 'Staff'
      WHEN 'accountant' THEN 'Accountant'
    END;

    INSERT INTO public.role_groups (org_id, name, base_role)
    VALUES (org_role.org_id, role_label, org_role.role)
    ON CONFLICT (org_id, name) DO NOTHING
    RETURNING id INTO target_group_id;

    IF target_group_id IS NULL THEN
      SELECT id INTO target_group_id FROM public.role_groups
        WHERE org_id = org_role.org_id AND name = role_label;
    END IF;

    INSERT INTO public.role_group_permissions (role_group_id, tab_key, can_view)
    SELECT
      target_group_id,
      t.tab_key,
      CASE org_role.role
        WHEN 'owner' THEN true
        WHEN 'manager' THEN t.tab_key IN (
          'dashboard', 'create_bill', 'inventory', 'expenses', 'reports',
          'parties', 'vendors', 'team', 'requests', 'import', 'export',
          'settings', 'account'
        )
        WHEN 'staff' THEN t.tab_key IN (
          'dashboard', 'create_bill', 'inventory', 'parties', 'vendors',
          'import', 'settings', 'account'
        )
        WHEN 'accountant' THEN t.tab_key IN (
          'dashboard', 'expenses', 'reports', 'parties', 'activity',
          'settings', 'account'
        )
      END
    FROM (VALUES
      ('dashboard'), ('create_bill'), ('inventory'), ('expenses'), ('reports'),
      ('parties'), ('vendors'), ('team'), ('activity'), ('connections'),
      ('requests'), ('import'), ('export'), ('settings'), ('account')
    ) AS t(tab_key)
    ON CONFLICT (role_group_id, tab_key) DO NOTHING;
  END LOOP;
END $$;
