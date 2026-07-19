-- =========================================================================
-- Part 4 — Expense chart of accounts + transaction classification tags.
--
-- 1. `expense_items` is a reusable master list of standardized expense
--    names ("Chart of Accounts", Tally-style) so the Expenses form no
--    longer relies on free text (which caused "maggi" / "Maggi 90gm" /
--    "maggi 90 gms" to be treated as different things). `expenses` gains
--    an optional `expense_item_id` FK — existing rows keep their free-text
--    `label` untouched, new rows are expected to link to a chart item and
--    have their label mirrored from it for display/back-compat.
--    `usage_count` / `last_used_at` back the "most-used items float to the
--    top" requirement in the picker.
--
-- 2. `transaction_classifications` lets a user tag any transaction they
--    can reference (a bill, an expense, or just typed-in text) with a
--    type (Sales/Purchase/Expense/Payment/Receipt/Custom) plus a note, so
--    Reports can later filter/group by it. Transactions in this app span
--    several unrelated tables (bills, expenses, party_ledger) with no
--    single shared id, so this is intentionally a loose reference
--    (source_type + source_id when picked from a list, reference_label
--    always holds the human-readable text) rather than a hard FK.
-- =========================================================================

-- ============ expense_items ============
CREATE TABLE IF NOT EXISTS public.expense_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  org_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  name text NOT NULL,
  category text NOT NULL DEFAULT 'General',
  usage_count integer NOT NULL DEFAULT 0,
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- One canonical name per org (shared chart of accounts for a team) and,
-- for legacy/no-org users, per user.
CREATE UNIQUE INDEX IF NOT EXISTS expense_items_org_name_uidx
  ON public.expense_items (org_id, lower(name)) WHERE org_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS expense_items_user_name_uidx
  ON public.expense_items (user_id, lower(name)) WHERE org_id IS NULL;
CREATE INDEX IF NOT EXISTS expense_items_usage_idx
  ON public.expense_items (usage_count DESC, last_used_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.expense_items TO authenticated;
GRANT ALL ON public.expense_items TO service_role;
ALTER TABLE public.expense_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "expense_items_select" ON public.expense_items FOR SELECT
  USING (public.can_read_row(user_id, org_id));
CREATE POLICY "expense_items_insert" ON public.expense_items FOR INSERT
  WITH CHECK (auth.uid() = user_id AND public.current_role() IN ('owner', 'manager'));
CREATE POLICY "expense_items_update" ON public.expense_items FOR UPDATE
  USING (public.can_read_row(user_id, org_id) AND public.current_role() IN ('owner', 'manager'));
CREATE POLICY "expense_items_delete" ON public.expense_items FOR DELETE
  USING (public.can_read_row(user_id, org_id) AND public.current_role() IN ('owner', 'manager'));

-- Link expenses to a chart-of-accounts item. Nullable + ON DELETE SET NULL
-- so deleting a chart item never breaks past expense history (the label
-- column keeps the name it had at the time).
ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS expense_item_id uuid REFERENCES public.expense_items(id) ON DELETE SET NULL;

-- ============ transaction_classifications ============
CREATE TABLE IF NOT EXISTS public.transaction_classifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  org_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  reference_label text NOT NULL,
  source_type text CHECK (source_type IN ('bill', 'expense', 'manual')) NOT NULL DEFAULT 'manual',
  source_id uuid,
  classification text NOT NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS txn_class_source_idx
  ON public.transaction_classifications (source_type, source_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.transaction_classifications TO authenticated;
GRANT ALL ON public.transaction_classifications TO service_role;
ALTER TABLE public.transaction_classifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "txn_class_select" ON public.transaction_classifications FOR SELECT
  USING (public.can_read_row(user_id, org_id));
CREATE POLICY "txn_class_insert" ON public.transaction_classifications FOR INSERT
  WITH CHECK (auth.uid() = user_id AND public.current_role() IN ('owner', 'manager', 'accountant'));
CREATE POLICY "txn_class_update" ON public.transaction_classifications FOR UPDATE
  USING (public.can_read_row(user_id, org_id) AND public.current_role() IN ('owner', 'manager', 'accountant'));
CREATE POLICY "txn_class_delete" ON public.transaction_classifications FOR DELETE
  USING (public.can_read_row(user_id, org_id) AND public.current_role() IN ('owner', 'manager', 'accountant'));

-- Backfill: seed a starter chart of accounts per existing user from the
-- distinct expense labels they already have, so the picker isn't empty on
-- day one. Category left at the default 'General' — owners can re-tag.
INSERT INTO public.expense_items (user_id, org_id, name, category, usage_count, last_used_at, created_at)
SELECT DISTINCT ON (e.user_id, lower(e.label))
  e.user_id, e.org_id, e.label, 'General', 1, e.created_at, e.created_at
FROM public.expenses e
ORDER BY e.user_id, lower(e.label), e.created_at DESC
ON CONFLICT DO NOTHING;

-- Link existing expenses to their newly-seeded chart item where the name
-- matches exactly (case-insensitive), so history shows up standardized.
UPDATE public.expenses e
SET expense_item_id = ei.id
FROM public.expense_items ei
WHERE e.expense_item_id IS NULL
  AND ei.user_id = e.user_id
  AND lower(ei.name) = lower(e.label);
