import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Search, X, Loader2, Pencil } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/hooks/use-auth";
import { useProfile } from "@/hooks/use-profile";
import { supabase } from "@/integrations/supabase/client";
import { can } from "@/lib/permissions";
import { useT } from "@/lib/i18n";
import { inr } from "@/components/InvoiceView";

export const Route = createFileRoute("/alter-entries")({
  component: AlterEntriesPage,
  head: () => ({
    meta: [
      { title: "Alter Entries · Hisab" },
      { name: "description", content: "Correct a past bill or expense — every change is logged in the Activity Log." },
    ],
  }),
});

// ---------------------------------------------------------------------------
// Shared types + the loose Supabase escape-hatch already used in reports.tsx
// / create-bill.tsx for tables newer than the generated types.
// ---------------------------------------------------------------------------
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sb = { from: (t: string) => any };
const sb = supabase as unknown as Sb;

type Warehouse = { id: string; name: string };

type BillRow = {
  id: string;
  warehouse_id: string;
  bill_type: "sale" | "purchase";
  invoice_number: string | null;
  invoice_date: string;
  customer_name: string | null;
  customer_address: string | null;
  customer_gstin: string | null;
  supplier_name: string | null;
  supplier_address: string | null;
  supplier_gstin: string | null;
  place_of_supply: string | null;
  payment_method: "cash" | "credit" | null;
  discount_type: "flat" | "percent" | null;
  discount_value: number;
  subtotal: number;
  discount_amount: number;
  total: number;
};

type BillItemRow = {
  id: string;
  item_name: string;
  quantity: number;
  unit_price: number;
  line_discount: number;
  line_total: number;
  hsn_sac_code: string | null;
  gst_rate: number;
};

type ExpenseRow = {
  id: string;
  label: string;
  amount: number;
  cadence: "one-time" | "monthly" | "weekly" | "yearly";
  payment_method: "cash" | "credit" | null;
};

