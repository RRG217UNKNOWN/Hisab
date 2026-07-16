
-- =========================================================================
-- 1. SELLER IDENTITY (orgs + profiles)
-- =========================================================================
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS business_address text,
  ADD COLUMN IF NOT EXISTS gstin text,
  ADD COLUMN IF NOT EXISTS state text;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS business_address text,
  ADD COLUMN IF NOT EXISTS gstin text,
  ADD COLUMN IF NOT EXISTS state text;

-- =========================================================================
-- 2. PARTIES
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.parties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  type text NOT NULL CHECK (type IN ('vendor','customer','both')),
  address text,
  state text,
  country text DEFAULT 'India',
  phone text,
  email text,
  gst_no text,
  pan_no text,
  registration_type text,
  bank_account_no text,
  bank_ifsc text,
  bank_name text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.parties TO authenticated;
GRANT ALL ON public.parties TO service_role;
ALTER TABLE public.parties ENABLE ROW LEVEL SECURITY;

CREATE POLICY "parties_select" ON public.parties FOR SELECT TO authenticated
  USING (public.can_read_row(user_id, org_id));

CREATE POLICY "parties_insert" ON public.parties FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND (
      org_id IS NULL
      OR (org_id = public.current_org_id()
          AND public.current_role() IN ('owner','manager','accountant'))
    )
  );

CREATE POLICY "parties_update" ON public.parties FOR UPDATE TO authenticated
  USING (
    auth.uid() = user_id
    OR (org_id IS NOT NULL AND org_id = public.current_org_id()
        AND public.current_role() IN ('owner','manager','accountant'))
  );

CREATE POLICY "parties_delete" ON public.parties FOR DELETE TO authenticated
  USING (
    auth.uid() = user_id
    OR (org_id IS NOT NULL AND org_id = public.current_org_id()
        AND public.current_role() IN ('owner','manager'))
  );

CREATE TRIGGER parties_set_org BEFORE INSERT ON public.parties
  FOR EACH ROW EXECUTE FUNCTION public.set_org_id_from_profile();
CREATE TRIGGER parties_updated BEFORE UPDATE ON public.parties
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER parties_log AFTER INSERT OR UPDATE OR DELETE ON public.parties
  FOR EACH ROW EXECUTE FUNCTION public.log_activity();

-- =========================================================================
-- 3. EXPENSES: add party + payment method
-- =========================================================================
ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS party_id uuid REFERENCES public.parties(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS payment_method text CHECK (payment_method IN ('cash','credit')) DEFAULT 'cash';

-- =========================================================================
-- 4. PARTY PAYMENTS (settlements)
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.party_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  party_id uuid NOT NULL REFERENCES public.parties(id) ON DELETE CASCADE,
  amount numeric NOT NULL CHECK (amount >= 0),
  direction text NOT NULL CHECK (direction IN ('payable','receivable')),
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.party_payments TO authenticated;
GRANT ALL ON public.party_payments TO service_role;
ALTER TABLE public.party_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "party_payments_select" ON public.party_payments FOR SELECT TO authenticated
  USING (public.can_read_row(user_id, org_id));
CREATE POLICY "party_payments_insert" ON public.party_payments FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND (org_id IS NULL OR (org_id = public.current_org_id()
         AND public.current_role() IN ('owner','manager','accountant')))
  );
CREATE POLICY "party_payments_delete" ON public.party_payments FOR DELETE TO authenticated
  USING (
    auth.uid() = user_id
    OR (org_id IS NOT NULL AND org_id = public.current_org_id()
        AND public.current_role() IN ('owner','manager'))
  );

CREATE TRIGGER party_payments_set_org BEFORE INSERT ON public.party_payments
  FOR EACH ROW EXECUTE FUNCTION public.set_org_id_from_profile();
CREATE TRIGGER party_payments_log AFTER INSERT OR UPDATE OR DELETE ON public.party_payments
  FOR EACH ROW EXECUTE FUNCTION public.log_activity();

