import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Plus,
  Trash2,
  Search,
  X,
  Printer,
  ArrowLeftRight,
  Store,
  UserPlus,
  ReceiptText,
} from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/hooks/use-auth";
import { useProfile } from "@/hooks/use-profile";
import { supabase } from "@/integrations/supabase/client";
import { can } from "@/lib/permissions";
import { PartyForm, type PartyRow } from "@/components/PartyForm";

export const Route = createFileRoute("/create-bill")({
  component: CreateBillPage,
  head: () => ({
    meta: [
      { title: "Create Bill · Hisab" },
      { name: "description", content: "GST-compliant sale and supplier billing." },
    ],
  }),
});

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type BillType = "sale" | "purchase";
type DiscountType = "flat" | "percent";

type Warehouse = { id: string; name: string };
type InvItem = {
  id: string;
  name: string;
  stock: number;
  price: number;
  cost_price: number;
  warehouse_id: string;
};

type Line = {
  key: string;
  itemId: string | null; // null = "add as new item"
  name: string;
  qty: string;
  unitAmount: string; // selling price (sale) or cost paid (purchase)
  lineDiscount: string; // flat ₹ off this line
  hsn: string;
  gstRate: number;
  customGstMode: boolean;
  currentStock: number | null; // known stock at time of adding (for the cap warning)
};

const GST_RATES = [0, 5, 12, 18, 28];
const inr = (n: number) => "₹" + (Math.round(n * 100) / 100).toLocaleString("en-IN");
const newKey = () => Math.random().toString(36).slice(2);

// Minimal untyped accessor for tables/RPCs not worth fighting the generated
// generics for here — same convention used by parties.tsx / vendors.tsx.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sb = { from: (t: string) => any; rpc: (fn: string, args: unknown) => Promise<{ data: unknown; error: { message: string } | null }> };
const sb = supabase as unknown as Sb;

