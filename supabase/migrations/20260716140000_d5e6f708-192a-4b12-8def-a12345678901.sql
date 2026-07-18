-- =========================================================================
-- "Alter entries" — Settings → Alter entries lets an owner/manager correct
-- a past bill (header + line items) or expense. `expenses` already allows
-- UPDATE; `bills`/`bill_items` only ever allowed INSERT, so this adds the
-- missing UPDATE grant + RLS policy, mirroring the existing INSERT policy's
-- shape (own row + write access to the bill's shop). The `bills_log` trigger
-- added in the bills migration already fires on UPDATE, so every alteration
-- is automatically recorded in `activity_log` — no extra plumbing needed.
-- =========================================================================

GRANT UPDATE ON public.bills TO authenticated;
GRANT UPDATE ON public.bill_items TO authenticated;

DROP POLICY IF EXISTS "bills_update" ON public.bills;
CREATE POLICY "bills_update" ON public.bills FOR UPDATE TO authenticated
  USING (auth.uid() = user_id AND public.can_write_shop(warehouse_id))
  WITH CHECK (auth.uid() = user_id AND public.can_write_shop(warehouse_id));

DROP POLICY IF EXISTS "bill_items_update" ON public.bill_items;
CREATE POLICY "bill_items_update" ON public.bill_items FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.bills b WHERE b.id = bill_items.bill_id
                   AND b.user_id = auth.uid() AND public.can_write_shop(b.warehouse_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.bills b WHERE b.id = bill_items.bill_id
                        AND b.user_id = auth.uid() AND public.can_write_shop(b.warehouse_id)));

-- Note: bill_items has no org_id column, and the generic log_activity()
-- trigger function unconditionally reads NEW.org_id, so it is NOT attached
-- here — attaching it would raise "record has no field org_id" on every
-- line-item update. The bill-level UPDATE trigger (bills_log, already
-- created alongside the bills table) captures the recomputed subtotal/
-- discount/total on every alteration, which is what shows up in the
-- Activity Log.