-- =========================================================================
-- 5. BILLS + BILL ITEMS
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.bills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  warehouse_id uuid NOT NULL REFERENCES public.warehouses(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  bill_type text NOT NULL DEFAULT 'sale' CHECK (bill_type IN ('sale','purchase')),
  invoice_number text,
  invoice_date date NOT NULL DEFAULT current_date,
  party_id uuid REFERENCES public.parties(id) ON DELETE SET NULL,
  customer_name text,
  customer_address text,
  customer_gstin text,
  place_of_supply text,
  reverse_charge boolean NOT NULL DEFAULT false,
  supplier_invoice_number text,
  supplier_name text,
  supplier_gstin text,
  supplier_address text,
  payment_method text CHECK (payment_method IN ('cash','credit')) DEFAULT 'cash',
  subtotal numeric NOT NULL DEFAULT 0,
  discount_type text CHECK (discount_type IN ('flat','percent')),
  discount_value numeric NOT NULL DEFAULT 0,
  discount_amount numeric NOT NULL DEFAULT 0,
  total numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'completed',
  fulfills_request_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.bills TO authenticated;
GRANT ALL ON public.bills TO service_role;
ALTER TABLE public.bills ENABLE ROW LEVEL SECURITY;

CREATE POLICY "bills_select" ON public.bills FOR SELECT TO authenticated
  USING (public.can_read_row(user_id, org_id));
CREATE POLICY "bills_insert" ON public.bills FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id AND public.can_write_shop(warehouse_id));

CREATE TRIGGER bills_set_org BEFORE INSERT ON public.bills
  FOR EACH ROW EXECUTE FUNCTION public.set_org_id_from_profile();
CREATE TRIGGER bills_log AFTER INSERT OR UPDATE OR DELETE ON public.bills
  FOR EACH ROW EXECUTE FUNCTION public.log_activity();

CREATE TABLE IF NOT EXISTS public.bill_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_id uuid NOT NULL REFERENCES public.bills(id) ON DELETE CASCADE,
  item_id uuid REFERENCES public.inventory_items(id) ON DELETE SET NULL,
  item_name text NOT NULL,
  quantity integer NOT NULL CHECK (quantity > 0),
  unit_price numeric NOT NULL DEFAULT 0,
  unit_cost numeric NOT NULL DEFAULT 0,
  line_discount numeric NOT NULL DEFAULT 0,
  line_total numeric NOT NULL DEFAULT 0,
  hsn_sac_code text,
  gst_rate numeric NOT NULL DEFAULT 0,
  taxable_value numeric NOT NULL DEFAULT 0,
  cgst_amount numeric NOT NULL DEFAULT 0,
  sgst_amount numeric NOT NULL DEFAULT 0,
  igst_amount numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.bill_items TO authenticated;
GRANT ALL ON public.bill_items TO service_role;
ALTER TABLE public.bill_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "bill_items_select" ON public.bill_items FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.bills b WHERE b.id = bill_items.bill_id
                   AND public.can_read_row(b.user_id, b.org_id)));
CREATE POLICY "bill_items_insert" ON public.bill_items FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.bills b WHERE b.id = bill_items.bill_id
                        AND b.user_id = auth.uid()
                        AND public.can_write_shop(b.warehouse_id)));

-- =========================================================================
-- 6. BILL COUNTERS + next_invoice_number RPC
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.bill_counters (
  scope_id uuid NOT NULL,
  bill_type text NOT NULL CHECK (bill_type IN ('sale','purchase')),
  next_number integer NOT NULL DEFAULT 1,
  PRIMARY KEY (scope_id, bill_type)
);
GRANT SELECT, INSERT, UPDATE ON public.bill_counters TO authenticated;
GRANT ALL ON public.bill_counters TO service_role;
ALTER TABLE public.bill_counters ENABLE ROW LEVEL SECURITY;
CREATE POLICY "bill_counters_all" ON public.bill_counters FOR ALL TO authenticated
  USING (scope_id = COALESCE(public.current_org_id(), auth.uid()))
  WITH CHECK (scope_id = COALESCE(public.current_org_id(), auth.uid()));

