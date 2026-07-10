import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2, Search, Printer, Receipt } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/hooks/use-auth";
import { useProfile } from "@/hooks/use-profile";
import { supabase } from "@/integrations/supabase/client";
import { can } from "@/lib/permissions";

export const Route = createFileRoute("/create-bill")({
  component: CreateBillPage,
  head: () => ({
    meta: [
      { title: "Create Bill · Hisab" },
      { name: "description", content: "Bill a customer, decrement stock, and generate a printable invoice for one shop." },
    ],
  }),
});

type Warehouse = { id: string; name: string; address: string | null };
type Party = { id: string; name: string; type: string };
type InvItem = { id: string; name: string; stock: number; price: number; cost_price: number };

type Line = {
  key: string;
  itemId: string;
  name: string;
  availableStock: number;
  quantity: string;
  price: string;
  discount: string;
  costPrice: number;
};

const inr = (n: number) => "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 2 });

function CreateBillPage() {
  const { user } = useAuth();
  const { profile } = useProfile();
  const role = profile?.role;
  const allowed = can.writeInventory(role);

  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [warehouseId, setWarehouseId] = useState("");
  const [parties, setParties] = useState<Party[]>([]);
  const [partyId, setPartyId] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "credit">("cash");
  const [items, setItems] = useState<InvItem[]>([]);
  const [query, setQuery] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [overallDiscount, setOverallDiscount] = useState("0");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [invoice, setInvoice] = useState<{
    shopName: string;
    shopAddress: string | null;
    partyName: string | null;
    paymentMethod: string;
    lines: { name: string; qty: number; price: number; discount: number; total: number }[];
    overallDiscount: number;
    grandTotal: number;
    date: string;
  } | null>(null);

  useEffect(() => {
    if (!user) return;
    void (async () => {
      const [wh, pa] = await Promise.all([
        supabase.from("warehouses").select("id, name, address").order("name"),
        supabase.from("parties").select("id, name, type").order("name"),
      ]);
      setWarehouses((wh.data as Warehouse[] | null) ?? []);
      setParties(((pa.data as Party[] | null) ?? []).filter((p) => p.type !== "vendor"));
      if (wh.data && wh.data.length > 0) setWarehouseId((wh.data as Warehouse[])[0].id);
    })();
  }, [user]);

  useEffect(() => {
    if (!warehouseId) return;
    void (async () => {
      const { data } = await supabase
        .from("inventory_items")
        .select("id, name, stock, price, cost_price")
        .eq("warehouse_id", warehouseId)
        .order("name");
      setItems((data as InvItem[] | null) ?? []);
    })();
    setLines([]);
  }, [warehouseId]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return items.filter((i) => i.name.toLowerCase().includes(q) && !lines.some((l) => l.itemId === i.id)).slice(0, 6);
  }, [items, query, lines]);

  const addLine = (item: InvItem) => {
    setLines((ls) => [
      ...ls,
      {
        key: crypto.randomUUID(),
        itemId: item.id,
        name: item.name,
        availableStock: item.stock,
        quantity: "1",
        price: String(item.price),
        discount: "0",
        costPrice: item.cost_price,
      },
    ]);
    setQuery("");
  };

  const updateLine = (key: string, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const removeLine = (key: string) => setLines((ls) => ls.filter((l) => l.key !== key));

  const subtotal = useMemo(
    () =>
      lines.reduce((sum, l) => {
        const line = (Number(l.quantity) || 0) * (Number(l.price) || 0) - (Number(l.discount) || 0);
        return sum + Math.max(0, line);
      }, 0),
    [lines],
  );
  const grandTotal = Math.max(0, subtotal - (Number(overallDiscount) || 0));

  const submit = async () => {
    setErr(null);
    if (!user || !warehouseId) {
      setErr("Pick a shop");
      return;
    }
    if (lines.length === 0) {
      setErr("Add at least one item");
      return;
    }
    for (const l of lines) {
      const qty = Number(l.quantity);
      if (!Number.isFinite(qty) || qty <= 0 || !Number.isInteger(qty)) {
        setErr(`Enter a valid quantity for ${l.name}`);
        return;
      }
      if (qty > l.availableStock) {
        setErr(`Only ${l.availableStock} of ${l.name} in stock`);
        return;
      }
      if (!Number.isFinite(Number(l.price)) || Number(l.price) < 0) {
        setErr(`Enter a valid price for ${l.name}`);
        return;
      }
    }

    setBusy(true);
    const { data: bill, error: billErr } = await supabase
      .from("bills")
      .insert({
        user_id: user.id,
        warehouse_id: warehouseId,
        party_id: partyId || null,
        payment_method: paymentMethod,
        discount: Number(overallDiscount) || 0,
        total: grandTotal,
      })
      .select("id")
      .single();
    if (billErr || !bill) {
      setBusy(false);
      setErr(billErr?.message ?? "Could not create bill");
      return;
    }

    const perLineDiscountShare = lines.length > 0 ? (Number(overallDiscount) || 0) / lines.length : 0;
    for (const l of lines) {
      const qty = Number(l.quantity);
      const price = Number(l.price);
      const lineDiscount = (Number(l.discount) || 0) + perLineDiscountShare;
      const lineTotal = Math.max(0, qty * price - lineDiscount);

      const saleRes = await supabase.from("sales").insert({
        user_id: user.id,
        item_id: l.itemId,
        warehouse_id: warehouseId,
        bill_id: bill.id,
        party_id: partyId || null,
        payment_method: paymentMethod,
        item_name: l.name,
        quantity: qty,
        unit_price: price,
        unit_cost: l.costPrice,
        discount: lineDiscount,
        total: lineTotal,
      });
      if (saleRes.error) {
        setBusy(false);
        setErr(saleRes.error.message);
        return;
      }
      const updRes = await supabase
        .from("inventory_items")
        .update({ stock: l.availableStock - qty })
        .eq("id", l.itemId);
      if (updRes.error) {
        setBusy(false);
        setErr(updRes.error.message);
        return;
      }
    }

    const shop = warehouses.find((w) => w.id === warehouseId);
    setInvoice({
      shopName: shop?.name ?? "Shop",
      shopAddress: shop?.address ?? null,
      partyName: parties.find((p) => p.id === partyId)?.name ?? null,
      paymentMethod,
      lines: lines.map((l) => {
        const qty = Number(l.quantity);
        const price = Number(l.price);
        const lineDiscount = (Number(l.discount) || 0) + perLineDiscountShare;
        return { name: l.name, qty, price, discount: lineDiscount, total: Math.max(0, qty * price - lineDiscount) };
      }),
      overallDiscount: Number(overallDiscount) || 0,
      grandTotal,
      date: new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }),
    });
    setBusy(false);
  };

  if (!allowed) {
    return (
      <AppShell active="create-bill" title="Create Bill">
        <div className="px-4 md:px-10 py-10 text-sm text-muted-foreground">You don't have permission to create bills.</div>
      </AppShell>
    );
  }

  if (invoice) {
    return (
      <AppShell active="create-bill" title="Create Bill">
        <div className="px-4 md:px-10 py-6 md:py-8 max-w-lg space-y-4">
          <div id="invoice-print" className="card-warm p-6 space-y-4">
            <div className="text-center">
              <div className="font-display text-xl text-ink">{invoice.shopName}</div>
              {invoice.shopAddress && <div className="text-xs text-muted-foreground">{invoice.shopAddress}</div>}
              <div className="text-xs text-muted-foreground mt-1">{invoice.date}</div>
            </div>
            {invoice.partyName && (
              <div className="text-sm text-ink">
                Bill to: <span className="font-medium">{invoice.partyName}</span>
              </div>
            )}
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted-foreground text-xs uppercase">
                  <th className="pb-1">Item</th>
                  <th className="pb-1 text-right">Qty</th>
                  <th className="pb-1 text-right">Price</th>
                  <th className="pb-1 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {invoice.lines.map((l, i) => (
                  <tr key={i} className="border-t border-border">
                    <td className="py-1.5">{l.name}</td>
                    <td className="py-1.5 text-right tabular-nums">{l.qty}</td>
                    <td className="py-1.5 text-right tabular-nums">{inr(l.price)}</td>
                    <td className="py-1.5 text-right tabular-nums">{inr(l.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="border-t border-border pt-3 flex justify-between font-display text-lg text-ink">
              <span>Grand total</span>
              <span className="tabular-nums">{inr(invoice.grandTotal)}</span>
            </div>
            <div className="text-xs text-muted-foreground text-center capitalize">
              {invoice.paymentMethod === "cash" ? "Paid in cash" : "On credit"}
            </div>
          </div>
          <div className="flex gap-2 print:hidden">
            <button
              onClick={() => window.print()}
              className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg bg-primary text-primary-foreground py-2.5 text-sm"
            >
              <Printer size={14} /> Print / share
            </button>
            <button
              onClick={() => {
                setInvoice(null);
                setLines([]);
                setPartyId("");
                setOverallDiscount("0");
              }}
              className="flex-1 rounded-lg border border-border py-2.5 text-sm"
            >
              New bill
            </button>
          </div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell active="create-bill" title="Create Bill">
      <div className="px-4 md:px-10 py-6 md:py-8 space-y-6 max-w-3xl">
        <div>
          <p className="text-xs uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
            <Receipt size={13} /> Billing
          </p>
          <h1 className="mt-1 font-display text-3xl text-ink">Create Bill</h1>
        </div>

        <section className="card-warm p-4 md:p-6 space-y-4">
          <div className="grid sm:grid-cols-2 gap-3">
            <label className="block">
              <span className="block text-xs text-muted-foreground mb-1">Shop</span>
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
            </label>
            <label className="block">
              <span className="block text-xs text-muted-foreground mb-1">Customer (optional)</span>
              <select
                value={partyId}
                onChange={(e) => setPartyId(e.target.value)}
                className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm"
              >
                <option value="">— Walk-in customer —</option>
                {parties.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

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
          {paymentMethod === "credit" && !partyId && (
            <p className="text-xs text-warning">Pick a customer above to track this credit sale in their ledger.</p>
          )}

          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search items in this shop…"
              className="w-full rounded-lg border border-border bg-card pl-9 pr-3 py-2.5 text-sm"
            />
            {results.length > 0 && (
              <div className="absolute z-10 mt-1 w-full rounded-lg border border-border bg-card shadow-lg overflow-hidden">
                {results.map((i) => (
                  <button
                    key={i.id}
                    onClick={() => addLine(i)}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-muted flex justify-between"
                  >
                    <span>{i.name}</span>
                    <span className="text-muted-foreground tabular-nums">
                      {i.stock} in stock · {inr(i.price)}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-2">
            {lines.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">Search and add items to build the bill.</p>
            ) : (
              lines.map((l) => (
                <div key={l.key} className="rounded-lg border border-border p-3 grid sm:grid-cols-[1fr_auto_auto_auto_auto] gap-2 items-end">
                  <div className="text-sm text-ink truncate">{l.name}</div>
                  <MiniField label="Qty" value={l.quantity} onChange={(v) => updateLine(l.key, { quantity: v })} />
                  <MiniField label="Price ₹" value={l.price} onChange={(v) => updateLine(l.key, { price: v })} />
                  <MiniField label="Discount ₹" value={l.discount} onChange={(v) => updateLine(l.key, { discount: v })} />
                  <button
                    onClick={() => removeLine(l.key)}
                    className="h-9 w-9 grid place-items-center rounded-lg border border-border text-destructive hover:bg-muted"
                    aria-label="Remove"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))
            )}
          </div>

          <div className="flex items-center justify-between gap-3">
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              Overall discount ₹
              <input
                type="number"
                value={overallDiscount}
                onChange={(e) => setOverallDiscount(e.target.value)}
                className="w-24 rounded-lg border border-border bg-card px-2 py-1.5 text-sm"
              />
            </label>
          </div>

          <div className="flex items-center justify-between border-t border-border pt-3">
            <span className="text-sm text-muted-foreground">Grand total</span>
            <span className="font-display text-xl text-ink tabular-nums">{inr(grandTotal)}</span>
          </div>

          {err && <div className="text-sm text-destructive bg-destructive/10 rounded-lg px-3 py-2">{err}</div>}

          <button
            onClick={submit}
            disabled={busy}
            className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg bg-primary text-primary-foreground py-2.5 text-sm disabled:opacity-60"
          >
            <Plus size={14} /> {busy ? "Saving…" : "Create bill"}
          </button>
        </section>
      </div>
    </AppShell>
  );
}

function MiniField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block w-20">
      <span className="block text-[10px] text-muted-foreground mb-1">{label}</span>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-border bg-card px-2 py-1.5 text-sm"
      />
    </label>
  );
}
