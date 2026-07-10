import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2, ClipboardList } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/hooks/use-auth";
import { useProfile } from "@/hooks/use-profile";
import { supabase } from "@/integrations/supabase/client";
import { can } from "@/lib/permissions";

export const Route = createFileRoute("/purchase-voucher")({
  component: PurchaseVoucherPage,
  head: () => ({
    meta: [
      { title: "Purchase Voucher · Hisab" },
      { name: "description", content: "Record a supplier purchase, add stock, and post it to the party ledger." },
    ],
  }),
});

type Warehouse = { id: string; name: string };
type Party = { id: string; name: string; type: string };
type InvItem = { id: string; name: string; stock: number; cost_price: number; warehouse_id: string };

type Line = {
  key: string;
  itemId: string | null; // null = new item
  name: string;
  quantity: string;
  costPrice: string;
};

const inr = (n: number) => "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
const newLine = (): Line => ({ key: crypto.randomUUID(), itemId: null, name: "", quantity: "1", costPrice: "0" });

function PurchaseVoucherPage() {
  const { user } = useAuth();
  const { profile } = useProfile();
  const navigate = useNavigate();
  const role = profile?.role;
  const allowed = can.writeInventory(role);

  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [parties, setParties] = useState<Party[]>([]);
  const [items, setItems] = useState<InvItem[]>([]);
  const [warehouseId, setWarehouseId] = useState("");
  const [partyId, setPartyId] = useState<string>("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "credit">("cash");
  const [lines, setLines] = useState<Line[]>([newLine()]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!user) return;
    void (async () => {
      const [wh, pa, it] = await Promise.all([
        supabase.from("warehouses").select("id, name").order("name"),
        supabase.from("parties").select("id, name, type").order("name"),
        supabase.from("inventory_items").select("id, name, stock, cost_price, warehouse_id").order("name"),
      ]);
      setWarehouses((wh.data as Warehouse[] | null) ?? []);
      setParties(((pa.data as Party[] | null) ?? []).filter((p) => p.type !== "customer"));
      setItems((it.data as InvItem[] | null) ?? []);
      if (wh.data && wh.data.length > 0) setWarehouseId((wh.data as Warehouse[])[0].id);
    })();
  }, [user]);

  const itemsInShop = useMemo(() => items.filter((i) => i.warehouse_id === warehouseId), [items, warehouseId]);

  const total = useMemo(
    () => lines.reduce((sum, l) => sum + (Number(l.quantity) || 0) * (Number(l.costPrice) || 0), 0),
    [lines],
  );

  const updateLine = (key: string, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const removeLine = (key: string) => setLines((ls) => (ls.length > 1 ? ls.filter((l) => l.key !== key) : ls));

  const pickExisting = (key: string, itemId: string) => {
    const match = itemsInShop.find((i) => i.id === itemId);
    if (!match) return;
    updateLine(key, { itemId: match.id, name: match.name, costPrice: String(match.cost_price) });
  };

  const submit = async () => {
    setErr(null);
    if (!user || !warehouseId) {
      setErr("Pick a shop");
      return;
    }
    const parsedLines = lines.map((l) => ({
      ...l,
      qty: Number(l.quantity),
      cost: Number(l.costPrice),
    }));
    for (const l of parsedLines) {
      if (!l.name.trim()) {
        setErr("Every line needs a product name");
        return;
      }
      if (!Number.isFinite(l.qty) || l.qty <= 0 || !Number.isInteger(l.qty)) {
        setErr("Enter a valid quantity for each line");
        return;
      }
      if (!Number.isFinite(l.cost) || l.cost < 0) {
        setErr("Enter a valid cost price for each line");
        return;
      }
    }

    setBusy(true);
    // 1. Create the purchase header
    const { data: purchase, error: purchaseErr } = await supabase
      .from("purchases")
      .insert({
        user_id: user.id,
        warehouse_id: warehouseId,
        party_id: partyId || null,
        invoice_number: invoiceNumber.trim() || null,
        transaction_date: date,
        payment_method: paymentMethod,
        total,
      })
      .select("id")
      .single();
    if (purchaseErr || !purchase) {
      setBusy(false);
      setErr(purchaseErr?.message ?? "Could not create purchase");
      return;
    }

    // 2. For each line: add to existing stock, or create a new item; then log the purchase line.
    for (const l of parsedLines) {
      let itemId = l.itemId;
      if (itemId) {
        const existing = items.find((i) => i.id === itemId);
        if (existing) {
          const { error: updErr } = await supabase
            .from("inventory_items")
            .update({ stock: existing.stock + l.qty, cost_price: l.cost })
            .eq("id", itemId);
          if (updErr) {
            setBusy(false);
            setErr(updErr.message);
            return;
          }
          await supabase.from("stock_adjustments").insert({
            user_id: user.id,
            item_id: itemId,
            new_stock: existing.stock + l.qty,
            reason: `Purchase voucher${invoiceNumber ? ` · Inv #${invoiceNumber}` : ""}`,
          });
        }
      } else {
        const { data: created, error: createErr } = await supabase
          .from("inventory_items")
          .insert({
            user_id: user.id,
            warehouse_id: warehouseId,
            name: l.name.trim(),
            stock: l.qty,
            cost_price: l.cost,
            price: l.cost,
          })
          .select("id")
          .single();
        if (createErr || !created) {
          setBusy(false);
          setErr(createErr?.message ?? "Could not create item");
          return;
        }
        itemId = created.id;
      }

      const { error: lineErr } = await supabase.from("purchase_items").insert({
        purchase_id: purchase.id,
        item_id: itemId,
        item_name: l.name.trim(),
        quantity: l.qty,
        cost_price: l.cost,
      });
      if (lineErr) {
        setBusy(false);
        setErr(lineErr.message);
        return;
      }
    }

    setBusy(false);
    setDone(true);
  };

  if (!allowed) {
    return (
      <AppShell active="purchase-voucher" title="Purchase Voucher">
        <div className="px-4 md:px-10 py-10 text-sm text-muted-foreground">
          You don't have permission to record purchases.
        </div>
      </AppShell>
    );
  }

  if (done) {
    return (
      <AppShell active="purchase-voucher" title="Purchase Voucher">
        <div className="px-4 md:px-10 py-10 max-w-md space-y-4">
          <p className="text-sm text-ink">Purchase voucher recorded — stock updated and ledger entry posted.</p>
          <div className="flex gap-2">
            <button
              onClick={() => {
                setDone(false);
                setLines([newLine()]);
                setInvoiceNumber("");
                setPartyId("");
              }}
              className="rounded-lg bg-primary text-primary-foreground px-4 py-2 text-sm"
            >
              Add another
            </button>
            <button onClick={() => navigate({ to: "/inventory" })} className="rounded-lg border border-border px-4 py-2 text-sm">
              Go to Inventory
            </button>
          </div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell active="purchase-voucher" title="Purchase Voucher">
      <div className="px-4 md:px-10 py-6 md:py-8 space-y-6 max-w-3xl">
        <div>
          <p className="text-xs uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
            <ClipboardList size={13} /> Purchasing
          </p>
          <h1 className="mt-1 font-display text-3xl text-ink">Purchase Voucher</h1>
        </div>

        <section className="card-warm p-4 md:p-6 space-y-4">
          <div className="grid sm:grid-cols-2 gap-3">
            <LField label="Shop">
              <select
                value={warehouseId}
                onChange={(e) => setWarehouseId(e.target.value)}
                className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm"
              >
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </LField>
            <LField label="Vendor (party)">
              <select
                value={partyId}
                onChange={(e) => setPartyId(e.target.value)}
                className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm"
              >
                <option value="">— No party —</option>
                {parties.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </LField>
            <LField label="Supplier invoice number">
              <input
                value={invoiceNumber}
                onChange={(e) => setInvoiceNumber(e.target.value)}
                className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm"
              />
            </LField>
            <LField label="Transaction date">
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm"
              />
            </LField>
          </div>

          <LField label="Payment method">
            <div className="flex gap-2">
              {(["cash", "credit"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setPaymentMethod(m)}
                  className={`flex-1 rounded-lg border px-3 py-2 text-sm capitalize ${
                    paymentMethod === m ? "border-primary bg-primary/10 text-ink" : "border-border text-muted-foreground"
                  }`}
                >
                  {m === "cash" ? "Paid by cash" : "On credit"}
                </button>
              ))}
            </div>
          </LField>
          {paymentMethod === "credit" && !partyId && (
            <p className="text-xs text-warning">Pick a vendor above to track this credit purchase in their ledger.</p>
          )}

          <div className="space-y-3">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Line items</div>
            {lines.map((l) => (
              <div key={l.key} className="rounded-lg border border-border p-3 space-y-2">
                <div className="grid sm:grid-cols-[1fr_auto] gap-2 items-end">
                  <LField label="Product">
                    <input
                      list={`items-${warehouseId}`}
                      value={l.name}
                      onChange={(e) => {
                        const match = itemsInShop.find((i) => i.name === e.target.value);
                        if (match) pickExisting(l.key, match.id);
                        else updateLine(l.key, { name: e.target.value, itemId: null });
                      }}
                      placeholder="Existing item or new product name"
                      className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm"
                    />
                  </LField>
                  <button
                    type="button"
                    onClick={() => removeLine(l.key)}
                    className="h-9 w-9 grid place-items-center rounded-lg border border-border text-destructive hover:bg-muted"
                    aria-label="Remove line"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <LField label="Quantity">
                    <input
                      type="number"
                      value={l.quantity}
                      onChange={(e) => updateLine(l.key, { quantity: e.target.value })}
                      className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm"
                    />
                  </LField>
                  <LField label="Cost price (₹)">
                    <input
                      type="number"
                      value={l.costPrice}
                      onChange={(e) => updateLine(l.key, { costPrice: e.target.value })}
                      className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm"
                    />
                  </LField>
                </div>
                {l.itemId ? (
                  <p className="text-[11px] text-muted-foreground">Adding to existing stock</p>
                ) : (
                  <p className="text-[11px] text-muted-foreground">Will create a new item if no exact match is picked</p>
                )}
              </div>
            ))}
            <datalist id={`items-${warehouseId}`}>
              {itemsInShop.map((i) => (
                <option key={i.id} value={i.name} />
              ))}
            </datalist>
            <button
              type="button"
              onClick={() => setLines((ls) => [...ls, newLine()])}
              className="inline-flex items-center gap-1.5 text-sm text-primary"
            >
              <Plus size={14} /> Add line
            </button>
          </div>

          <div className="flex items-center justify-between border-t border-border pt-3">
            <span className="text-sm text-muted-foreground">Total</span>
            <span className="font-display text-xl text-ink tabular-nums">{inr(total)}</span>
          </div>

          {err && <div className="text-sm text-destructive bg-destructive/10 rounded-lg px-3 py-2">{err}</div>}

          <button
            onClick={submit}
            disabled={busy}
            className="w-full rounded-lg bg-primary text-primary-foreground py-2.5 text-sm disabled:opacity-60"
          >
            {busy ? "Saving…" : "Save purchase voucher"}
          </button>
        </section>
      </div>
    </AppShell>
  );
}

function LField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs text-muted-foreground mb-1">{label}</span>
      {children}
    </label>
  );
}