function AlterEntriesPage() {
  const { user, loading: authLoading } = useAuth();
  const { profile, loading: profileLoading } = useProfile();
  const navigate = useNavigate();
  const { t } = useT();

  const [tab, setTab] = useState<"bills" | "expenses">("bills");
  const [bills, setBills] = useState<BillRow[]>([]);
  const [expenses, setExpenses] = useState<ExpenseRow[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [editBillId, setEditBillId] = useState<string | null>(null);
  const [editExpense, setEditExpense] = useState<ExpenseRow | null>(null);

  useEffect(() => {
    if (!authLoading && !user) navigate({ to: "/auth" });
  }, [authLoading, user, navigate]);

  const seller = useMemo(() => {
    const org = profile?.org;
    return {
      gstin: org?.gstin ?? profile?.gstin ?? "",
      state: org?.state ?? profile?.state ?? "",
    };
  }, [profile]);

  const load = useCallback(async () => {
    if (!profile || !can.alterEntries(profile.role)) return;
    setLoading(true);
    const [b, e, wh] = await Promise.all([
      sb.from("bills").select("*").eq("status", "completed").order("invoice_date", { ascending: false }).limit(300),
      sb
        .from("expenses")
        .select("id, label, amount, cadence, payment_method, created_at")
        .order("created_at", { ascending: false })
        .limit(300),
      supabase.from("warehouses").select("id, name"),
    ]);
    setBills((b.data as BillRow[] | null) ?? []);
    setExpenses((e.data as ExpenseRow[] | null) ?? []);
    setWarehouses((wh.data as Warehouse[] | null) ?? []);
    setLoading(false);
  }, [profile]);

  useEffect(() => {
    void load();
  }, [load]);

  const whName = (id: string) => warehouses.find((w) => w.id === id)?.name ?? "—";

  const filteredBills = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return bills;
    return bills.filter((b) => {
      const name = b.bill_type === "sale" ? b.customer_name : b.supplier_name;
      return (b.invoice_number ?? "").toLowerCase().includes(q) || (name ?? "").toLowerCase().includes(q);
    });
  }, [bills, query]);

  const filteredExpenses = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return expenses;
    return expenses.filter((e) => e.label.toLowerCase().includes(q));
  }, [expenses, query]);

  if (profileLoading) {
    return (
      <AppShell active="settings" title={t("alt.title")}>
        <div className="p-10 text-muted-foreground">
          <Loader2 size={16} className="animate-spin" />
        </div>
      </AppShell>
    );
  }

  if (!can.alterEntries(profile?.role)) {
    return (
      <AppShell active="settings" title={t("alt.title")}>
        <div className="p-10 text-sm text-muted-foreground">{t("alt.noAccess")}</div>
      </AppShell>
    );
  }

  return (
    <AppShell active="settings" title={t("alt.title")}>
      <div className="px-4 md:px-10 py-6 md:py-8 max-w-3xl space-y-6">
        <header>
          <p className="text-xs uppercase tracking-widest text-muted-foreground">{t("alt.tagline")}</p>
          <h1 className="mt-1 font-display text-3xl md:text-4xl text-ink">{t("alt.title")}</h1>
          <p className="mt-1 text-xs text-muted-foreground">{t("alt.loggedNote")}</p>
        </header>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="inline-flex items-center gap-1 rounded-full bg-muted p-0.5 text-sm">
            <button
              onClick={() => {
                setTab("bills");
                setQuery("");
              }}
              className={`px-3 py-1.5 rounded-full transition ${
                tab === "bills" ? "bg-card shadow-sm text-ink" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {t("alt.tabBills")}
            </button>
            <button
              onClick={() => {
                setTab("expenses");
                setQuery("");
              }}
              className={`px-3 py-1.5 rounded-full transition ${
                tab === "expenses" ? "bg-card shadow-sm text-ink" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {t("alt.tabExpenses")}
            </button>
          </div>
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={tab === "bills" ? t("alt.searchBills") : t("alt.searchExpenses")}
              className="rounded-lg border border-border bg-card pl-8 pr-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring/40"
            />
          </div>
        </div>

        <section className="card-warm p-4 md:p-5">
          {tab === "bills" ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[600px]">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground border-b border-border">
                    <th className="py-2">{t("alt.colInvoice")}</th>
                    <th className="py-2">{t("alt.colDate")}</th>
                    <th className="py-2">{t("alt.colShop")}</th>
                    <th className="py-2">{t("alt.colParty")}</th>
                    <th className="py-2 text-right">{t("alt.colTotal")}</th>
                    <th className="py-2">{t("alt.colType")}</th>
                    <th className="py-2 w-8" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filteredBills.map((b) => {
                    const name = b.bill_type === "sale" ? b.customer_name : b.supplier_name;
                    return (
                      <tr key={b.id} className="cursor-pointer hover:bg-muted/40 group" onClick={() => setEditBillId(b.id)}>
                        <td className="py-2 text-ink">{b.invoice_number || "—"}</td>
                        <td className="py-2 text-muted-foreground">
                          {new Date(b.invoice_date).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}
                        </td>
                        <td className="py-2 text-muted-foreground">{whName(b.warehouse_id)}</td>
                        <td className="py-2 text-muted-foreground">{name || "Walk-in"}</td>
                        <td className="py-2 text-right tabular-nums text-ink font-medium">{inr(b.total)}</td>
                        <td className="py-2">
                          <span
                            className={`text-[10px] px-2 py-0.5 rounded-full capitalize ${
                              b.bill_type === "sale" ? "bg-success/15 text-success" : "bg-warning/15 text-warning"
                            }`}
                          >
                            {b.bill_type}
                          </span>
                        </td>
                        <td className="py-2 text-muted-foreground group-hover:text-primary">
                          <Pencil size={13} />
                        </td>
                      </tr>
                    );
                  })}
                  {filteredBills.length === 0 && (
                    <tr>
                      <td colSpan={7} className="py-8 text-center text-muted-foreground">
                        {loading ? t("common.loading") : t("alt.noBills")}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[480px]">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground border-b border-border">
                    <th className="py-2">{t("alt.colLabel")}</th>
                    <th className="py-2">{t("exp.cadence")}</th>
                    <th className="py-2">{t("exp.payment")}</th>
                    <th className="py-2 text-right">{t("alt.colAmount")}</th>
                    <th className="py-2 w-8" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filteredExpenses.map((e) => (
                    <tr key={e.id} className="cursor-pointer hover:bg-muted/40 group" onClick={() => setEditExpense(e)}>
                      <td className="py-2 text-ink">{e.label}</td>
                      <td className="py-2 text-muted-foreground capitalize">{e.cadence.replace("-", " ")}</td>
                      <td className="py-2 text-muted-foreground capitalize">{e.payment_method ?? "cash"}</td>
                      <td className="py-2 text-right tabular-nums text-ink font-medium">{inr(e.amount)}</td>
                      <td className="py-2 text-muted-foreground group-hover:text-primary">
                        <Pencil size={13} />
                      </td>
                    </tr>
                  ))}
                  {filteredExpenses.length === 0 && (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-muted-foreground">
                        {loading ? t("common.loading") : t("alt.noExpenses")}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      {editBillId && (
        <BillEditModal
          billId={editBillId}
          seller={seller}
          onClose={() => setEditBillId(null)}
          onSaved={() => void load()}
        />
      )}
      {editExpense && (
        <ExpenseEditModal expense={editExpense} onClose={() => setEditExpense(null)} onSaved={() => void load()} />
      )}
    </AppShell>
  );
}

// ---------------------------------------------------------------------------
// Bill editor — same GST math as Create Bill (per-line taxable value, CGST/
// SGST for same-state, IGST otherwise, overall discount applied pro-rata)
// so altered totals stay consistent with a freshly created bill.
// ---------------------------------------------------------------------------
function BillEditModal({
  billId,
  seller,
  onClose,
  onSaved,
}: {
  billId: string;
  seller: { gstin: string; state: string };
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useT();
  const hasGst = !!seller.gstin;

  const [bill, setBill] = useState<BillRow | null>(null);
  const [lines, setLines] = useState<{ id: string; name: string; qty: number; unitPrice: number; disc: number; gstRate: number }[]>([]);
  const [invoiceDate, setInvoiceDate] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "credit">("cash");
  const [placeOfSupply, setPlaceOfSupply] = useState("");
  const [partyName, setPartyName] = useState("");
  const [partyAddress, setPartyAddress] = useState("");
  const [partyGstin, setPartyGstin] = useState("");
  const [discountType, setDiscountType] = useState<"flat" | "percent">("flat");
  const [discountValue, setDiscountValue] = useState("0");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const [b, items] = await Promise.all([
        sb.from("bills").select("*").eq("id", billId).single(),
        sb.from("bill_items").select("*").eq("bill_id", billId),
      ]);
      if (b.data) {
        const row = b.data as BillRow;
        setBill(row);
        setInvoiceDate(row.invoice_date);
        setPaymentMethod((row.payment_method as "cash" | "credit") ?? "cash");
        setPlaceOfSupply(row.place_of_supply ?? "");
        setDiscountType((row.discount_type as "flat" | "percent") ?? "flat");
        setDiscountValue(String(row.discount_value ?? 0));
        if (row.bill_type === "sale") {
          setPartyName(row.customer_name ?? "");
          setPartyAddress(row.customer_address ?? "");
          setPartyGstin(row.customer_gstin ?? "");
        } else {
          setPartyName(row.supplier_name ?? "");
          setPartyAddress(row.supplier_address ?? "");
          setPartyGstin(row.supplier_gstin ?? "");
        }
      }
      const itemRows = ((items.data as BillItemRow[] | null) ?? []).map((r) => ({
        id: r.id,
        name: r.item_name,
        qty: r.quantity,
        unitPrice: r.unit_price,
        disc: r.line_discount,
        gstRate: r.gst_rate,
      }));
      setLines(itemRows);
      setLoading(false);
    })();
  }, [billId]);

  const updateLine = (id: string, patch: Partial<{ qty: number; unitPrice: number; disc: number; gstRate: number }>) => {
    setLines((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  };

  const computed = useMemo(() => {
    const rows = lines.map((l) => {
      const qty = Math.round(Number(l.qty) || 0);
      const amt = Number(l.unitPrice) || 0;
      const disc = Math.min(Number(l.disc) || 0, qty * amt);
      const lineTotal = Math.max(0, qty * amt - disc);
      return { ...l, qty, amt, disc, lineTotal };
    });
    const subtotal = rows.reduce((s, r) => s + r.lineTotal, 0);
    const overallDiscValue = Number(discountValue) || 0;
    const overallDiscAmount =
      discountType === "percent" ? (subtotal * overallDiscValue) / 100 : Math.min(overallDiscValue, subtotal);
    const ratio = subtotal > 0 ? (subtotal - overallDiscAmount) / subtotal : 1;
    const sameState =
      hasGst && seller.state && placeOfSupply && seller.state.trim().toLowerCase() === placeOfSupply.trim().toLowerCase();

    let totalGst = 0;
    const withTax = rows.map((r) => {
      const taxableValue = r.lineTotal * ratio;
      const gstRate = hasGst ? r.gstRate : 0;
      const gstAmount = (taxableValue * gstRate) / 100;
      const cgst = hasGst && sameState ? gstAmount / 2 : 0;
      const sgst = hasGst && sameState ? gstAmount / 2 : 0;
      const igst = hasGst && !sameState ? gstAmount : 0;
      totalGst += cgst + sgst + igst;
      return { ...r, taxableValue, cgst, sgst, igst };
    });
    const grandTotal = subtotal - overallDiscAmount + totalGst;
    return { rows: withTax, subtotal, overallDiscAmount, grandTotal };
  }, [lines, discountType, discountValue, hasGst, seller.state, placeOfSupply]);

  const save = async () => {
    if (!bill) return;
    setErr(null);
    setMsg(null);
    if (computed.rows.some((r) => r.qty <= 0)) {
      setErr(t("alt.qtyPositive"));
      return;
    }
    setSaving(true);
    try {
      for (const r of computed.rows) {
        const { error } = await sb
          .from("bill_items")
          .update({
            quantity: r.qty,
            unit_price: r.amt,
            line_discount: r.disc,
            line_total: r.lineTotal,
            taxable_value: r.taxableValue,
            gst_rate: hasGst ? r.gstRate : 0,
            cgst_amount: r.cgst,
            sgst_amount: r.sgst,
            igst_amount: r.igst,
          })
          .eq("id", r.id);
        if (error) throw new Error(error.message);
      }

      const payload: Record<string, unknown> = {
        invoice_date: invoiceDate,
        payment_method: paymentMethod,
        place_of_supply: hasGst ? placeOfSupply || null : null,
        discount_type: discountType,
        discount_value: Number(discountValue) || 0,
        discount_amount: computed.overallDiscAmount,
        subtotal: computed.subtotal,
        total: computed.grandTotal,
      };
      if (bill.bill_type === "sale") {
        payload.customer_name = partyName.trim() || null;
        payload.customer_address = partyAddress.trim() || null;
        payload.customer_gstin = partyGstin.trim() || null;
      } else {
        payload.supplier_name = partyName.trim() || null;
        payload.supplier_address = partyAddress.trim() || null;
        payload.supplier_gstin = partyGstin.trim() || null;
      }
      const { error } = await sb.from("bills").update(payload).eq("id", billId);
      if (error) throw new Error(error.message);

      setMsg(t("alt.saved"));
      onSaved();
      setTimeout(onClose, 900);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Something went wrong. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-ink/40 backdrop-blur-sm grid place-items-center p-4" onClick={onClose}>
      <div
        className="w-full max-w-2xl max-h-[90vh] overflow-y-auto card-warm p-6 relative"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          aria-label={t("common.close")}
          className="absolute right-3 top-3 h-8 w-8 grid place-items-center rounded-full hover:bg-muted"
        >
          <X size={16} />
        </button>
        <h2 className="font-display text-2xl text-ink">{t("alt.editBill")}</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">{bill?.invoice_number}</p>

        {loading ? (
          <div className="py-10 text-center text-muted-foreground">
            <Loader2 size={16} className="animate-spin inline" />
          </div>
        ) : (
          <div className="mt-5 space-y-4">
            <div className="grid sm:grid-cols-2 gap-3">
              <label className="block">
                <span className="block text-xs text-muted-foreground mb-1">{t("alt.invoiceDate")}</span>
                <input
                  type="date"
                  value={invoiceDate}
                  onChange={(e) => setInvoiceDate(e.target.value)}
                  className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/40"
                />
              </label>
              <label className="block">
                <span className="block text-xs text-muted-foreground mb-1">{t("alt.paymentMethod")}</span>
                <select
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value as "cash" | "credit")}
                  className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/40"
                >
                  <option value="cash">{t("exp.cash")}</option>
                  <option value="credit">{t("exp.credit")}</option>
                </select>
              </label>
              <label className="block">
                <span className="block text-xs text-muted-foreground mb-1">{t("alt.partyName")}</span>
                <input
                  value={partyName}
                  onChange={(e) => setPartyName(e.target.value)}
                  className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/40"
                />
              </label>
              <label className="block">
                <span className="block text-xs text-muted-foreground mb-1">{t("alt.partyAddress")}</span>
                <input
                  value={partyAddress}
                  onChange={(e) => setPartyAddress(e.target.value)}
                  className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/40"
                />
              </label>
              {hasGst && (
                <>
                  <label className="block">
                    <span className="block text-xs text-muted-foreground mb-1">{t("alt.partyGstin")}</span>
                    <input
                      value={partyGstin}
                      onChange={(e) => setPartyGstin(e.target.value.toUpperCase())}
                      className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/40"
                    />
                  </label>
                  <label className="block">
                    <span className="block text-xs text-muted-foreground mb-1">{t("alt.placeOfSupply")}</span>
                    <input
                      value={placeOfSupply}
                      onChange={(e) => setPlaceOfSupply(e.target.value)}
                      className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/40"
                    />
                  </label>
                </>
              )}
            </div>

            <div>
              <p className="text-xs uppercase tracking-wider text-muted-foreground mb-2">{t("alt.lineItems")}</p>
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full text-sm min-w-[520px]">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground bg-muted/40">
                      <th className="py-2 px-2">Item</th>
                      <th className="py-2 px-2 w-20">{t("alt.qty")}</th>
                      <th className="py-2 px-2 w-24">{t("alt.rate")}</th>
                      <th className="py-2 px-2 w-24">{t("alt.discount")}</th>
                      {hasGst && <th className="py-2 px-2 w-20">{t("alt.gstRate")}</th>}
                      <th className="py-2 px-2 text-right w-24">{t("alt.lineTotal")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {computed.rows.map((r) => (
                      <tr key={r.id}>
                        <td className="py-1.5 px-2 text-ink">{r.name}</td>
                        <td className="py-1.5 px-2">
                          <input
                            type="number"
                            value={r.qty}
                            onChange={(e) => updateLine(r.id, { qty: Number(e.target.value) || 0 })}
                            className="w-full rounded-md border border-border bg-card px-1.5 py-1 text-sm outline-none focus:ring-1 focus:ring-ring/40"
                          />
                        </td>
                        <td className="py-1.5 px-2">
                          <input
                            type="number"
                            value={r.amt}
                            onChange={(e) => updateLine(r.id, { unitPrice: Number(e.target.value) || 0 })}
                            className="w-full rounded-md border border-border bg-card px-1.5 py-1 text-sm outline-none focus:ring-1 focus:ring-ring/40"
                          />
                        </td>
                        <td className="py-1.5 px-2">
                          <input
                            type="number"
                            value={r.disc}
                            onChange={(e) => updateLine(r.id, { disc: Number(e.target.value) || 0 })}
                            className="w-full rounded-md border border-border bg-card px-1.5 py-1 text-sm outline-none focus:ring-1 focus:ring-ring/40"
                          />
                        </td>
                        {hasGst && (
                          <td className="py-1.5 px-2">
                            <input
                              type="number"
                              value={r.gstRate}
                              onChange={(e) => updateLine(r.id, { gstRate: Number(e.target.value) || 0 })}
                              className="w-full rounded-md border border-border bg-card px-1.5 py-1 text-sm outline-none focus:ring-1 focus:ring-ring/40"
                            />
                          </td>
                        )}
                        <td className="py-1.5 px-2 text-right tabular-nums text-ink">{inr(r.lineTotal)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="grid sm:grid-cols-2 gap-3 items-end">
              <div className="grid grid-cols-2 gap-2">
                <label className="block">
                  <span className="block text-xs text-muted-foreground mb-1">{t("alt.overallDiscountType")}</span>
                  <select
                    value={discountType}
                    onChange={(e) => setDiscountType(e.target.value as "flat" | "percent")}
                    className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/40"
                  >
                    <option value="flat">{t("alt.flat")}</option>
                    <option value="percent">{t("alt.percent")}</option>
                  </select>
                </label>
                <label className="block">
                  <span className="block text-xs text-muted-foreground mb-1">{t("alt.overallDiscountValue")}</span>
                  <input
                    type="number"
                    value={discountValue}
                    onChange={(e) => setDiscountValue(e.target.value)}
                    className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/40"
                  />
                </label>
              </div>
              <div className="text-sm space-y-1 sm:text-right">
                <div className="flex justify-between sm:justify-end sm:gap-3 text-muted-foreground">
                  <span>{t("alt.subtotal")}</span>
                  <span className="tabular-nums">{inr(computed.subtotal)}</span>
                </div>
                <div className="flex justify-between sm:justify-end sm:gap-3 font-display text-lg text-ink">
                  <span>{t("alt.grandTotal")}</span>
                  <span className="tabular-nums">{inr(computed.grandTotal)}</span>
                </div>
              </div>
            </div>

            {err && <div className="text-sm text-destructive bg-destructive/10 rounded-lg px-3 py-2">{err}</div>}
            {msg && <div className="text-sm text-success bg-success/10 rounded-lg px-3 py-2">{msg}</div>}

            <div className="flex justify-end gap-2 pt-1">
              <button onClick={onClose} className="rounded-lg border border-border bg-card px-4 py-2 text-sm">
                {t("common.cancel")}
              </button>
              <button
                onClick={save}
                disabled={saving}
                className="rounded-lg bg-primary text-primary-foreground px-4 py-2 text-sm disabled:opacity-60"
              >
                {saving ? t("alt.saving") : t("alt.save")}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Expense editor — simpler: label, amount, cadence, payment method.
// ---------------------------------------------------------------------------
function ExpenseEditModal({
  expense,
  onClose,
  onSaved,
}: {
  expense: ExpenseRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useT();
  const [label, setLabel] = useState(expense.label);
  const [amount, setAmount] = useState(String(expense.amount));
  const [cadence, setCadence] = useState<ExpenseRow["cadence"]>(expense.cadence);
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "credit">(expense.payment_method ?? "cash");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const save = async () => {
    setErr(null);
    setMsg(null);
    const amt = Number(amount);
    if (!label.trim() || !Number.isFinite(amt) || amt <= 0) {
      setErr(t("exp.enterNameAmount"));
      return;
    }
    setSaving(true);
    const { error } = await sb
      .from("expenses")
      .update({ label: label.trim(), amount: amt, cadence, payment_method: paymentMethod })
      .eq("id", expense.id);
    setSaving(false);
    if (error) {
      setErr(error.message);
      return;
    }
    setMsg(t("alt.saved"));
    onSaved();
    setTimeout(onClose, 900);
  };

  return (
    <div className="fixed inset-0 z-50 bg-ink/40 backdrop-blur-sm grid place-items-center p-4" onClick={onClose}>
      <div className="w-full max-w-md card-warm p-6 relative" onClick={(e) => e.stopPropagation()}>
        <button
          onClick={onClose}
          aria-label={t("common.close")}
          className="absolute right-3 top-3 h-8 w-8 grid place-items-center rounded-full hover:bg-muted"
        >
          <X size={16} />
        </button>
        <h2 className="font-display text-2xl text-ink">{t("alt.editExpense")}</h2>

        <div className="mt-5 space-y-3">
          <label className="block">
            <span className="block text-xs text-muted-foreground mb-1">{t("alt.label")}</span>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/40"
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="block text-xs text-muted-foreground mb-1">{t("alt.amount")}</span>
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/40"
              />
            </label>
            <label className="block">
              <span className="block text-xs text-muted-foreground mb-1">{t("exp.cadence")}</span>
              <select
                value={cadence}
                onChange={(e) => setCadence(e.target.value as ExpenseRow["cadence"])}
                className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/40"
              >
                <option value="one-time">{t("exp.oneTimeOption")}</option>
                <option value="monthly">{t("exp.monthly")}</option>
                <option value="weekly">{t("exp.weekly")}</option>
                <option value="yearly">{t("exp.yearly")}</option>
              </select>
            </label>
          </div>
          <label className="block">
            <span className="block text-xs text-muted-foreground mb-1">{t("exp.payment")}</span>
            <select
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value as "cash" | "credit")}
              className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/40"
            >
              <option value="cash">{t("exp.cash")}</option>
              <option value="credit">{t("exp.credit")}</option>
            </select>
          </label>
        </div>

        {err && <div className="mt-3 text-sm text-destructive bg-destructive/10 rounded-lg px-3 py-2">{err}</div>}
        {msg && <div className="mt-3 text-sm text-success bg-success/10 rounded-lg px-3 py-2">{msg}</div>}

        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-border bg-card px-4 py-2 text-sm">
            {t("common.cancel")}
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="rounded-lg bg-primary text-primary-foreground px-4 py-2 text-sm disabled:opacity-60"
          >
            {saving ? t("alt.saving") : t("alt.save")}
          </button>
        </div>
      </div>
    </div>
  );
}
