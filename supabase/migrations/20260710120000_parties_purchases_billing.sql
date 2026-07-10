
-- ============ PARTIES (replaces vendor_dues stopgap) ============
CREATE TABLE IF NOT EXISTS public.parties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  type text NOT NULL DEFAULT 'vendor' CHECK (type IN ('vendor', 'customer', 'both')),
  address text,
  state text,
  country text,
  phone text,
  email text,
  gst_no text,
  pan_no text,
  registration_type text,
  bank_account_no text,
  bank_ifsc text,
  bank_name text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.parties TO authenticated;
GRANT ALL ON public.parties TO service_role;
ALTER TABLE public.parties ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS parties_org_idx ON public.parties (org_id);

-- ============ PURCHASES (purchase voucher header + lines) ============
CREATE TABLE IF NOT EXISTS public.purchases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  warehouse_id uuid NOT NULL REFERENCES public.warehouses(id) ON DELETE RESTRICT,
  party_id uuid REFERENCES public.parties(id) ON DELETE SET NULL,
  invoice_number text,
  transaction_date date NOT NULL DEFAULT current_date,
  payment_method text NOT NULL DEFAULT 'cash' CHECK (payment_method IN ('cash', 'credit')),
  total numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.purchases TO authenticated;
GRANT ALL ON public.purchases TO service_role;
ALTER TABLE public.purchases ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS purchases_org_idx ON public.purchases (org_id, transaction_date DESC);
CREATE INDEX IF NOT EXISTS purchases_party_idx ON public.purchases (party_id);

CREATE TABLE IF NOT EXISTS public.purchase_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_id uuid NOT NULL REFERENCES public.purchases(id) ON DELETE CASCADE,
  item_id uuid REFERENCES public.inventory_items(id) ON DELETE SET NULL,
  item_name text NOT NULL,
  quantity integer NOT NULL CHECK (quantity > 0),
  cost_price numeric NOT NULL DEFAULT 0
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.purchase_items TO authenticated;
GRANT ALL ON public.purchase_items TO service_role;
ALTER TABLE public.purchase_items ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS purchase_items_purchase_idx ON public.purchase_items (purchase_id);

-- ============ LEDGER COLUMNS ON EXISTING TABLES ============
ALTER TABLE public.sales    ADD COLUMN IF NOT EXISTS party_id uuid REFERENCES public.parties(id) ON DELETE SET NULL;
ALTER TABLE public.sales    ADD COLUMN IF NOT EXISTS payment_method text NOT NULL DEFAULT 'cash' CHECK (payment_method IN ('cash', 'credit'));
ALTER TABLE public.sales    ADD COLUMN IF NOT EXISTS discount numeric NOT NULL DEFAULT 0;
ALTER TABLE public.sales    ADD COLUMN IF NOT EXISTS bill_id uuid;

ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS party_id uuid REFERENCES public.parties(id) ON DELETE SET NULL;
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS payment_method text NOT NULL DEFAULT 'cash' CHECK (payment_method IN ('cash', 'credit'));

-- Bills: one header row per "Create bill" submission, shop-scoped; sales rows reference bill_id.
CREATE TABLE IF NOT EXISTS public.bills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  warehouse_id uuid NOT NULL REFERENCES public.warehouses(id) ON DELETE RESTRICT,
  party_id uuid REFERENCES public.parties(id) ON DELETE SET NULL,
  payment_method text NOT NULL DEFAULT 'cash' CHECK (payment_method IN ('cash', 'credit')),
  discount numeric NOT NULL DEFAULT 0,
  total numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bills TO authenticated;
GRANT ALL ON public.bills TO service_role;
ALTER TABLE public.bills ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS bills_org_idx ON public.bills (org_id, created_at DESC);

ALTER TABLE public.sales ADD CONSTRAINT sales_bill_id_fkey
  FOREIGN KEY (bill_id) REFERENCES public.bills(id) ON DELETE SET NULL;

