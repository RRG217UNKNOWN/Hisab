-- =========================================================================
-- Backfill: every supplier/customer name ever typed into a bill becomes a
-- real `parties` row.
--
-- Before this, saving a bill without picking a name from the autocomplete
-- left `party_id` NULL and only stored the free-text name on the bill
-- itself (`supplier_name` / `customer_name`). Nothing ever created a
-- `parties` row for it, so those vendors/customers could never appear in
-- Vendors, Parties, or the "Add existing" picker — even though the user had
-- clearly "added" them by billing against that name repeatedly. (The app
-- code is fixed in the same change to stop this happening for new bills;
-- this migration catches up on data that already exists.)
-- =========================================================================

-- Purchases -> vendors
INSERT INTO public.parties (user_id, org_id, name, type, address, gst_no)
SELECT DISTINCT ON (b.user_id, lower(trim(b.supplier_name)))
  b.user_id, b.org_id, trim(b.supplier_name), 'vendor', b.supplier_address, b.supplier_gstin
FROM public.bills b
WHERE b.bill_type = 'purchase'
  AND b.party_id IS NULL
  AND b.supplier_name IS NOT NULL
  AND trim(b.supplier_name) <> ''
  AND NOT EXISTS (
    SELECT 1 FROM public.parties p
    WHERE p.user_id = b.user_id AND lower(trim(p.name)) = lower(trim(b.supplier_name))
  )
ORDER BY b.user_id, lower(trim(b.supplier_name)), b.invoice_date DESC;

-- Sales -> customers
INSERT INTO public.parties (user_id, org_id, name, type, address, gst_no)
SELECT DISTINCT ON (b.user_id, lower(trim(b.customer_name)))
  b.user_id, b.org_id, trim(b.customer_name), 'customer', b.customer_address, b.customer_gstin
FROM public.bills b
WHERE b.bill_type = 'sale'
  AND b.party_id IS NULL
  AND b.customer_name IS NOT NULL
  AND trim(b.customer_name) <> ''
  AND NOT EXISTS (
    SELECT 1 FROM public.parties p
    WHERE p.user_id = b.user_id AND lower(trim(p.name)) = lower(trim(b.customer_name))
  )
ORDER BY b.user_id, lower(trim(b.customer_name)), b.invoice_date DESC;

-- Link every bill that started this off (and any other bill matching the
-- same user + name) back to the party row it now has.
UPDATE public.bills b
SET party_id = p.id
FROM public.parties p
WHERE b.party_id IS NULL
  AND b.bill_type = 'purchase'
  AND b.supplier_name IS NOT NULL
  AND p.user_id = b.user_id
  AND lower(trim(p.name)) = lower(trim(b.supplier_name));

UPDATE public.bills b
SET party_id = p.id
FROM public.parties p
WHERE b.party_id IS NULL
  AND b.bill_type = 'sale'
  AND b.customer_name IS NOT NULL
  AND p.user_id = b.user_id
  AND lower(trim(p.name)) = lower(trim(b.customer_name));
