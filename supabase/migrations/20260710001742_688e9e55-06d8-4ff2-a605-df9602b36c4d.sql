
CREATE OR REPLACE FUNCTION public.set_org_id_from_profile() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.org_id IS NULL AND auth.uid() IS NOT NULL THEN
    SELECT org_id INTO NEW.org_id FROM public.profiles WHERE id = auth.uid();
  END IF;
  RETURN NEW;
END; $$;

REVOKE EXECUTE ON FUNCTION public.set_org_id_from_profile() FROM anon, public;

DO $$ DECLARE t text; BEGIN
  FOR t IN SELECT unnest(ARRAY['warehouses','inventory_items','sales','stock_adjustments','expenses','vendor_dues']) LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS set_org_id ON public.%I', t);
    EXECUTE format('CREATE TRIGGER set_org_id BEFORE INSERT ON public.%I FOR EACH ROW EXECUTE FUNCTION public.set_org_id_from_profile()', t);
  END LOOP;
END $$;