-- ============ RLS: parties ============
-- Visible to anyone in the org (accountants need it for reports/ledger), or the legacy owner.
CREATE POLICY "parties_select" ON public.parties FOR SELECT USING (public.can_read_row(user_id, org_id));
-- Writable by owner/manager/staff (not accountant) — same roles allowed to write inventory.
CREATE POLICY "parties_insert" ON public.parties FOR INSERT WITH CHECK (
  auth.uid() = user_id AND (public.current_org_id() IS NULL OR public.current_role() <> 'accountant')
);
CREATE POLICY "parties_update" ON public.parties FOR UPDATE USING (
  public.can_read_row(user_id, org_id) AND (public.current_org_id() IS NULL OR public.current_role() <> 'accountant')
) WITH CHECK (public.current_org_id() IS NULL OR public.current_role() <> 'accountant');
CREATE POLICY "parties_delete" ON public.parties FOR DELETE USING (
  public.can_read_row(user_id, org_id) AND (public.current_org_id() IS NULL OR public.current_role() <> 'accountant')
);

-- ============ RLS: purchases / purchase_items ============
CREATE POLICY "purchases_select" ON public.purchases FOR SELECT USING (public.can_read_row(user_id, org_id));
CREATE POLICY "purchases_insert" ON public.purchases FOR INSERT WITH CHECK (
  auth.uid() = user_id AND public.can_write_shop(warehouse_id)
);
CREATE POLICY "purchases_update" ON public.purchases FOR UPDATE USING (
  public.can_read_row(user_id, org_id) AND public.can_write_shop(warehouse_id)
);
CREATE POLICY "purchases_delete" ON public.purchases FOR DELETE USING (
  public.can_read_row(user_id, org_id) AND public.can_write_shop(warehouse_id)
);

CREATE POLICY "purchase_items_select" ON public.purchase_items FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.purchases p WHERE p.id = purchase_items.purchase_id AND public.can_read_row(p.user_id, p.org_id))
);
CREATE POLICY "purchase_items_insert" ON public.purchase_items FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM public.purchases p WHERE p.id = purchase_items.purchase_id AND p.user_id = auth.uid() AND public.can_write_shop(p.warehouse_id))
);
CREATE POLICY "purchase_items_update" ON public.purchase_items FOR UPDATE USING (
  EXISTS (SELECT 1 FROM public.purchases p WHERE p.id = purchase_items.purchase_id AND public.can_read_row(p.user_id, p.org_id) AND public.can_write_shop(p.warehouse_id))
);
CREATE POLICY "purchase_items_delete" ON public.purchase_items FOR DELETE USING (
  EXISTS (SELECT 1 FROM public.purchases p WHERE p.id = purchase_items.purchase_id AND public.can_read_row(p.user_id, p.org_id) AND public.can_write_shop(p.warehouse_id))
);

-- ============ RLS: bills ============
CREATE POLICY "bills_select" ON public.bills FOR SELECT USING (public.can_read_row(user_id, org_id));
CREATE POLICY "bills_insert" ON public.bills FOR INSERT WITH CHECK (
  auth.uid() = user_id AND public.can_write_shop(warehouse_id)
);
CREATE POLICY "bills_update" ON public.bills FOR UPDATE USING (
  public.can_read_row(user_id, org_id) AND public.can_write_shop(warehouse_id)
);
CREATE POLICY "bills_delete" ON public.bills FOR DELETE USING (
  public.can_read_row(user_id, org_id) AND public.can_write_shop(warehouse_id)
);

-- ============ auto-populate org_id + activity logging on new tables ============
DO $$ DECLARE t text; BEGIN
  FOR t IN SELECT unnest(ARRAY['parties', 'purchases', 'bills']) LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS set_org_id ON public.%I', t);
    EXECUTE format('CREATE TRIGGER set_org_id BEFORE INSERT ON public.%I FOR EACH ROW EXECUTE FUNCTION public.set_org_id_from_profile()', t);
    EXECUTE format('DROP TRIGGER IF EXISTS log_%I ON public.%I', t, t);
    EXECUTE format('CREATE TRIGGER log_%I AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.log_activity()', t, t);
  END LOOP;
END $$;