function CreateBillPage() {
  const { user } = useAuth();
  const { profile } = useProfile();
  const role = profile?.role;
  const canWrite = can.writeInventory(role);
  const showCostPrice = can.viewCostPrice(role);

  // Seller identity — degrades gracefully when no GSTIN is saved.
  const seller = useMemo(() => {
    const org = profile?.org;
    return {
      name: org?.name ?? profile?.full_name ?? "Your business",
      address: org?.business_address ?? profile?.business_address ?? "",
      gstin: org?.gstin ?? profile?.gstin ?? "",
      state: org?.state ?? profile?.state ?? "",
    };
  }, [profile]);
  const hasGst = !!seller.gstin;

  const [billType, setBillType] = useState<BillType>("sale");

  // ---- shops -------------------------------------------------------------
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [memberShopIds, setMemberShopIds] = useState<Set<string>>(new Set());
  const [warehouseId, setWarehouseId] = useState("");

  // ---- parties -------------------------------------------------------------
  const [parties, setParties] = useState<PartyRow[]>([]);
  const [partyQuery, setPartyQuery] = useState("");
  const [partyId, setPartyId] = useState<string | null>(null);
  const [partyName, setPartyName] = useState("");
  const [partyAddress, setPartyAddress] = useState("");
  const [partyGstin, setPartyGstin] = useState("");
  const [showPartyPicker, setShowPartyPicker] = useState(false);
  const [showPartyForm, setShowPartyForm] = useState(false);

  // ---- bill-level fields ---------------------------------------------------
  const [invoiceDate, setInvoiceDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [placeOfSupply, setPlaceOfSupply] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "credit">("cash");
  const [overallDiscountType, setOverallDiscountType] = useState<DiscountType>("flat");
  const [overallDiscountValue, setOverallDiscountValue] = useState("0");

  // ---- line items -----------------------------------------------------------
  const [items, setItems] = useState<InvItem[]>([]);
  const [lines, setLines] = useState<Line[]>([]);
  const [itemQuery, setItemQuery] = useState("");
  const [showItemPicker, setShowItemPicker] = useState(false);

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [completedBill, setCompletedBill] = useState<CompletedBill | null>(null);

  // -------------------------------------------------------------------------
  // Load shops, member-shop scope, parties, and inventory for the chosen shop.
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!user) return;
    (async () => {
      const [wh, ms, pa] = await Promise.all([
        supabase.from("warehouses").select("id, name").order("created_at"),
        sb.from("member_shops").select("warehouse_id").eq("profile_id", user.id),
        sb.from("parties").select("*").order("name"),
      ]);
      const whList = (wh.data as Warehouse[] | null) ?? [];
      setWarehouses(whList);
      const scoped = new Set(((ms.data as { warehouse_id: string }[] | null) ?? []).map((r) => r.warehouse_id));
      setMemberShopIds(scoped);
      setParties((pa.data as PartyRow[] | null) ?? []);

      // Mirror can_write_shop: owners always see every shop; everyone else is
      // limited to their assigned shops if they have any assigned.
      const effective =
        role === "owner" || scoped.size === 0 ? whList : whList.filter((w) => scoped.has(w.id));
      if (effective.length >= 1) setWarehouseId((cur) => cur || effective[0].id);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, role]);

  const shopOptions = useMemo(() => {
    if (role === "owner" || memberShopIds.size === 0) return warehouses;
    return warehouses.filter((w) => memberShopIds.has(w.id));
  }, [warehouses, memberShopIds, role]);

  const loadItems = useCallback(async () => {
    if (!warehouseId) {
      setItems([]);
      return;
    }
    const { data } = await supabase
      .from("inventory_items")
      .select("id, name, stock, price, cost_price, warehouse_id")
      .eq("warehouse_id", warehouseId)
      .order("name");
    setItems(
      ((data as { id: string; name: string; stock: number; price: number; cost_price: number; warehouse_id: string }[] | null) ?? []).map(
        (r) => ({ ...r, price: Number(r.price), cost_price: Number(r.cost_price) }),
      ),
    );
  }, [warehouseId]);

  useEffect(() => {
    void loadItems();
  }, [loadItems]);

  // Default place of supply to the seller's own state until the person
  // (or a selected party) says otherwise.
  useEffect(() => {
    if (!placeOfSupply && seller.state) setPlaceOfSupply(seller.state);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seller.state]);

  // -------------------------------------------------------------------------
  // Party picker
  // -------------------------------------------------------------------------
  const partyTypeMatch = billType === "sale" ? ["customer", "both"] : ["vendor", "both"];
  const partyMatches = useMemo(() => {
    const q = partyQuery.trim().toLowerCase();
    return parties
      .filter((p) => partyTypeMatch.includes(p.type))
      .filter((p) => !q || p.name.toLowerCase().includes(q))
      .slice(0, 8);
  }, [parties, partyQuery, billType]); // eslint-disable-line react-hooks/exhaustive-deps

  const pickParty = (p: PartyRow) => {
    setPartyId(p.id);
    setPartyName(p.name);
    setPartyAddress(p.address ?? "");
    setPartyGstin(p.gst_no ?? "");
    if (p.state) setPlaceOfSupply(p.state);
    setPartyQuery(p.name);
    setShowPartyPicker(false);
  };

  const clearParty = () => {
    setPartyId(null);
    setPartyName("");
    setPartyAddress("");
    setPartyGstin("");
    setPartyQuery("");
  };

  const isFirstRender = useRef(true);
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    // Party type (customer vs vendor) and line pricing (selling price vs
    // cost paid) mean different things per mode — start fresh on toggle.
    clearParty();
    setLines([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [billType]);

  // Walk-in / freeform name: if nothing was picked from the list, whatever
  // the person typed is still a valid customer/supplier name for the bill.
  const effectivePartyName = partyId ? partyName : partyQuery.trim();

  // -------------------------------------------------------------------------
  // Line items
  // -------------------------------------------------------------------------
  const itemMatches = useMemo(() => {
    const q = itemQuery.trim().toLowerCase();
    if (!q) return items.slice(0, 8);
    return items.filter((i) => i.name.toLowerCase().includes(q)).slice(0, 8);
  }, [items, itemQuery]);

  const addExistingLine = (it: InvItem) => {
    // Staff can't see the item's stored cost_price (Inventory hides it from
    // them too) — so for a Supplier Bill they start from a blank price and
    // type what was actually paid, rather than seeing the old figure.
    const prefillAmount =
      billType === "sale" ? it.price : showCostPrice ? it.cost_price : 0;
    setLines((ls) => [
      ...ls,
      {
        key: newKey(),
        itemId: it.id,
        name: it.name,
        qty: "1",
        unitAmount: String(prefillAmount),
        lineDiscount: "0",
        hsn: "",
        gstRate: 0,
        customGstMode: false,
        currentStock: it.stock,
      },
    ]);
    setItemQuery("");
    setShowItemPicker(false);
  };

  const addNewLine = () => {
    setLines((ls) => [
      ...ls,
      {
        key: newKey(),
        itemId: null,
        name: itemQuery.trim() || "New item",
        qty: "1",
        unitAmount: "0",
        lineDiscount: "0",
        hsn: "",
        gstRate: 0,
        customGstMode: false,
        currentStock: null,
      },
    ]);
    setItemQuery("");
    setShowItemPicker(false);
  };

  const updateLine = (key: string, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const removeLine = (key: string) => setLines((ls) => ls.filter((l) => l.key !== key));

  // -------------------------------------------------------------------------
  // Totals — subtotal → taxable value → GST split → grand total, all live.
  // -------------------------------------------------------------------------
  const computed = useMemo(() => {
    const rows = lines.map((l) => {
      const qty = Number(l.qty) || 0;
      const amt = Number(l.unitAmount) || 0;
      const disc = Math.min(Number(l.lineDiscount) || 0, qty * amt);
      const lineTotal = Math.max(0, qty * amt - disc);
      return { ...l, qty, amt, disc, lineTotal };
    });
    const subtotal = rows.reduce((s, r) => s + r.lineTotal, 0);
    const overallDiscValue = Number(overallDiscountValue) || 0;
    const overallDiscAmount =
      overallDiscountType === "percent" ? (subtotal * overallDiscValue) / 100 : Math.min(overallDiscValue, subtotal);
    const ratio = subtotal > 0 ? (subtotal - overallDiscAmount) / subtotal : 1;

    const sameState =
      hasGst && seller.state && placeOfSupply && seller.state.trim().toLowerCase() === placeOfSupply.trim().toLowerCase();

    let totalTaxable = 0;
    let totalCgst = 0;
    let totalSgst = 0;
    let totalIgst = 0;
    const withTax = rows.map((r) => {
      const taxableValue = r.lineTotal * ratio;
      const gstRate = hasGst ? r.gstRate : 0;
      const gstAmount = (taxableValue * gstRate) / 100;
      const cgst = hasGst && sameState ? gstAmount / 2 : 0;
      const sgst = hasGst && sameState ? gstAmount / 2 : 0;
      const igst = hasGst && !sameState ? gstAmount : 0;
      totalTaxable += taxableValue;
      totalCgst += cgst;
      totalSgst += sgst;
      totalIgst += igst;
      return { ...r, taxableValue, cgst, sgst, igst };
    });
    const totalGst = totalCgst + totalSgst + totalIgst;
    const grandTotal = totalTaxable + totalGst;

    const qtyByItem = new Map<string, number>();
    for (const r of withTax) {
      if (r.itemId) qtyByItem.set(r.itemId, (qtyByItem.get(r.itemId) ?? 0) + r.qty);
    }
    const withStockFlag = withTax.map((r) => {
      const stock = r.itemId ? items.find((i) => i.id === r.itemId)?.stock ?? 0 : Infinity;
      const totalQtyForItem = r.itemId ? qtyByItem.get(r.itemId) ?? r.qty : r.qty;
      const overStock = billType === "sale" && !!r.itemId && totalQtyForItem > stock;
      return { ...r, overStock };
    });

    return {
      rows: withStockFlag,
      subtotal,
      overallDiscAmount,
      totalTaxable,
      totalCgst,
      totalSgst,
      totalIgst,
      totalGst,
      grandTotal,
      sameState,
    };
  }, [lines, overallDiscountType, overallDiscountValue, hasGst, seller.state, placeOfSupply, items, billType]);

  // -------------------------------------------------------------------------
  // Submit
  // -------------------------------------------------------------------------
  const submit = async () => {
    setErr(null);
    if (!user) return;
    if (!warehouseId) return setErr("Pick a shop first.");
    if (lines.length === 0) return setErr("Add at least one line item.");
    if (paymentMethod === "credit" && !partyId) {
      return setErr("Credit bills need a party selected, so the amount lands in their ledger.");
    }
    for (const r of computed.rows) {
      if (!r.qty || r.qty <= 0) return setErr(`Enter a valid quantity for "${r.name}".`);
    }
    if (billType === "sale") {
      const qtyByItem = new Map<string, number>();
      for (const r of computed.rows) {
        if (!r.itemId) continue;
        qtyByItem.set(r.itemId, (qtyByItem.get(r.itemId) ?? 0) + r.qty);
      }
      for (const [itemId, totalQty] of qtyByItem) {
        const stock = items.find((i) => i.id === itemId)?.stock ?? 0;
        if (totalQty > stock) {
          const name = items.find((i) => i.id === itemId)?.name ?? "item";
          return setErr(`Cannot sell ${totalQty} of "${name}" — only ${stock} in stock.`);
        }
      }
    }

    setBusy(true);
    try {
      // 1. Invoice number (atomic RPC — never collides on concurrent bills).
      const { data: invNo, error: invErr } = await sb.rpc("next_invoice_number", { _bill_type: billType });
      if (invErr) throw new Error(invErr.message);
      const invoiceNumber = invNo as string;

      // 2. Create any "add as new item" lines as real inventory rows first.
      const resolvedLines = [...computed.rows];
      for (let i = 0; i < resolvedLines.length; i++) {
        const r = resolvedLines[i];
        if (!r.itemId) {
          const ins = await supabase
            .from("inventory_items")
            .insert({
              user_id: user.id,
              name: r.name,
              category: "General",
              stock: 0,
              min_stock: 0,
              price: billType === "sale" ? r.amt : 0,
              cost_price: billType === "purchase" ? r.amt : 0,
              warehouse_id: warehouseId,
            })
            .select("id")
            .single();
          if (ins.error) throw new Error(ins.error.message);
          resolvedLines[i] = { ...r, itemId: (ins.data as { id: string }).id, currentStock: 0 };
        }
      }

      // 3. The bill itself.
      const billPayload: Record<string, unknown> = {
        user_id: user.id,
        warehouse_id: warehouseId,
        bill_type: billType,
        invoice_number: invoiceNumber,
        invoice_date: invoiceDate,
        party_id: partyId,
        payment_method: paymentMethod,
        subtotal: computed.subtotal,
        discount_type: overallDiscountType,
        discount_value: Number(overallDiscountValue) || 0,
        discount_amount: computed.overallDiscAmount,
        total: computed.grandTotal,
        place_of_supply: hasGst ? placeOfSupply || null : null,
      };
      if (billType === "sale") {
        billPayload.customer_name = effectivePartyName || null;
        billPayload.customer_address = partyAddress || null;
        billPayload.customer_gstin = hasGst ? partyGstin || null : null;
      } else {
        billPayload.supplier_name = effectivePartyName || null;
        billPayload.supplier_address = partyAddress || null;
        billPayload.supplier_gstin = hasGst ? partyGstin || null : null;
        billPayload.supplier_invoice_number = null;
      }

      const billIns = await sb.from("bills").insert(billPayload).select("id").single();
      if (billIns.error) throw new Error(billIns.error.message);
      const billId = (billIns.data as { id: string }).id;

      // 4. Bill line items.
      const itemRows = resolvedLines.map((r) => ({
        bill_id: billId,
        item_id: r.itemId,
        item_name: r.name,
        quantity: r.qty,
        unit_price: r.amt,
        unit_cost: billType === "sale" ? items.find((i) => i.id === r.itemId)?.cost_price ?? 0 : r.amt,
        line_discount: r.disc,
        line_total: r.lineTotal,
        hsn_sac_code: hasGst ? r.hsn || null : null,
        gst_rate: hasGst ? r.gstRate : 0,
        taxable_value: r.taxableValue,
        cgst_amount: r.cgst,
        sgst_amount: r.sgst,
        igst_amount: r.igst,
      }));
      const biIns = await sb.from("bill_items").insert(itemRows);
      if (biIns.error) throw new Error(biIns.error.message);

      // 5. Stock movement + adjustment log per line (a running map handles
      // multiple lines that reference the same item), then sales rows for a
      // Sale Bill.
      const stockMap = new Map<string, number>();
      for (const r of resolvedLines) {
        const known = stockMap.has(r.itemId!)
          ? stockMap.get(r.itemId!)!
          : r.currentStock ?? items.find((i) => i.id === r.itemId)?.stock ?? 0;
        const after = billType === "sale" ? known - r.qty : known + r.qty;
        stockMap.set(r.itemId!, after);
        const reason =
          billType === "sale" ? `Sale — Bill #${invoiceNumber}` : `Purchase — Bill #${invoiceNumber}`;
        const adj = await supabase
          .from("stock_adjustments")
          .insert({ user_id: user.id, item_id: r.itemId!, new_stock: after, reason });
        if (adj.error) throw new Error(adj.error.message);
        const upd = await supabase.from("inventory_items").update({ stock: after }).eq("id", r.itemId!);
        if (upd.error) throw new Error(upd.error.message);

        if (billType === "sale") {
          const saleIns = await supabase.from("sales").insert({
            user_id: user.id,
            item_id: r.itemId,
            warehouse_id: warehouseId,
            item_name: r.name,
            quantity: r.qty,
            unit_price: r.amt,
            unit_cost: items.find((i) => i.id === r.itemId)?.cost_price ?? 0,
            total: r.lineTotal,
          });
          if (saleIns.error) throw new Error(saleIns.error.message);
        }
      }

      // 6. Done — show the printable invoice and reset the line-item builder.
      setCompletedBill({
        invoiceNumber,
        billType,
        invoiceDate,
        shopName: shopOptions.find((w) => w.id === warehouseId)?.name ?? warehouses.find((w) => w.id === warehouseId)?.name ?? "",
        partyName: effectivePartyName,
        partyAddress,
        partyGstin,
        placeOfSupply,
        paymentMethod,
        rows: resolvedLines,
        subtotal: computed.subtotal,
        discountAmount: computed.overallDiscAmount,
        totalCgst: computed.totalCgst,
        totalSgst: computed.totalSgst,
        totalIgst: computed.totalIgst,
        grandTotal: computed.grandTotal,
      });
      setLines([]);
      clearParty();
      void loadItems();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  if (!canWrite) {
    return (
      <AppShell active="createBill" title="Create Bill">
        <div className="px-4 md:px-10 py-10 text-sm text-muted-foreground">
          You don't have permission to create bills.
        </div>
      </AppShell>
    );
  }

  if (completedBill) {
    return (
      <AppShell active="createBill" title="Create Bill">
        <div className="px-4 md:px-10 py-6 md:py-8 max-w-3xl space-y-4">
          <InvoiceView bill={completedBill} seller={seller} />
          <div className="flex gap-2 print:hidden">
            <button
              onClick={() => window.print()}
              className="inline-flex items-center gap-1.5 rounded-full bg-primary text-primary-foreground px-4 py-2 text-sm"
            >
              <Printer size={14} /> Print / Save PDF
            </button>
            <button
              onClick={() => setCompletedBill(null)}
              className="rounded-full border border-border bg-card px-4 py-2 text-sm"
            >
              New bill
            </button>
          </div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell active="createBill" title="Create Bill">
      <div className="px-4 md:px-10 py-6 md:py-8 max-w-3xl space-y-5">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-widest text-muted-foreground">GST-compliant invoicing</p>
            <h1 className="mt-1 font-display text-3xl md:text-4xl text-ink">Create Bill</h1>
          </div>
          <div className="inline-flex items-center gap-1 rounded-full border border-border bg-card p-0.5 text-sm">
            <button
              onClick={() => setBillType("sale")}
              className={`px-4 py-1.5 rounded-full transition ${billType === "sale" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
            >
              Sale Bill
            </button>
            <button
              onClick={() => setBillType("purchase")}
              className={`px-4 py-1.5 rounded-full transition ${billType === "purchase" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
            >
              Supplier Bill
            </button>
          </div>
        </header>

        {err && <div className="rounded-lg bg-destructive/10 text-destructive text-sm px-3 py-2">{err}</div>}

        {/* Shop + date + payment method */}
        <section className="card-warm p-4 md:p-5 grid gap-3 sm:grid-cols-3">
          <label className="block">
            <span className="flex items-center gap-1 text-xs uppercase tracking-wider text-muted-foreground mb-1">
              <Store size={12} /> Shop
            </span>
            <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} className="input">
              {shopOptions.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="block text-xs uppercase tracking-wider text-muted-foreground mb-1">Invoice date</span>
            <input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} className="input" />
          </label>
          <label className="block">
            <span className="flex items-center gap-1 text-xs uppercase tracking-wider text-muted-foreground mb-1">
              <ArrowLeftRight size={12} /> Payment
            </span>
            <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value as "cash" | "credit")} className="input">
              <option value="cash">Cash / paid now</option>
              <option value="credit">Credit — settle later</option>
            </select>
          </label>
        </section>

        {/* Party picker */}
        <section className="card-warm p-4 md:p-5 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs uppercase tracking-wider text-muted-foreground">
              {billType === "sale" ? "Customer" : "Supplier"}
            </span>
            {partyId && (
              <button onClick={clearParty} className="text-xs text-muted-foreground hover:text-destructive inline-flex items-center gap-1">
                <X size={12} /> Clear
              </button>
            )}
          </div>
          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              value={partyQuery}
              onChange={(e) => {
                setPartyQuery(e.target.value);
                setPartyId(null);
                setShowPartyPicker(true);
              }}
              onFocus={() => setShowPartyPicker(true)}
              onBlur={() => setTimeout(() => setShowPartyPicker(false), 150)}
              placeholder={billType === "sale" ? "Search or type a walk-in customer name…" : "Search supplier…"}
              className="input pl-9"
            />
            {showPartyPicker && (partyMatches.length > 0 || partyQuery.trim()) && (
              <div className="absolute z-10 mt-1 w-full rounded-lg border border-border bg-card shadow-lg overflow-hidden">
                {partyMatches.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => pickParty(p)}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-muted flex items-center justify-between"
                  >
                    <span>{p.name}</span>
                    <span className="text-xs text-muted-foreground capitalize">{p.type}</span>
                  </button>
                ))}
                {can.manageParties(role) && (
                  <button
                    onClick={() => setShowPartyForm(true)}
                    className="w-full text-left px-3 py-2 text-sm text-primary hover:bg-muted flex items-center gap-1.5 border-t border-border"
                  >
                    <UserPlus size={13} /> Add new party{partyQuery.trim() ? ` "${partyQuery.trim()}"` : ""}
                  </button>
                )}
              </div>
            )}
          </div>
          {partyId && (
            <div className="grid gap-2 sm:grid-cols-2 pt-1">
              <MiniField label="Address" value={partyAddress} onChange={setPartyAddress} />
              {hasGst && <MiniField label="GSTIN" value={partyGstin} onChange={setPartyGstin} />}
            </div>
          )}
          {hasGst && (
            <div className="grid gap-2 sm:grid-cols-2 pt-1">
              <MiniField label="Place of supply (state)" value={placeOfSupply} onChange={setPlaceOfSupply} />
            </div>
          )}
        </section>

        {/* Line items */}
        <section className="card-warm p-4 md:p-5 space-y-3">
          <span className="text-xs uppercase tracking-wider text-muted-foreground">Line items</span>
          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              value={itemQuery}
              onChange={(e) => {
                setItemQuery(e.target.value);
                setShowItemPicker(true);
              }}
              onFocus={() => setShowItemPicker(true)}
              onBlur={() => setTimeout(() => setShowItemPicker(false), 150)}
              placeholder={warehouseId ? "Search inventory…" : "Pick a shop first"}
              disabled={!warehouseId}
              className="input pl-9"
            />
            {showItemPicker && warehouseId && (
              <div className="absolute z-10 mt-1 w-full rounded-lg border border-border bg-card shadow-lg overflow-hidden">
                {itemMatches.map((it) => (
                  <button
                    key={it.id}
                    onClick={() => addExistingLine(it)}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-muted flex items-center justify-between"
                  >
                    <span>{it.name}</span>
                    <span className="text-xs text-muted-foreground tabular-nums">Stock {it.stock}</span>
                  </button>
                ))}
                <button
                  onClick={addNewLine}
                  className="w-full text-left px-3 py-2 text-sm text-primary hover:bg-muted flex items-center gap-1.5 border-t border-border"
                >
                  <Plus size={13} /> Add as new item{itemQuery.trim() ? ` "${itemQuery.trim()}"` : ""}
                </button>
              </div>
            )}
          </div>

          <div className="space-y-3">
            {computed.rows.map((r) => {
              return (
                <div key={r.key} className="rounded-lg border border-border p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    {r.itemId ? (
                      <div className="text-sm font-medium text-ink">{r.name}</div>
                    ) : (
                      <input
                        value={r.name}
                        onChange={(e) => updateLine(r.key, { name: e.target.value })}
                        className="input text-sm font-medium"
                        placeholder="Item name"
                      />
                    )}
                    <button onClick={() => removeLine(r.key)} className="text-muted-foreground hover:text-destructive shrink-0">
                      <Trash2 size={14} />
                    </button>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <MiniField label="Qty" value={r.qty} onChange={(v) => updateLine(r.key, { qty: v })} type="number" />
                    <MiniField
                      label={billType === "sale" ? "Selling price (₹)" : "Cost paid (₹)"}
                      value={r.unitAmount}
                      onChange={(v) => updateLine(r.key, { unitAmount: v })}
                      type="number"
                    />
                    <MiniField label="Line discount (₹)" value={r.lineDiscount} onChange={(v) => updateLine(r.key, { lineDiscount: v })} type="number" />
                  </div>
                  {r.overStock && (
                    <p className="text-xs text-destructive">Only {items.find((i) => i.id === r.itemId)?.stock ?? 0} in stock — reduce quantity.</p>
                  )}
                  {hasGst && (
                    <div className="grid grid-cols-2 gap-2">
                      <MiniField label="HSN/SAC" value={r.hsn} onChange={(v) => updateLine(r.key, { hsn: v })} />
                      <label className="block">
                        <span className="block text-[11px] text-muted-foreground mb-0.5">GST rate</span>
                        <select
                          value={r.customGstMode ? "custom" : String(r.gstRate)}
                          onChange={(e) => {
                            if (e.target.value === "custom") updateLine(r.key, { customGstMode: true });
                            else updateLine(r.key, { gstRate: Number(e.target.value), customGstMode: false });
                          }}
                          className="input text-sm"
                        >
                          {GST_RATES.map((g) => (
                            <option key={g} value={g}>
                              {g}%
                            </option>
                          ))}
                          <option value="custom">Custom…</option>
                        </select>
                        {r.customGstMode && (
                          <input
                            type="number"
                            value={r.gstRate}
                            onChange={(e) => updateLine(r.key, { gstRate: Number(e.target.value) || 0 })}
                            placeholder="Custom GST %"
                            className="input text-sm mt-1"
                          />
                        )}
                      </label>
                    </div>
                  )}
                  <div className="text-right text-xs text-muted-foreground">
                    Line total {inr(r.lineTotal)}
                    {hasGst && <> · GST {inr(r.cgst + r.sgst + r.igst)}</>}
                  </div>
                </div>
              );
            })}
            {lines.length === 0 && (
              <p className="text-sm text-muted-foreground py-4 text-center">No line items yet — search inventory above.</p>
            )}
          </div>
        </section>

        {/* Discount + totals */}
        <section className="card-warm p-4 md:p-5 space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-xs uppercase tracking-wider text-muted-foreground">Overall discount</span>
            <select
              value={overallDiscountType}
              onChange={(e) => setOverallDiscountType(e.target.value as DiscountType)}
              className="input w-24 text-sm"
            >
              <option value="flat">₹ flat</option>
              <option value="percent">%</option>
            </select>
            <input
              type="number"
              value={overallDiscountValue}
              onChange={(e) => setOverallDiscountValue(e.target.value)}
              className="input w-28 text-sm"
            />
          </div>

          <div className="border-t border-border pt-3 space-y-1 text-sm">
            <Row label="Subtotal" value={inr(computed.subtotal)} />
            <Row label="Discount" value={"−" + inr(computed.overallDiscAmount)} />
            <Row label="Taxable value" value={inr(computed.totalTaxable)} />
            {hasGst && computed.sameState && <Row label="CGST + SGST" value={inr(computed.totalCgst + computed.totalSgst)} />}
            {hasGst && !computed.sameState && <Row label="IGST" value={inr(computed.totalIgst)} />}
            <Row label="Grand total" value={inr(computed.grandTotal)} bold />
          </div>

          <button
            onClick={submit}
            disabled={busy}
            className="w-full rounded-lg bg-primary text-primary-foreground px-4 py-2.5 text-sm font-medium disabled:opacity-60"
          >
            {busy ? "Saving…" : `Save ${billType === "sale" ? "Sale" : "Supplier"} Bill`}
          </button>
        </section>
      </div>

      {showPartyForm && user && (
        <PartyForm
          userId={user.id}
          defaultType={billType === "sale" ? "customer" : "vendor"}
          onClose={() => setShowPartyForm(false)}
          onSaved={(p) => {
            setParties((ps) => [...ps, p]);
            pickParty(p);
            setShowPartyForm(false);
          }}
        />
      )}

      <style>{`.input { width: 100%; border-radius: 0.5rem; border: 1px solid hsl(var(--border)); background: hsl(var(--card)); padding: 0.5rem 0.75rem; font-size: 0.875rem; outline: none; }
        .input:focus { box-shadow: 0 0 0 2px hsl(var(--ring) / 0.4); }`}</style>
    </AppShell>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className={`flex justify-between ${bold ? "font-display text-lg text-ink pt-1" : "text-muted-foreground"}`}>
      <span>{label}</span>
      <span className={`tabular-nums ${bold ? "text-ink" : ""}`}>{value}</span>
    </div>
  );
}

