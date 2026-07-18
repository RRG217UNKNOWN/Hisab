-- =========================================================================
-- Fix: activity_log was invisible to solo (no-organization) owners.
--
-- log_activity() writes org_id = NEW.org_id / OLD.org_id, so for a solo
-- account (profiles.org_id IS NULL) every row it logs also has org_id NULL.
-- The old "act_select" policy required `org_id = public.current_org_id()`,
-- and in SQL `NULL = NULL` evaluates to NULL (not true), so that condition
-- silently failed for every one of a solo owner's own log rows — the log
-- was being written correctly, it just could never be *read* back.
--
-- Org accounts were unaffected (org_id matches org_id there), so this only
-- fixes the no-org case: fall back to "it's mine" when there's no org.
-- =========================================================================

DROP POLICY IF EXISTS "act_select" ON public.activity_log;
CREATE POLICY "act_select" ON public.activity_log FOR SELECT TO authenticated USING (
  public.current_role() IN ('owner', 'accountant')
  AND (
    (org_id IS NOT NULL AND org_id = public.current_org_id())
    OR (org_id IS NULL AND user_id = auth.uid())
  )
);
