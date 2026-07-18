-- =========================================================================
-- Import → pending bills review workflow.
--
-- `bills.status` already existed (default 'completed') but nothing used it.
-- This wires it up:
--   1. A real CHECK so status can only ever be pending/completed/rejected.
--   2. A `source` column so the UI can tell a bill that arrived via CSV
--      import apart from one entered manually or through Create Bill.
--   3. `party_ledger` is re-created to only count 'completed' bills — a
--      pending import must NOT affect a party's outstanding balance (or
--      show up in Reports/Alter Entries) until it's explicitly accepted.
--   4. bill_items gets a DELETE grant/policy so a pending bill's line items
--      can be edited (add/remove rows) before it's accepted.
--
-- Stock and `sales` rows are deliberately NOT touched by this migration —
-- the app only applies those when a pending bill is accepted (see
-- src/routes/import.tsx), exactly mirroring what Create Bill already does
-- for a bill that's completed on the spot.
-- =========================================================================

ALTER TABLE public.bills ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual';

DO $$ BEGIN
  ALTER TABLE public.bills ADD CONSTRAINT bills_source_check CHECK (source IN ('manual', 'csv'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE public.bills ADD CONSTRAINT bills_status_check CHECK (status IN ('pending', 'completed', 'rejected'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_bills_status ON public.bills (status);

-- ---- party_ledger: only 'completed' bills count -------------------------
CREATE OR REPLACE VIEW public.party_ledger
WITH (security_invoker = true)
AS
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
    AND b.status = 'completed'

  UNION ALL

  SELECT
    b.party_id, b.org_id, b.invoice_date::timestamptz,
    'bill', b.id,
    ('Purchase bill ' || COALESCE(b.invoice_number,'')),
    'payable', b.total
  FROM public.bills b
  WHERE b.bill_type = 'purchase'
    AND b.payment_method = 'credit'
    AND b.party_id IS NOT NULL
    AND b.status = 'completed'

  UNION ALL

  SELECT
    e.party_id, e.org_id, e.created_at,
    'expense', e.id,
    e.label,
    'payable', e.amount
  FROM public.expenses e
  WHERE e.payment_method = 'credit'
    AND e.party_id IS NOT NULL

  UNION ALL

  SELECT
    ob.party_id, ob.org_id, ob.created_at,
    'opening_balance', ob.id,
    COALESCE(ob.note, 'Opening balance'),
    ob.direction, ob.amount
  FROM public.party_opening_balances ob

  UNION ALL

  SELECT
    p.party_id, p.org_id, p.created_at,
    'payment', p.id,
    COALESCE(p.note, 'Payment'),
    p.direction, -p.amount
  FROM public.party_payments p;

GRANT SELECT ON public.party_ledger TO authenticated;

-- ---- bill_items: allow deleting a line while a bill is still pending ----
GRANT DELETE ON public.bill_items TO authenticated;

DROP POLICY IF EXISTS "bill_items_delete" ON public.bill_items;
CREATE POLICY "bill_items_delete" ON public.bill_items FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.bills b WHERE b.id = bill_items.bill_id
                   AND b.user_id = auth.uid() AND public.can_write_shop(b.warehouse_id)));
