import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, Search, Check, X, Pencil, Trash2, AlertCircle, FileText } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { useT } from "@/lib/i18n";
import { inr } from "@/components/InvoiceView";

type BillType = "sale" | "purchase";
type PaymentMethod = "cash" | "credit";

type Warehouse = { id: string; name: string };
type InvItem = { id: string; name: string; price: number; cost_price: number; stock: number; warehouse_id: string };

type PendingBill = {
  id: string;
  invoice_number: string | null;
  invoice_date: string;
  bill_type: BillType;
  warehouse_id: string;
  party_id: string | null;
  customer_name: string | null;
  supplier_name: string | null;
  payment_method: PaymentMethod | null;
  subtotal: number;
  total: number;
  source: "manual" | "csv";
};

type BillItemRow = {
  id?: string;
  item_id: string | null;
  item_name: string;
  quantity: number;
  unit_price: number;
};

type DraftItem = { key: string; name: string; quantity: string; unitPrice: string };

type Draft = {
  billType: BillType;
  warehouseId: string;
  invoiceDate: string;
  partyName: string;
  paymentMethod: PaymentMethod;
  gst: string;
  items: DraftItem[];
};

function emptyDraft(warehouseId: string): Draft {
  return {
    billType: "sale",
    warehouseId,
    invoiceDate: new Date().toISOString().slice(0, 10),
    partyName: "",
    paymentMethod: "cash",
    gst: "0",
    items: [{ key: crypto.randomUUID(), name: "", quantity: "1", unitPrice: "0" }],
  };
}

function draftSubtotal(draft: Draft) {
  return draft.items.reduce((s, i) => s + (Number(i.quantity) || 0) * (Number(i.unitPrice) || 0), 0);
}

function parseCsv(text: string): string[][] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  return lines.map((line) => {
    const out: string[] = [];
    let cur = "";
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (inQ) {
        if (c === '"' && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else if (c === '"') inQ = false;
        else cur += c;
      } else if (c === '"') inQ = true;
      else if (c === ",") {
        out.push(cur);
        cur = "";
      } else cur += c;
    }
    out.push(cur);
    return out.map((s) => s.trim());
  });
}