function MiniField({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
}) {
  return (
    <label className="block">
      <span className="block text-[11px] text-muted-foreground mb-0.5">{label}</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} type={type} className="input text-sm" />
    </label>
  );
}

// ---------------------------------------------------------------------------
// Printable invoice
// ---------------------------------------------------------------------------
type CompletedBill = {
  invoiceNumber: string;
  billType: BillType;
  invoiceDate: string;
  shopName: string;
  partyName: string;
  partyAddress: string;
  partyGstin: string;
  placeOfSupply: string;
  paymentMethod: "cash" | "credit";
  rows: { name: string; qty: number; amt: number; disc: number; lineTotal: number; hsn: string; gstRate: number; cgst: number; sgst: number; igst: number }[];
  subtotal: number;
  discountAmount: number;
  totalCgst: number;
  totalSgst: number;
  totalIgst: number;
  grandTotal: number;
};

function InvoiceView({
  bill,
  seller,
}: {
  bill: CompletedBill;
  seller: { name: string; address: string; gstin: string; state: string };
}) {
  const hasGst = !!seller.gstin;
  return (
    <div className="card-warm p-6 md:p-8 print:shadow-none print:border-none">
      <div className="flex items-start justify-between gap-4 border-b border-border pb-4">
        <div>
          <div className="flex items-center gap-1.5 text-ink font-display text-xl">
            <ReceiptText size={18} className="text-primary" /> {seller.name}
          </div>
          {seller.address && <p className="text-xs text-muted-foreground mt-1">{seller.address}</p>}
          {hasGst && <p className="text-xs text-muted-foreground">GSTIN: {seller.gstin}</p>}
        </div>
        <div className="text-right text-sm">
          <div className="font-medium text-ink">{bill.invoiceNumber}</div>
          <div className="text-xs text-muted-foreground">{new Date(bill.invoiceDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</div>
          <div className="text-xs text-muted-foreground capitalize">{bill.billType} bill · {bill.paymentMethod}</div>
        </div>
      </div>

      <div className="grid sm:grid-cols-2 gap-4 py-4 text-sm">
        <div>
          <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1">
            {bill.billType === "sale" ? "Bill to" : "Bill from"}
          </p>
          <p className="text-ink">{bill.partyName || "Walk-in"}</p>
          {bill.partyAddress && <p className="text-xs text-muted-foreground">{bill.partyAddress}</p>}
          {hasGst && bill.partyGstin && <p className="text-xs text-muted-foreground">GSTIN: {bill.partyGstin}</p>}
        </div>
        <div className="sm:text-right">
          <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1">Shop</p>
          <p className="text-ink">{bill.shopName}</p>
          {hasGst && bill.placeOfSupply && <p className="text-xs text-muted-foreground">Place of supply: {bill.placeOfSupply}</p>}
        </div>
      </div>

      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground border-y border-border">
            <th className="py-2">Item</th>
            {hasGst && <th className="py-2">HSN/SAC</th>}
            <th className="py-2 text-right">Qty</th>
            <th className="py-2 text-right">Rate</th>
            {hasGst && <th className="py-2 text-right">GST</th>}
            <th className="py-2 text-right">Amount</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {bill.rows.map((r, i) => (
            <tr key={i}>
              <td className="py-2 text-ink">{r.name}</td>
              {hasGst && <td className="py-2 text-xs text-muted-foreground">{r.hsn || "—"}</td>}
              <td className="py-2 text-right tabular-nums">{r.qty}</td>
              <td className="py-2 text-right tabular-nums">{inr(r.amt)}</td>
              {hasGst && <td className="py-2 text-right tabular-nums">{r.gstRate}%</td>}
              <td className="py-2 text-right tabular-nums">{inr(r.lineTotal)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="pt-4 flex justify-end">
        <div className="w-full max-w-xs space-y-1 text-sm">
          <Row label="Subtotal" value={inr(bill.subtotal)} />
          <Row label="Discount" value={"−" + inr(bill.discountAmount)} />
          {hasGst && bill.totalCgst + bill.totalSgst > 0 && <Row label="CGST + SGST" value={inr(bill.totalCgst + bill.totalSgst)} />}
          {hasGst && bill.totalIgst > 0 && <Row label="IGST" value={inr(bill.totalIgst)} />}
          <Row label="Grand total" value={inr(bill.grandTotal)} bold />
        </div>
      </div>

      <div className="mt-10 flex justify-end">
        <div className="text-center text-xs text-muted-foreground">
          <div className="w-40 border-t border-border pt-1">Authorised signature</div>
        </div>
      </div>
    </div>
  );
}
