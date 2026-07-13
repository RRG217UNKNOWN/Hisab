-- =========================================================================
-- SECTION 2 FOLLOW-UP: Vendors -> Parties migration
--
-- 1. party_opening_balances: carries forward balances that pre-date the
--    parties/ledger system (e.g. from vendor_dues) so they show up in
--    party_ledger / party balances alongside real bills, expenses and
--    payments, without inventing a second ledger mechanism.
-- 2. party_ledger view is re-created to also union opening balances.
-- 3. One-time data migration: every existing public.vendor_dues row gets a
--    matching public.parties row (created if it doesn't already exist) and,
--    where the due wasn't already settled, an opening balance row so the
--    amount isn't lost. public.vendor_dues itself is left in place, unread,
--    for one release cycle.
-- =========================================================================

-- ============ 1. party_opening_balances ============
CREATE TABLE IF NOT EXISTS public.party_opening_balances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  party_id uuid NOT NULL REFERENCES public.parties(id) ON DELETE CASCADE,
  amount numeric NOT NULL CHECK (amount >= 0),
  direction text NOT NULL CHECK (direction IN ('payable','receivable')),
  note text,
  source text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.party_opening_balances TO authenticated;
GRANT ALL ON public.party_opening_balances TO service_role;
ALTER TABLE public.party_opening_balances ENABLE ROW LEVEL SECURITY;

CREATE POLICY "party_opening_balances_select" ON public.party_opening_balances FOR SELECT TO authenticated
  USING (public.can_read_row(user_id, org_id));
CREATE POLICY "party_opening_balances_insert" ON public.party_opening_balances FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND (org_id IS NULL OR (org_id = public.current_org_id()
         AND public.current_role() IN ('owner','manager','accountant')))
  );
CREATE POLICY "party_opening_balances_delete" ON public.party_opening_balances FOR DELETE TO authenticated
  USING (
    auth.uid() = user_id
    OR (org_id IS NOT NULL AND org_id = public.current_org_id()
        AND public.current_role() IN ('owner','manager'))
  );

CREATE TRIGGER party_opening_balances_set_org BEFORE INSERT ON public.party_opening_balances
  FOR EACH ROW EXECUTE FUNCTION public.set_org_id_from_profile();
CREATE TRIGGER party_opening_balances_log AFTER INSERT OR UPDATE OR DELETE ON public.party_opening_balances
  FOR EACH ROW EXECUTE FUNCTION public.log_activity();

-- ============ 2. party_ledger view (re-created with opening balances) =====
CREATE OR REPLACE VIEW public.party_ledger
WITH (security_invoker = true)
AS
  -- Credit sale bills => customer owes us (receivable)
  SELECT
    b.party_id,
    b.org_id,
    b.invoice_date::timestamptz AS date,
    'bill'::text AS source_table,
    b.id AS source_id,
    ('Sale bill ' || COALESCE(b.invoice_number,'')) AS description,
    'receivable'::text AS direction,
    b.total AS amount
  FROM public.bills b
  WHERE b.bill_type = 'sale'
    AND b.payment_method = 'credit'
    AND b.party_id IS NOT NULL

  UNION ALL

  -- Credit purchase bills => we owe supplier (payable)
  SELECT
    b.party_id, b.org_id, b.invoice_date::timestamptz,
    'bill', b.id,
    ('Purchase bill ' || COALESCE(b.invoice_number,'')),
    'payable', b.total
  FROM public.bills b
  WHERE b.bill_type = 'purchase'
    AND b.payment_method = 'credit'
    AND b.party_id IS NOT NULL

  UNION ALL

  -- Credit expenses => we owe party (payable)
  SELECT
    e.party_id, e.org_id, e.created_at,
    'expense', e.id,
    e.label,
    'payable', e.amount
  FROM public.expenses e
  WHERE e.payment_method = 'credit'
    AND e.party_id IS NOT NULL

  UNION ALL

  -- Opening balances carried forward from before the ledger existed
  -- (e.g. the one-time vendor_dues migration below).
  SELECT
    ob.party_id, ob.org_id, ob.created_at,
    'opening_balance', ob.id,
    COALESCE(ob.note, 'Opening balance'),
    ob.direction, ob.amount
  FROM public.party_opening_balances ob

  UNION ALL

  -- Payments reduce the corresponding side (stored as negative amount so
  -- summing per direction yields net outstanding).
  SELECT
    p.party_id, p.org_id, p.created_at,
    'payment', p.id,
    COALESCE(p.note, 'Payment'),
    p.direction, -p.amount
  FROM public.party_payments p;

GRANT SELECT ON public.party_ledger TO authenticated;

-- ============ 3. One-time data migration: vendor_dues -> parties =========
DO $$
DECLARE
  vd RECORD;
  pid uuid;
BEGIN
  FOR vd IN SELECT * FROM public.vendor_dues LOOP
    -- Match an existing party for this vendor name, scoped to the same org
    -- (or same user, for legacy org_id-less accounts).
    SELECT id INTO pid
      FROM public.parties
      WHERE name = vd.vendor_name
        AND type IN ('vendor','both')
        AND (
          (vd.org_id IS NOT NULL AND org_id = vd.org_id)
          OR (vd.org_id IS NULL AND user_id = vd.user_id)
        )
      LIMIT 1;

    IF pid IS NULL THEN
      INSERT INTO public.parties (org_id, user_id, name, type, notes)
        VALUES (vd.org_id, vd.user_id, vd.vendor_name, 'vendor', vd.category)
        RETURNING id INTO pid;
    END IF;

    IF vd.status = 'pending' AND vd.amount > 0 THEN
      -- pending => we owe the vendor (payable)
      INSERT INTO public.party_opening_balances
        (org_id, user_id, party_id, amount, direction, note, source)
        VALUES (
          vd.org_id, vd.user_id, pid, vd.amount, 'payable',
          COALESCE(vd.note, 'Migrated from vendor dues'), 'vendor_dues_migration'
        );
    ELSIF vd.status = 'owed' AND vd.amount > 0 THEN
      -- owed => the vendor owes us (receivable)
      INSERT INTO public.party_opening_balances
        (org_id, user_id, party_id, amount, direction, note, source)
        VALUES (
          vd.org_id, vd.user_id, pid, vd.amount, 'receivable',
          COALESCE(vd.note, 'Migrated from vendor dues'), 'vendor_dues_migration'
        );
    END IF;
    -- status = 'settled' => no opening balance needed, nothing further to do.
  END LOOP;
END $$;

-- NOTE: public.vendor_dues is intentionally left in place, unread by the
-- app, for one release cycle before being dropped in a future migration.