CREATE OR REPLACE FUNCTION public.next_invoice_number(_bill_type text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  scope uuid;
  n integer;
  prefix text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF _bill_type NOT IN ('sale','purchase') THEN RAISE EXCEPTION 'Invalid bill_type'; END IF;
  scope := COALESCE(public.current_org_id(), auth.uid());
  INSERT INTO public.bill_counters (scope_id, bill_type, next_number)
    VALUES (scope, _bill_type, 2)
    ON CONFLICT (scope_id, bill_type) DO UPDATE
      SET next_number = public.bill_counters.next_number + 1
    RETURNING (public.bill_counters.next_number - 1) INTO n;
  prefix := CASE WHEN _bill_type = 'sale' THEN 'INV-' ELSE 'PUR-' END;
  RETURN prefix || lpad(n::text, 5, '0');
END;
$$;

-- =========================================================================
-- 7. PARTY LEDGER VIEW (unified)
-- =========================================================================
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

  -- Payments reduce the corresponding side (stored as negative amount so
  -- summing per direction yields net outstanding).
  SELECT
    p.party_id, p.org_id, p.created_at,
    'payment', p.id,
    COALESCE(p.note, 'Payment'),
    p.direction, -p.amount
  FROM public.party_payments p;

GRANT SELECT ON public.party_ledger TO authenticated;

-- =========================================================================
-- 8. PARTNER ORGS (connections)
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.partner_orgs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  partner_org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  added_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','connected')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, partner_org_id),
  CHECK (org_id <> partner_org_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.partner_orgs TO authenticated;
GRANT ALL ON public.partner_orgs TO service_role;
ALTER TABLE public.partner_orgs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "partner_orgs_select" ON public.partner_orgs FOR SELECT TO authenticated
  USING (org_id = public.current_org_id() OR partner_org_id = public.current_org_id());
CREATE POLICY "partner_orgs_insert" ON public.partner_orgs FOR INSERT TO authenticated
  WITH CHECK (public.current_role() = 'owner' AND org_id = public.current_org_id());
CREATE POLICY "partner_orgs_update" ON public.partner_orgs FOR UPDATE TO authenticated
  USING (public.current_role() = 'owner'
         AND (partner_org_id = public.current_org_id() OR org_id = public.current_org_id()));
CREATE POLICY "partner_orgs_delete" ON public.partner_orgs FOR DELETE TO authenticated
  USING (public.current_role() = 'owner'
         AND (org_id = public.current_org_id() OR partner_org_id = public.current_org_id()));

-- =========================================================================
-- 9. REQUESTS
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  to_org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','declined','fulfilled')),
  narration text,
  responded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  fulfilling_warehouse_id uuid REFERENCES public.warehouses(id) ON DELETE SET NULL,
  order_completed_at timestamptz,
  bill_id uuid REFERENCES public.bills(id) ON DELETE SET NULL,
  payment_received numeric NOT NULL DEFAULT 0,
  payment_status text NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid','partial','paid')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (from_org_id <> to_org_id)
);
GRANT SELECT, INSERT, UPDATE ON public.requests TO authenticated;
GRANT ALL ON public.requests TO service_role;
ALTER TABLE public.requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "requests_select" ON public.requests FOR SELECT TO authenticated
  USING (from_org_id = public.current_org_id() OR to_org_id = public.current_org_id());

CREATE POLICY "requests_insert" ON public.requests FOR INSERT TO authenticated
  WITH CHECK (
    public.current_role() = 'owner'
    AND from_org_id = public.current_org_id()
    AND EXISTS (
      SELECT 1 FROM public.partner_orgs po
      WHERE po.status = 'connected'
        AND ((po.org_id = from_org_id AND po.partner_org_id = to_org_id)
          OR (po.org_id = to_org_id AND po.partner_org_id = from_org_id))
    )
  );

CREATE POLICY "requests_update_receiver" ON public.requests FOR UPDATE TO authenticated
  USING (
    (public.current_role() = 'owner' AND to_org_id = public.current_org_id())
    OR (public.current_role() IN ('owner','manager')
        AND to_org_id = public.current_org_id()
        AND (fulfilling_warehouse_id IS NULL OR public.can_write_shop(fulfilling_warehouse_id)))
    OR (public.current_role() = 'owner' AND from_org_id = public.current_org_id())
  );

CREATE TRIGGER requests_log AFTER INSERT OR UPDATE OR DELETE ON public.requests
  FOR EACH ROW EXECUTE FUNCTION public.log_activity();
