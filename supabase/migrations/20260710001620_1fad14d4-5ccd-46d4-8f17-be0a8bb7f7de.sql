
-- ============ ENUMS ============
DO $$ BEGIN
  CREATE TYPE public.app_role AS ENUM ('owner','manager','staff','accountant');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============ ORGANIZATIONS ============
CREATE TABLE IF NOT EXISTS public.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_code text NOT NULL UNIQUE,
  name text NOT NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.organizations TO authenticated;
GRANT ALL ON public.organizations TO service_role;
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;

-- ============ EXTEND PROFILES ============
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS role public.app_role NOT NULL DEFAULT 'owner';

-- ============ MEMBER SHOPS ============
CREATE TABLE IF NOT EXISTS public.member_shops (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  warehouse_id uuid NOT NULL REFERENCES public.warehouses(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (profile_id, warehouse_id)
);
GRANT SELECT, INSERT, DELETE ON public.member_shops TO authenticated;
GRANT ALL ON public.member_shops TO service_role;
ALTER TABLE public.member_shops ENABLE ROW LEVEL SECURITY;

-- ============ INVITES ============
CREATE TABLE IF NOT EXISTS public.invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  warehouse_ids uuid[] NOT NULL DEFAULT '{}',
  invited_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','revoked')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS invites_email_idx ON public.invites (lower(email));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.invites TO authenticated;
GRANT ALL ON public.invites TO service_role;
ALTER TABLE public.invites ENABLE ROW LEVEL SECURITY;

-- ============ ACTIVITY LOG ============
CREATE TABLE IF NOT EXISTS public.activity_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  changes jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS activity_log_org_idx ON public.activity_log (org_id, created_at DESC);
GRANT SELECT, INSERT ON public.activity_log TO authenticated;
GRANT ALL ON public.activity_log TO service_role;
ALTER TABLE public.activity_log ENABLE ROW LEVEL SECURITY;

-- ============ VENDOR DUES ============
CREATE TABLE IF NOT EXISTS public.vendor_dues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  org_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  warehouse_id uuid REFERENCES public.warehouses(id) ON DELETE SET NULL,
  vendor_name text NOT NULL,
  category text NOT NULL DEFAULT 'General',
  amount numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','settled','owed')),
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vendor_dues TO authenticated;
GRANT ALL ON public.vendor_dues TO service_role;
ALTER TABLE public.vendor_dues ENABLE ROW LEVEL SECURITY;

-- ============ ADD org_id TO EXISTING TABLES ============
ALTER TABLE public.warehouses       ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL;
ALTER TABLE public.inventory_items  ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL;
ALTER TABLE public.sales            ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL;
ALTER TABLE public.stock_adjustments ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL;
ALTER TABLE public.expenses         ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL;

-- ============ HELPER FUNCTIONS ============
CREATE OR REPLACE FUNCTION public.current_org_id() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT org_id FROM public.profiles WHERE id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.current_role() RETURNS public.app_role
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.can_read_row(row_user_id uuid, row_org_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    auth.uid() = row_user_id
    OR (
      row_org_id IS NOT NULL
      AND row_org_id = (SELECT org_id FROM public.profiles WHERE id = auth.uid())
    );
$$;

CREATE OR REPLACE FUNCTION public.can_write_shop(row_warehouse_id uuid) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r public.app_role;
  o uuid;
  has_scope boolean;
  is_member boolean;
BEGIN
  SELECT role, org_id INTO r, o FROM public.profiles WHERE id = auth.uid();
  IF r IS NULL THEN RETURN false; END IF;
  IF r = 'accountant' THEN RETURN false; END IF;
  IF o IS NULL THEN RETURN true; END IF;
  IF r = 'owner' THEN RETURN true; END IF;
  IF row_warehouse_id IS NULL THEN RETURN false; END IF;
  SELECT EXISTS(SELECT 1 FROM public.member_shops WHERE profile_id = auth.uid()) INTO has_scope;
  IF NOT has_scope THEN RETURN true; END IF;
  SELECT EXISTS(SELECT 1 FROM public.member_shops WHERE profile_id = auth.uid() AND warehouse_id = row_warehouse_id) INTO is_member;
  RETURN is_member;
END; $$;

-- ============ ORG RPCs ============
CREATE OR REPLACE FUNCTION public.generate_org_code() RETURNS text
LANGUAGE plpgsql AS $$
DECLARE chars text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; result text := ''; i int;
BEGIN
  FOR i IN 1..10 LOOP
    result := result || substr(chars, floor(random()*length(chars))::int + 1, 1);
  END LOOP;
  RETURN result;
END; $$;

CREATE OR REPLACE FUNCTION public.create_organization(_name text) RETURNS TABLE(id uuid, org_code text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE new_id uuid; new_code text; tries int := 0;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  LOOP
    new_code := public.generate_org_code();
    BEGIN
      INSERT INTO public.organizations (org_code, name, created_by)
      VALUES (new_code, _name, auth.uid()) RETURNING organizations.id INTO new_id;
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      tries := tries + 1; IF tries > 5 THEN RAISE; END IF;
    END;
  END LOOP;
  UPDATE public.profiles SET org_id = new_id, role = 'owner' WHERE profiles.id = auth.uid();
  RETURN QUERY SELECT new_id, new_code;
END; $$;

CREATE OR REPLACE FUNCTION public.join_organization(_code text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE org_row record;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT * INTO org_row FROM public.organizations WHERE org_code = upper(_code);
  IF org_row.id IS NULL THEN RAISE EXCEPTION 'Invalid org code'; END IF;
  UPDATE public.profiles SET org_id = org_row.id, role = COALESCE(role, 'staff') WHERE id = auth.uid();
  RETURN org_row.id;
END; $$;

CREATE OR REPLACE FUNCTION public.verify_org_code(_code text) RETURNS TABLE(id uuid, name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id, name FROM public.organizations WHERE org_code = upper(_code);
$$;

-- ============ UPDATED handle_new_user ============
CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE inv record;
BEGIN
  INSERT INTO public.profiles (id, full_name, phone)
  VALUES (NEW.id, NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'phone');

  SELECT * INTO inv FROM public.invites
    WHERE lower(email) = lower(NEW.email) AND status = 'pending'
    ORDER BY created_at DESC LIMIT 1;
  IF inv.id IS NOT NULL THEN
    UPDATE public.profiles SET org_id = inv.org_id, role = inv.role WHERE id = NEW.id;
    IF array_length(inv.warehouse_ids, 1) > 0 THEN
      INSERT INTO public.member_shops (profile_id, warehouse_id)
      SELECT NEW.id, unnest(inv.warehouse_ids)
      ON CONFLICT DO NOTHING;
    END IF;
    UPDATE public.invites SET status = 'accepted' WHERE id = inv.id;
  END IF;
  RETURN NEW;
END; $$;

-- ============ PROTECT ORG CREATOR ROLE ============
CREATE OR REPLACE FUNCTION public.protect_owner_role() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE creator uuid;
BEGIN
  IF NEW.role IS DISTINCT FROM OLD.role AND OLD.org_id IS NOT NULL THEN
    SELECT created_by INTO creator FROM public.organizations WHERE id = OLD.org_id;
    IF creator = OLD.id AND auth.uid() <> OLD.id THEN
      RAISE EXCEPTION 'Cannot change role of the organization creator';
    END IF;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS protect_owner_role ON public.profiles;
CREATE TRIGGER protect_owner_role BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.protect_owner_role();

-- ============ ACTIVITY LOGGING TRIGGER ============
CREATE OR REPLACE FUNCTION public.log_activity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE action_str text; entity text; entity_id_val uuid; changes_json jsonb; o uuid;
BEGIN
  entity := TG_TABLE_NAME;
  IF TG_OP = 'INSERT' THEN
    action_str := entity || '.created';
    entity_id_val := NEW.id;
    changes_json := to_jsonb(NEW);
    o := NEW.org_id;
  ELSIF TG_OP = 'UPDATE' THEN
    action_str := entity || '.updated';
    entity_id_val := NEW.id;
    changes_json := jsonb_build_object('old', to_jsonb(OLD), 'new', to_jsonb(NEW));
    o := NEW.org_id;
  ELSE
    action_str := entity || '.deleted';
    entity_id_val := OLD.id;
    changes_json := to_jsonb(OLD);
    o := OLD.org_id;
  END IF;
  INSERT INTO public.activity_log (org_id, user_id, action, entity_type, entity_id, changes)
  VALUES (o, auth.uid(), action_str, entity, entity_id_val, changes_json);
  RETURN COALESCE(NEW, OLD);
END; $$;

DROP TRIGGER IF EXISTS log_inventory ON public.inventory_items;
CREATE TRIGGER log_inventory AFTER INSERT OR UPDATE OR DELETE ON public.inventory_items
  FOR EACH ROW EXECUTE FUNCTION public.log_activity();

DROP TRIGGER IF EXISTS log_sales ON public.sales;
CREATE TRIGGER log_sales AFTER INSERT OR UPDATE OR DELETE ON public.sales
  FOR EACH ROW EXECUTE FUNCTION public.log_activity();

DROP TRIGGER IF EXISTS log_stock_adj ON public.stock_adjustments;
CREATE TRIGGER log_stock_adj AFTER INSERT OR UPDATE OR DELETE ON public.stock_adjustments
  FOR EACH ROW EXECUTE FUNCTION public.log_activity();

DROP TRIGGER IF EXISTS log_expenses ON public.expenses;
CREATE TRIGGER log_expenses AFTER INSERT OR UPDATE OR DELETE ON public.expenses
  FOR EACH ROW EXECUTE FUNCTION public.log_activity();

-- ============ REPLACE OLD RLS POLICIES ============
-- profiles
DROP POLICY IF EXISTS "Users view own profile" ON public.profiles;
CREATE POLICY "profiles_select" ON public.profiles FOR SELECT USING (
  id = auth.uid()
  OR (org_id IS NOT NULL AND org_id = public.current_org_id())
);

-- organizations
DROP POLICY IF EXISTS "org_select" ON public.organizations;
CREATE POLICY "org_select" ON public.organizations FOR SELECT USING (
  id = public.current_org_id() OR created_by = auth.uid()
);
DROP POLICY IF EXISTS "org_update" ON public.organizations;
CREATE POLICY "org_update" ON public.organizations FOR UPDATE USING (
  id = public.current_org_id() AND public.current_role() = 'owner'
);

-- member_shops
DROP POLICY IF EXISTS "ms_select" ON public.member_shops;
CREATE POLICY "ms_select" ON public.member_shops FOR SELECT USING (
  profile_id = auth.uid()
  OR EXISTS(SELECT 1 FROM public.profiles p WHERE p.id = member_shops.profile_id
            AND p.org_id = public.current_org_id()
            AND public.current_role() IN ('owner','manager'))
);
DROP POLICY IF EXISTS "ms_insert" ON public.member_shops;
CREATE POLICY "ms_insert" ON public.member_shops FOR INSERT WITH CHECK (
  public.current_role() = 'owner'
  AND EXISTS(SELECT 1 FROM public.profiles p WHERE p.id = profile_id AND p.org_id = public.current_org_id())
);
DROP POLICY IF EXISTS "ms_delete" ON public.member_shops;
CREATE POLICY "ms_delete" ON public.member_shops FOR DELETE USING (
  public.current_role() = 'owner'
  AND EXISTS(SELECT 1 FROM public.profiles p WHERE p.id = profile_id AND p.org_id = public.current_org_id())
);

-- invites
DROP POLICY IF EXISTS "invites_select" ON public.invites;
CREATE POLICY "invites_select" ON public.invites FOR SELECT USING (
  org_id = public.current_org_id() AND public.current_role() IN ('owner','manager')
);
DROP POLICY IF EXISTS "invites_insert" ON public.invites;
CREATE POLICY "invites_insert" ON public.invites FOR INSERT WITH CHECK (
  public.current_role() = 'owner' AND org_id = public.current_org_id() AND invited_by = auth.uid()
);
DROP POLICY IF EXISTS "invites_update" ON public.invites;
CREATE POLICY "invites_update" ON public.invites FOR UPDATE USING (
  public.current_role() = 'owner' AND org_id = public.current_org_id()
);
DROP POLICY IF EXISTS "invites_delete" ON public.invites;
CREATE POLICY "invites_delete" ON public.invites FOR DELETE USING (
  public.current_role() = 'owner' AND org_id = public.current_org_id()
);

-- activity_log
DROP POLICY IF EXISTS "act_select" ON public.activity_log;
CREATE POLICY "act_select" ON public.activity_log FOR SELECT USING (
  org_id = public.current_org_id() AND public.current_role() IN ('owner','accountant')
);

-- warehouses
DROP POLICY IF EXISTS "Users select own warehouses" ON public.warehouses;
DROP POLICY IF EXISTS "Users insert own warehouses" ON public.warehouses;
DROP POLICY IF EXISTS "Users update own warehouses" ON public.warehouses;
DROP POLICY IF EXISTS "Users delete own warehouses" ON public.warehouses;
CREATE POLICY "wh_select" ON public.warehouses FOR SELECT USING (public.can_read_row(user_id, org_id));
CREATE POLICY "wh_insert" ON public.warehouses FOR INSERT WITH CHECK (
  auth.uid() = user_id AND (public.current_org_id() IS NULL OR public.current_role() = 'owner')
);
CREATE POLICY "wh_update" ON public.warehouses FOR UPDATE USING (
  public.can_read_row(user_id, org_id) AND (public.current_org_id() IS NULL OR public.current_role() = 'owner')
);
CREATE POLICY "wh_delete" ON public.warehouses FOR DELETE USING (
  public.can_read_row(user_id, org_id) AND (public.current_org_id() IS NULL OR public.current_role() = 'owner')
);

-- inventory_items
DROP POLICY IF EXISTS "Users select own items" ON public.inventory_items;
DROP POLICY IF EXISTS "Users insert own items" ON public.inventory_items;
DROP POLICY IF EXISTS "Users update own items" ON public.inventory_items;
DROP POLICY IF EXISTS "Users delete own items" ON public.inventory_items;
CREATE POLICY "inv_select" ON public.inventory_items FOR SELECT USING (public.can_read_row(user_id, org_id));
CREATE POLICY "inv_insert" ON public.inventory_items FOR INSERT WITH CHECK (
  auth.uid() = user_id AND public.can_write_shop(warehouse_id)
);
CREATE POLICY "inv_update" ON public.inventory_items FOR UPDATE USING (
  public.can_read_row(user_id, org_id) AND public.can_write_shop(warehouse_id)
) WITH CHECK (public.can_write_shop(warehouse_id));
CREATE POLICY "inv_delete" ON public.inventory_items FOR DELETE USING (
  public.can_read_row(user_id, org_id) AND public.can_write_shop(warehouse_id)
);

-- sales
DROP POLICY IF EXISTS "Users select own sales" ON public.sales;
DROP POLICY IF EXISTS "Users insert own sales" ON public.sales;
DROP POLICY IF EXISTS "Users update own sales" ON public.sales;
DROP POLICY IF EXISTS "Users delete own sales" ON public.sales;
CREATE POLICY "sales_select" ON public.sales FOR SELECT USING (public.can_read_row(user_id, org_id));
CREATE POLICY "sales_insert" ON public.sales FOR INSERT WITH CHECK (
  auth.uid() = user_id AND public.can_write_shop(warehouse_id)
);
CREATE POLICY "sales_update" ON public.sales FOR UPDATE USING (
  public.can_read_row(user_id, org_id) AND public.can_write_shop(warehouse_id)
);
CREATE POLICY "sales_delete" ON public.sales FOR DELETE USING (
  public.can_read_row(user_id, org_id) AND public.can_write_shop(warehouse_id)
);

-- stock_adjustments
DROP POLICY IF EXISTS "Users select own adjustments" ON public.stock_adjustments;
DROP POLICY IF EXISTS "Users insert own adjustments" ON public.stock_adjustments;
CREATE POLICY "adj_select" ON public.stock_adjustments FOR SELECT USING (public.can_read_row(user_id, org_id));
CREATE POLICY "adj_insert" ON public.stock_adjustments FOR INSERT WITH CHECK (auth.uid() = user_id);

-- expenses
DROP POLICY IF EXISTS "Users select own expenses" ON public.expenses;
DROP POLICY IF EXISTS "Users insert own expenses" ON public.expenses;
DROP POLICY IF EXISTS "Users update own expenses" ON public.expenses;
DROP POLICY IF EXISTS "Users delete own expenses" ON public.expenses;
CREATE POLICY "exp_select" ON public.expenses FOR SELECT USING (public.can_read_row(user_id, org_id));
CREATE POLICY "exp_insert" ON public.expenses FOR INSERT WITH CHECK (
  auth.uid() = user_id AND (public.current_role() IN ('owner','manager'))
);
CREATE POLICY "exp_update" ON public.expenses FOR UPDATE USING (
  public.can_read_row(user_id, org_id) AND public.current_role() IN ('owner','manager')
);
CREATE POLICY "exp_delete" ON public.expenses FOR DELETE USING (
  public.can_read_row(user_id, org_id) AND public.current_role() IN ('owner','manager')
);

-- vendor_dues
CREATE POLICY "vd_select" ON public.vendor_dues FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "vd_insert" ON public.vendor_dues FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "vd_update" ON public.vendor_dues FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "vd_delete" ON public.vendor_dues FOR DELETE USING (auth.uid() = user_id);

-- ============ updated_at triggers on new tables ============
DROP TRIGGER IF EXISTS set_updated_at_org ON public.organizations;
CREATE TRIGGER set_updated_at_org BEFORE UPDATE ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