export function PendingBillsPanel({ warehouses, defaultShopId }: { warehouses: Warehouse[]; defaultShopId: string }) {
  const { user } = useAuth();
  const { t, tf } = useT();

  const [pending, setPending] = useState<PendingBill[]>([]);
  const [parties, setParties] = useState<{ id: string; name: string }[]>([]);
  const [items, setItems] = useState<InvItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [typeTab, setTypeTab] = useState<"all" | BillType>("all");
  const [err, setErr] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(() => emptyDraft(defaultShopId));
  const [modalErr, setModalErr] = useState<string | null>(null);
  const [csvErr, setCsvErr] = useState<string | null>(null);
  const [csvBusy, setCsvBusy] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const [pb, pa, it] = await Promise.all([
      supabase.from("bills").select("*").eq("status", "pending").order("created_at", { ascending: false }),
      supabase.from("parties").select("id, name").order("name"),
      supabase.from("inventory_items").select("id, name, price, cost_price, stock, warehouse_id"),
    ]);
    if (pb.error) setErr(pb.error.message);
    else setErr(null);
    setPending((pb.data as PendingBill[] | null) ?? []);
    setParties((pa.data as { id: string; name: string }[] | null) ?? []);
    setItems((it.data as InvItem[] | null) ?? []);
    setLoading(false);
  }, [user]);

  useEffect(() => {
    if (user) void load();
  }, [user, load]);

  useEffect(() => {
    setDraft((d) => (editingId ? d : { ...d, warehouseId: defaultShopId || d.warehouseId }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultShopId]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return pending.filter((b) => {
      if (typeTab !== "all" && b.bill_type !== typeTab) return false;
      if (!q) return true;
      const party = (b.bill_type === "sale" ? b.customer_name : b.supplier_name) ?? "";
      return (b.invoice_number ?? "").toLowerCase().includes(q) || party.toLowerCase().includes(q);
    });
  }, [pending, query, typeTab]);

  const whName = (id: string) => warehouses.find((w) => w.id === id)?.name ?? "—";

  // -----------------------------------------------------------------------
  // Manual add / edit modal
  // -----------------------------------------------------------------------
  function openAdd() {
    setEditingId(null);
    setDraft(emptyDraft(defaultShopId || warehouses[0]?.id || ""));
    setModalErr(null);
    setShowModal(true);
  }

  async function openEdit(b: PendingBill) {
    setEditingId(b.id);
    setModalErr(null);
    const { data } = await supabase.from("bill_items").select("*").eq("bill_id", b.id);
    const rows = (data as BillItemRow[] | null) ?? [];
    setDraft({
      billType: b.bill_type,
      warehouseId: b.warehouse_id,
      invoiceDate: b.invoice_date,
      partyName: (b.bill_type === "sale" ? b.customer_name : b.supplier_name) ?? "",
      paymentMethod: b.payment_method ?? "cash",
      gst: String(Math.max(0, b.total - b.subtotal)),
      items:
        rows.length > 0
          ? rows.map((r) => ({
              key: r.id ?? crypto.randomUUID(),
              name: r.item_name,
              quantity: String(r.quantity),
              unitPrice: String(r.unit_price),
            }))
          : [{ key: crypto.randomUUID(), name: "", quantity: "1", unitPrice: "0" }],
    });
    setShowModal(true);
  }

  function updateItem(key: string, patch: Partial<DraftItem>) {
    setDraft((d) => ({ ...d, items: d.items.map((i) => (i.key === key ? { ...i, ...patch } : i)) }));
  }
  function addItemRow() {
    setDraft((d) => ({ ...d, items: [...d.items, { key: crypto.randomUUID(), name: "", quantity: "1", unitPrice: "0" }] }));
  }
  function removeItemRow(key: string) {
    setDraft((d) => ({ ...d, items: d.items.length > 1 ? d.items.filter((i) => i.key !== key) : d.items }));
  }

  async function saveDraft() {
    if (!user) return;
    if (!draft.warehouseId) return setModalErr(t("impexp.targetShop"));
    const validItems = draft.items.filter((i) => i.name.trim() && Number(i.quantity) > 0);
    setModalErr(null);

    const subtotal = draftSubtotal(draft);
    const gst = Number(draft.gst) || 0;
    const total = subtotal + gst;
    const partyName = draft.partyName.trim();

    const payload: Record<string, unknown> = {
      user_id: user.id,
      warehouse_id: draft.warehouseId,
      bill_type: draft.billType,
      invoice_date: draft.invoiceDate,
      payment_method: draft.paymentMethod,
      subtotal,
      total,
      status: "pending",
      source: "manual",
    };
    if (draft.billType === "sale") payload.customer_name = partyName || null;
    else payload.supplier_name = partyName || null;

    try {
      let billId = editingId;
      if (editingId) {
        const upd = await supabase.from("bills").update(payload).eq("id", editingId);
        if (upd.error) throw new Error(upd.error.message);
        const del = await supabase.from("bill_items").delete().eq("bill_id", editingId);
        if (del.error) throw new Error(del.error.message);
      } else {
        const ins = await supabase.from("bills").insert(payload).select("id").single();
        if (ins.error) throw new Error(ins.error.message);
        billId = (ins.data as { id: string }).id;
      }

      if (validItems.length && billId) {
        const rows = validItems.map((i) => {
          const match = items.find(
            (it) => it.warehouse_id === draft.warehouseId && it.name.trim().toLowerCase() === i.name.trim().toLowerCase(),
          );
          return {
            bill_id: billId,
            item_id: match?.id ?? null,
            item_name: i.name.trim(),
            quantity: Number(i.quantity) || 0,
            unit_price: Number(i.unitPrice) || 0,
            line_total: (Number(i.quantity) || 0) * (Number(i.unitPrice) || 0),
          };
        });
        const bi = await supabase.from("bill_items").insert(rows);
        if (bi.error) throw new Error(bi.error.message);
      }

      setShowModal(false);
      void load();
    } catch (e) {
      setModalErr(e instanceof Error ? e.message : String(e));
    }
  }

  // -----------------------------------------------------------------------
  // CSV bill import
  // -----------------------------------------------------------------------
  async function handleCsv(file: File) {
    if (!user) return;
    setCsvErr(null);
    setCsvBusy(true);
    try {
      const text = await file.text();
      const csv = parseCsv(text);
      if (csv.length < 2) throw new Error(t("impexp.noDataToExport"));
      const header = csv[0].map((h) => h.toLowerCase());
      const idx = (name: string) => header.indexOf(name);
      const iDate = idx("date");
      const iType = idx("type");
      const iParty = idx("party");
      const iPay = idx("payment_method");
      const iGst = idx("gst");
      const iTotal = idx("total");

      const shopId = defaultShopId || warehouses[0]?.id;
      if (!shopId) throw new Error(t("impexp.targetShop"));

      const rows = csv.slice(1).map((r) => {
        const type = (r[iType] ?? "").trim().toLowerCase();
        const billType: BillType = type === "purchase" ? "purchase" : "sale";
        const gst = Number(r[iGst] ?? 0) || 0;
        const total = Number(r[iTotal] ?? 0) || 0;
        const date = r[iDate] && /^\d{4}-\d{2}-\d{2}$/.test(r[iDate]) ? r[iDate] : new Date().toISOString().slice(0, 10);
        const payment_method: PaymentMethod = (r[iPay] ?? "").trim().toLowerCase() === "credit" ? "credit" : "cash";
        const party = (r[iParty] ?? "").trim();
        const payload: Record<string, unknown> = {
          user_id: user.id,
          warehouse_id: shopId,
          bill_type: billType,
          invoice_date: date,
          payment_method,
          subtotal: Math.max(0, total - gst),
          total,
          status: "pending",
          source: "csv",
        };
        if (billType === "sale") payload.customer_name = party || null;
        else payload.supplier_name = party || null;
        return payload;
      });

      const ins = await supabase.from("bills").insert(rows);
      if (ins.error) throw new Error(ins.error.message);
      void load();
    } catch (e) {
      setCsvErr(e instanceof Error ? e.message : String(e));
    } finally {
      setCsvBusy(false);
    }
  }

  // -----------------------------------------------------------------------
  // Accept / reject
  // -----------------------------------------------------------------------
  async function reject(b: PendingBill) {
    if (!window.confirm(t("bi.confirmReject"))) return;
    setBusyId(b.id);
    await supabase.from("bills").update({ status: "rejected" }).eq("id", b.id);
    setBusyId(null);
    void load();
  }

  async function accept(b: PendingBill) {
    if (!user) return;
    setBusyId(b.id);
    setErr(null);
    try {
      const biRes = await supabase.from("bill_items").select("*").eq("bill_id", b.id);
      if (biRes.error) throw new Error(biRes.error.message);
      const lineItems = (biRes.data as (BillItemRow & { id: string })[] | null) ?? [];

      // Stock guard for sale lines against an already-matched item.
      for (const li of lineItems) {
        if (b.bill_type === "sale" && li.item_id) {
          const known = items.find((i) => i.id === li.item_id);
          if (known && li.quantity > known.stock) {
            throw new Error(tf("bi.insufficientStock", { stock: known.stock, name: known.name }));
          }
        }
      }

      // Resolve/create inventory items for unmatched lines.
      for (const li of lineItems) {
        if (!li.item_id) {
          const insItem = await supabase
            .from("inventory_items")
            .insert({
              user_id: user.id,
              name: li.item_name,
              category: "General",
              stock: 0,
              min_stock: 0,
              price: b.bill_type === "sale" ? li.unit_price : 0,
              cost_price: b.bill_type === "purchase" ? li.unit_price : 0,
              warehouse_id: b.warehouse_id,
            })
            .select("id")
            .single();
          if (insItem.error) throw new Error(insItem.error.message);
          const newId = (insItem.data as { id: string }).id;
          li.item_id = newId;
          await supabase.from("bill_items").update({ item_id: newId }).eq("id", li.id);
        }
      }

      // Resolve/create the party.
      let partyId: string | null = null;
      const typedName = (b.bill_type === "sale" ? b.customer_name : b.supplier_name)?.trim();
      if (typedName) {
        const existing = parties.find((p) => p.name.trim().toLowerCase() === typedName.toLowerCase());
        if (existing) partyId = existing.id;
        else {
          const insParty = await supabase
            .from("parties")
            .insert({ user_id: user.id, name: typedName, type: b.bill_type === "sale" ? "customer" : "vendor" })
            .select("id")
            .single();
          if (!insParty.error && insParty.data) partyId = (insParty.data as { id: string }).id;
        }
      }

      // Real invoice number, only assigned on acceptance.
      const invRes = await supabase.rpc("next_invoice_number", { _bill_type: b.bill_type });
      if (invRes.error) throw new Error(invRes.error.message);
      const invoiceNumber = invRes.data as string;

      // Apply stock movement + sales rows per line.
      for (const li of lineItems) {
        const current = items.find((i) => i.id === li.item_id);
        const currentStock = current?.stock ?? 0;
        const after = b.bill_type === "sale" ? currentStock - li.quantity : currentStock + li.quantity;
        const reason = b.bill_type === "sale" ? `Sale — Bill #${invoiceNumber}` : `Purchase — Bill #${invoiceNumber}`;
        const adj = await supabase
          .from("stock_adjustments")
          .insert({ user_id: user.id, item_id: li.item_id!, new_stock: after, reason });
        if (adj.error) throw new Error(adj.error.message);
        const upd = await supabase.from("inventory_items").update({ stock: after }).eq("id", li.item_id!);
        if (upd.error) throw new Error(upd.error.message);
        if (b.bill_type === "sale") {
          await supabase.from("sales").insert({
            user_id: user.id,
            item_id: li.item_id,
            warehouse_id: b.warehouse_id,
            item_name: li.item_name,
            quantity: li.quantity,
            unit_price: li.unit_price,
            unit_cost: current?.cost_price ?? 0,
            total: li.quantity * li.unit_price,
          });
        }
      }

      const finalUpd = await supabase
        .from("bills")
        .update({ status: "completed", invoice_number: invoiceNumber, party_id: partyId })
        .eq("id", b.id);
      if (finalUpd.error) throw new Error(finalUpd.error.message);

      void load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  }

  const gst = Number(draft.gst) || 0;
  const subtotal = draftSubtotal(draft);

  return (
    <div className="space-y-4">
      <div className="card-warm p-5 space-y-3">
        <label className="block border-2 border-dashed border-border rounded-lg p-6 text-center cursor-pointer hover:bg-muted/30">
          <FileText className="mx-auto text-muted-foreground" size={26} />
          <div className="mt-2 text-sm text-ink">{t("impexp.chooseCsvFile")}</div>
          <p className="mt-1 text-xs text-muted-foreground">
            {t("bi.csvBillHint")} <code>date, type, party, payment_method, gst, total</code>
          </p>
          <input
            type="file"
            accept=".csv,text/csv"
            disabled={csvBusy}
            onChange={(e) => e.target.files?.[0] && handleCsv(e.target.files[0])}
            className="hidden"
          />
        </label>
        {csvErr && (
          <div className="rounded-lg bg-destructive/10 text-destructive text-sm px-3 py-2 flex items-center gap-2">
            <AlertCircle size={14} /> {csvErr}
          </div>
        )}
        <button
          onClick={openAdd}
          className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-full border border-border px-4 py-2 text-sm hover:bg-muted"
        >
          <Plus size={14} /> {t("bi.addManually")}
        </button>
      </div>

      {err && (
        <div className="rounded-lg bg-destructive/10 text-destructive text-sm px-3 py-2 flex items-center gap-2">
          <AlertCircle size={14} /> {err}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-xl text-ink">{t("bi.pendingBills")}</h2>
          <p className="text-xs text-muted-foreground mt-0.5">{t("bi.pendingHint")}</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="inline-flex items-center gap-1 rounded-full bg-muted p-0.5 text-sm">
            {(["all", "sale", "purchase"] as const).map((k) => (
              <button
                key={k}
                onClick={() => setTypeTab(k)}
                className={`px-3 py-1.5 rounded-full transition capitalize ${
                  typeTab === k ? "bg-card shadow-sm text-ink" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {k === "all" ? t("common.all") : k === "sale" ? t("bi.sale") : t("bi.purchase")}
              </button>
            ))}
          </div>
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("alt.searchBills")}
              className="rounded-lg border border-border bg-card pl-8 pr-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring/40"
            />
          </div>
        </div>
      </div>

      <div className="card-warm p-4 md:p-5">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[700px]">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground border-b border-border">
                <th className="py-2">{t("alt.colInvoice")}</th>
                <th className="py-2">{t("alt.colDate")}</th>
                <th className="py-2">{t("alt.colShop")}</th>
                <th className="py-2">{t("alt.colParty")}</th>
                <th className="py-2 text-right">{t("bi.colGst")}</th>
                <th className="py-2 text-right">{t("alt.colTotal")}</th>
                <th className="py-2">{t("alt.colType")}</th>
                <th className="py-2 w-24" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map((b) => {
                const name = b.bill_type === "sale" ? b.customer_name : b.supplier_name;
                const gstAmt = Math.max(0, b.total - b.subtotal);
                return (
                  <tr key={b.id} className="group">
                    <td className="py-2 text-ink">
                      {b.invoice_number || "—"}{" "}
                      <span className="text-[10px] text-muted-foreground uppercase">
                        {b.source === "csv" ? t("bi.sourceCsv") : t("bi.sourceManual")}
                      </span>
                    </td>
                    <td className="py-2 text-muted-foreground">
                      {new Date(b.invoice_date).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}
                    </td>
                    <td className="py-2 text-muted-foreground">{whName(b.warehouse_id)}</td>
                    <td className="py-2 text-muted-foreground">{name || t("bi.walkIn")}</td>
                    <td className="py-2 text-right tabular-nums text-muted-foreground">{inr(gstAmt)}</td>
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
                    <td className="py-2">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => openEdit(b)}
                          title={t("common.edit")}
                          className="h-7 w-7 grid place-items-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
                        >
                          <Pencil size={13} />
                        </button>
                        <button
                          onClick={() => reject(b)}
                          disabled={busyId === b.id}
                          title={t("bi.reject")}
                          className="h-7 w-7 grid place-items-center rounded-full text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
                        >
                          <X size={14} />
                        </button>
                        <button
                          onClick={() => accept(b)}
                          disabled={busyId === b.id}
                          title={t("bi.accept")}
                          className="h-7 w-7 grid place-items-center rounded-full text-success hover:bg-success/10 disabled:opacity-50"
                        >
                          <Check size={15} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-muted-foreground">
                    {loading ? t("common.loading") : t("bi.noPending")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showModal && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setShowModal(false)}>
          <div
            className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-xl bg-card p-5 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="font-display text-lg text-ink">{editingId ? t("bi.modalEditTitle") : t("bi.modalAddTitle")}</h3>
              <button onClick={() => setShowModal(false)} className="text-muted-foreground hover:text-foreground">
                <X size={18} />
              </button>
            </div>

            {modalErr && (
              <div className="rounded-lg bg-destructive/10 text-destructive text-sm px-3 py-2 flex items-center gap-2">
                <AlertCircle size={14} /> {modalErr}
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="inline-flex items-center gap-1 rounded-full bg-muted p-0.5 text-sm col-span-2 w-fit">
                {(["sale", "purchase"] as const).map((k) => (
                  <button
                    key={k}
                    onClick={() => setDraft((d) => ({ ...d, billType: k }))}
                    className={`px-3 py-1.5 rounded-full transition ${
                      draft.billType === k ? "bg-card shadow-sm text-ink" : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {k === "sale" ? t("bi.sale") : t("bi.purchase")}
                  </button>
                ))}
              </div>

              <label className="block">
                <span className="block text-xs uppercase tracking-wider text-muted-foreground mb-1">{t("exp.shop")}</span>
                <select
                  value={draft.warehouseId}
                  onChange={(e) => setDraft((d) => ({ ...d, warehouseId: e.target.value }))}
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
                <span className="block text-xs uppercase tracking-wider text-muted-foreground mb-1">{t("bi.invoiceDate")}</span>
                <input
                  type="date"
                  value={draft.invoiceDate}
                  onChange={(e) => setDraft((d) => ({ ...d, invoiceDate: e.target.value }))}
                  className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm"
                />
              </label>

              <label className="block col-span-2">
                <span className="block text-xs uppercase tracking-wider text-muted-foreground mb-1">
                  {t("exp.partyOptional")}
                </span>
                <input
                  list="pending-bill-parties"
                  value={draft.partyName}
                  onChange={(e) => setDraft((d) => ({ ...d, partyName: e.target.value }))}
                  placeholder={t("bi.partyPlaceholder")}
                  className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm"
                />
                <datalist id="pending-bill-parties">
                  {parties.map((p) => (
                    <option key={p.id} value={p.name} />
                  ))}
                </datalist>
              </label>

              <label className="block">
                <span className="block text-xs uppercase tracking-wider text-muted-foreground mb-1">{t("exp.payment")}</span>
                <div className="inline-flex items-center gap-1 rounded-full bg-muted p-0.5 text-sm">
                  {(["cash", "credit"] as const).map((k) => (
                    <button
                      key={k}
                      onClick={() => setDraft((d) => ({ ...d, paymentMethod: k }))}
                      className={`px-3 py-1.5 rounded-full transition ${
                        draft.paymentMethod === k ? "bg-card shadow-sm text-ink" : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {k === "cash" ? t("exp.cash") : t("exp.credit")}
                    </button>
                  ))}
                </div>
              </label>
              <label className="block">
                <span className="block text-xs uppercase tracking-wider text-muted-foreground mb-1">{t("bi.gstAmount")}</span>
                <input
                  type="number"
                  min={0}
                  value={draft.gst}
                  onChange={(e) => setDraft((d) => ({ ...d, gst: e.target.value }))}
                  className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm"
                />
              </label>
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs uppercase tracking-wider text-muted-foreground">{t("bi.items")}</span>
                <button onClick={addItemRow} className="text-xs text-primary inline-flex items-center gap-1 hover:underline">
                  <Plus size={12} /> {t("bi.addItem")}
                </button>
              </div>
              <div className="space-y-2">
                {draft.items.map((item) => (
                  <div key={item.key} className="flex items-center gap-2">
                    <input
                      list="pending-bill-items"
                      value={item.name}
                      onChange={(e) => updateItem(item.key, { name: e.target.value })}
                      placeholder={t("bi.itemNamePlaceholder")}
                      className="flex-1 min-w-0 rounded-lg border border-border bg-card px-2.5 py-1.5 text-sm"
                    />
                    <input
                      type="number"
                      min={0}
                      value={item.quantity}
                      onChange={(e) => updateItem(item.key, { quantity: e.target.value })}
                      placeholder={t("bi.qty")}
                      className="w-16 rounded-lg border border-border bg-card px-2 py-1.5 text-sm text-right"
                    />
                    <input
                      type="number"
                      min={0}
                      value={item.unitPrice}
                      onChange={(e) => updateItem(item.key, { unitPrice: e.target.value })}
                      placeholder={t("bi.unitPrice")}
                      className="w-24 rounded-lg border border-border bg-card px-2 py-1.5 text-sm text-right"
                    />
                    <button
                      onClick={() => removeItemRow(item.key)}
                      className="text-muted-foreground hover:text-destructive shrink-0"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
                <datalist id="pending-bill-items">
                  {items
                    .filter((i) => i.warehouse_id === draft.warehouseId)
                    .map((i) => (
                      <option key={i.id} value={i.name} />
                    ))}
                </datalist>
              </div>
            </div>

            <div className="flex items-center justify-between text-sm border-t border-border pt-3">
              <span className="text-muted-foreground">
                {t("bi.subtotal")} {inr(subtotal)} + {t("bi.colGst")} {inr(gst)}
              </span>
              <span className="font-display text-lg text-ink">
                {t("bi.total")} {inr(subtotal + gst)}
              </span>
            </div>

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                onClick={() => setShowModal(false)}
                className="rounded-full px-4 py-2 text-sm text-muted-foreground hover:bg-muted"
              >
                {t("common.cancel")}
              </button>
              <button
                onClick={saveDraft}
                className="rounded-full bg-primary text-primary-foreground px-4 py-2 text-sm"
              >
                {editingId ? t("common.save") : t("bi.savePending")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
