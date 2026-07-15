-- =========================================================================
-- Part 1 — Fix: owner cannot change a teammate's role.
--
-- The only UPDATE policy on public.profiles was "auth.uid() = id" (self
-- only), so an owner editing someone else's role in Team always failed
-- with a permissions error. This adds a second, additive UPDATE policy for
-- "owner acting on a teammate in the same org", and a trigger that keeps
-- that policy narrow: an owner using this path can only change `role`
-- (and `role_group_id`, once Part 3 adds that column) on the teammate's
-- row — not full_name, phone, or anything else. Self-updates (the existing
-- policy) are untouched and stay unrestricted, as before.
-- =========================================================================

-- ============ Column-restriction trigger ============
-- Whitelist approach (rather than an ever-growing deny-list) so it stays
-- correct as columns are added to profiles later — e.g. Part 3's
-- role_group_id needs no changes here, it's already in the allow-list.
CREATE OR REPLACE FUNCTION public.restrict_owner_teammate_update() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  old_j jsonb := to_jsonb(OLD);
  new_j jsonb := to_jsonb(NEW);
  allowed_cols text[] := ARRAY['role', 'role_group_id'];
  k text;
BEGIN
  -- Self-updates are governed by the pre-existing "Users update own
  -- profile" policy and are intentionally left unrestricted here.
  IF auth.uid() = OLD.id THEN
    RETURN NEW;
  END IF;

  FOR k IN SELECT jsonb_object_keys(old_j) LOOP
    IF k = ANY(allowed_cols) THEN
      CONTINUE;
    END IF;
    IF (old_j -> k) IS DISTINCT FROM (new_j -> k) THEN
      RAISE EXCEPTION 'Owners can only change a teammate''s role or role group, not %', k;
    END IF;
  END LOOP;

  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS restrict_owner_teammate_update ON public.profiles;
CREATE TRIGGER restrict_owner_teammate_update BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.restrict_owner_teammate_update();

REVOKE EXECUTE ON FUNCTION public.restrict_owner_teammate_update() FROM anon, public;

-- ============ New, additive UPDATE policy ============
-- Additive: this does not replace "Users update own profile" — a row now
-- matches if EITHER policy's USING clause is true (Postgres ORs permissive
-- policies of the same command together).
DROP POLICY IF EXISTS "Owner updates teammate role" ON public.profiles;
CREATE POLICY "Owner updates teammate role" ON public.profiles FOR UPDATE TO authenticated
  USING (
    auth.uid() <> id
    AND public.current_role() = 'owner'
    AND org_id = public.current_org_id()
  )
  WITH CHECK (
    auth.uid() <> id
    AND public.current_role() = 'owner'
    AND org_id = public.current_org_id()
  );

-- ============ Sanity checks ============
-- These are safe to run by hand against a dev project (they self-clean via
-- ROLLBACK) to confirm both the new policy and protect_owner_role coexist
-- correctly. Left commented out — not executed as part of the migration.
--
-- BEGIN;
--   -- 1. Owner changes a teammate's role -> should succeed.
--   -- (run as the owner's session)
--   -- UPDATE public.profiles SET role = 'manager' WHERE id = '<teammate-id>';
--
--   -- 2. Owner tries to change a teammate's full_name via this path -> should fail.
--   -- UPDATE public.profiles SET full_name = 'Nope' WHERE id = '<teammate-id>';
--
--   -- 3. Owner tries to change the ORG CREATOR's role -> should still fail,
--   --    protect_owner_role fires regardless of which policy allowed the UPDATE.
--   -- UPDATE public.profiles SET role = 'staff' WHERE id = '<creator-id>';
-- ROLLBACK;
