import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  TrendingUp,
  TrendingDown,
  Store,
  FileText,
  ShoppingCart,
  Receipt,
  Scale,
  Landmark,
  Waves,
  BookOpen,
  Search,
  X,
  AlertTriangle,
} from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/hooks/use-auth";
import { useProfile, type Role } from "@/hooks/use-profile";
import { supabase } from "@/integrations/supabase/client";
import { useT } from "@/lib/i18n";
import { can } from "@/lib/permissions";
import { computeAccounting } from "@/lib/accounting";
import { InvoiceView, Row, type CompletedBill } from "@/components/InvoiceView";

export const Route = createFileRoute("/reports")({
  component: ReportsPage,
  head: () => ({
    meta: [
      { title: "Reports · Hisab" },
      {
        name: "description",
        content:
          "Bills, sales, purchases, P&L and simplified accounting statements for your shop.",
      },
    ],
  }),
});

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------
type Warehouse = { id: string; name: string };
type Sale = {
  item_name: string;
  warehouse_id: string | null;
  quantity: number;
  unit_price: number;
  unit_cost: number;
  total: number;
  created_at: string;
};
type Expense = {
  id: string;
  label: string;
  amount: number;
  cadence: "one-time" | "monthly" | "weekly" | "yearly";
  warehouse_id: string | null;
  created_at: string;
};
type Bill = {
  id: string;
  warehouse_id: string;
  bill_type: "sale" | "purchase";
  invoice_number: string | null;
  invoice_date: string;
  party_id: string | null;
  customer_name: string | null;
  supplier_name: string | null;
  payment_method: "cash" | "credit" | null;
  subtotal: number;
  discount_amount: number;
  total: number;
  created_at: string;
};
type LedgerRow = { party_id: string; date: string; direction: "payable" | "receivable"; amount: number };
type PartyLite = { id: string; name: string };

type ReportKey = "bills" | "purchases" | "sales" | "pnl" | "trial" | "balance" | "cashflow" | "final";

const REPORTS: { key: ReportKey; label: string; icon: React.ReactNode }[] = [
  { key: "bills", label: "Bills", icon: <FileText size={14} /> },
  { key: "purchases", label: "Purchases", icon: <ShoppingCart size={14} /> },
  { key: "sales", label: "Sales", icon: <Receipt size={14} /> },
  { key: "pnl", label: "Profit & Loss", icon: <Scale size={14} /> },
  { key: "trial", label: "Trial Balance", icon: <BookOpen size={14} /> },
  { key: "balance", label: "Balance Sheet", icon: <Landmark size={14} /> },
  { key: "cashflow", label: "Cash Flow", icon: <Waves size={14} /> },
  { key: "final", label: "Final Accounts", icon: <Scale size={14} /> },
];

const inrRound = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");

// Loose escape-hatch for the newer tables, matching the convention already
// used in parties.tsx / vendors.tsx / create-bill.tsx.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sb = { from: (t: string) => any };
const sb = supabase as unknown as Sb;

function inRange(dateStr: string, from: string, to: string) {
  if (from && dateStr < from) return false;
  if (to && dateStr > `${to}T23:59:59`) return false;
  return true;
}

function ReportsPage() {
  const { user } = useAuth();
  const { profile } = useProfile();
  const { t } = useT();
  const role = profile?.role;

  if (!can.viewReports(role)) {
    return (
      <AppShell active="reports" title={t("rep.title")}>
        <div className="px-4 md:px-10 py-10 text-sm text-muted-foreground">
          You don't have permission to view reports.
        </div>
      </AppShell>
    );
  }

  return <ReportsBody userId={user?.id} role={role} t={t} />;
}

function ReportsBody({
  userId,
  role,
  t,
}: {
  userId: string | undefined;
  role: Role | undefined;
  t: (k: string) => string;
}) {
  const [tab, setTab] = useState<ReportKey>("bills");

  // Shared filter bar
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [memberShopIds, setMemberShopIds] = useState<Set<string>>(new Set());
  const [scope, setScope] = useState<string>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  // Data
  const [sales, setSales] = useState<Sale[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [bills, setBills] = useState<Bill[]>([]);
  const [parties, setParties] = useState<PartyLite[]>([]);
  const [ledger, setLedger] = useState<LedgerRow[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!userId) return;
    const [wh, ms, sl, ex, bl, pa, lg] = await Promise.all([
      supabase.from("warehouses").select("id, name").order("created_at"),
      sb.from("member_shops").select("warehouse_id").eq("profile_id", userId),
      supabase
        .from("sales")
        .select("item_name, warehouse_id, quantity, unit_price, unit_cost, total, created_at")
        .order("created_at", { ascending: false }),
      supabase.from("expenses").select("id, label, amount, cadence, warehouse_id, created_at").order("created_at"),
      sb.from("bills").select("*").order("invoice_date", { ascending: false }),
      sb.from("parties").select("id, name"),
      sb.from("party_ledger").select("party_id, date, direction, amount"),
    ]);
    if (wh.error) setErr(wh.error.message);
    else if (sl.error) setErr(sl.error.message);
    else if (ex.error) setErr(ex.error.message);
    else if (bl.error) setErr(bl.error.message);
    else if (lg.error) setErr(lg.error.message);
    else setErr(null);
    setWarehouses((wh.data as Warehouse[] | null) ?? []);
    setMemberShopIds(new Set(((ms.data as { warehouse_id: string }[] | null) ?? []).map((r) => r.warehouse_id)));
    setSales(
      ((sl.data as { item_name: string; warehouse_id: string | null; quantity: number; unit_price: number; unit_cost: number; total: number; created_at: string }[] | null) ?? []).map(
        (s) => ({ ...s, unit_price: Number(s.unit_price), unit_cost: Number(s.unit_cost), total: Number(s.total) }),
      ),
    );
    setExpenses(
      ((ex.data as { id: string; label: string; amount: number; cadence: Expense["cadence"]; warehouse_id: string | null; created_at: string }[] | null) ?? []).map(
        (e) => ({ ...e, amount: Number(e.amount) }),
      ),
    );
    setBills(
      ((bl.data as Bill[] | null) ?? []).map((b) => ({
        ...b,
        subtotal: Number(b.subtotal ?? 0),
        discount_amount: Number(b.discount_amount ?? 0),
        total: Number(b.total ?? 0),
      })),
    );
    setParties((pa.data as PartyLite[] | null) ?? []);
    setLedger(((lg.data as LedgerRow[] | null) ?? []).map((r) => ({ ...r, amount: Number(r.amount) })));
  }, [userId]);

  useEffect(() => {
    if (userId) void load();
  }, [userId, load]);

  // Mirrors can_write_shop's scoping: owners (and accountant, read-only) see
  // every shop; a manager/staff-style scoped user is limited to member_shops.
  const shopOptions = useMemo(() => {
    if (role === "owner" || role === "accountant" || memberShopIds.size === 0) return warehouses;
    return warehouses.filter((w) => memberShopIds.has(w.id));
  }, [warehouses, memberShopIds, role]);

  const partyName = useCallback((id: string | null) => parties.find((p) => p.id === id)?.name ?? "", [parties]);

  // "All" means "all shops I'm allowed to see" — for an owner/accountant
  // that's every org shop, but for a scoped manager it must stay within
  // their member_shops, mirroring the write restriction used elsewhere.
  const allowedShopIds = useMemo(() => new Set(shopOptions.map((w) => w.id)), [shopOptions]);
  const inScope = useCallback((warehouseId: string | null) => (warehouseId ? allowedShopIds.has(warehouseId) : true), [allowedShopIds]);

  // ---- scoped + date-filtered slices, shared by every tab -----------------
  const scopedSales = useMemo(
    () =>
      sales.filter(
        (s) =>
          (scope === "all" ? inScope(s.warehouse_id) : s.warehouse_id === scope) &&
          inRange(s.created_at.slice(0, 10), dateFrom, dateTo),
      ),
    [sales, scope, dateFrom, dateTo, inScope],
  );
  const scopedExpenses = useMemo(
    () =>
      expenses.filter(
        (e) =>
          (scope === "all" ? e.warehouse_id === null || inScope(e.warehouse_id) : e.warehouse_id === scope || e.warehouse_id === null) &&
          inRange(e.created_at.slice(0, 10), dateFrom, dateTo),
      ),
    [expenses, scope, dateFrom, dateTo, inScope],
  );
  const scopedBills = useMemo(
    () =>
      bills.filter(
        (b) =>
          (scope === "all" ? inScope(b.warehouse_id) : b.warehouse_id === scope) && inRange(b.invoice_date, dateFrom, dateTo),
      ),
    [bills, scope, dateFrom, dateTo, inScope],
  );
  // party_ledger has no warehouse_id — it's inherently org-wide, only the
  // date range applies.
  const scopedLedger = useMemo(
    () => ledger.filter((l) => inRange(l.date.slice(0, 10), dateFrom, dateTo)),
    [ledger, dateFrom, dateTo],
  );

  const revenue = scopedSales.reduce((s, r) => s + r.total, 0);
  const cogs = scopedSales.reduce((s, r) => s + r.unit_cost * r.quantity, 0);
  const purchasesTotal = scopedBills.filter((b) => b.bill_type === "purchase").reduce((s, b) => s + b.total, 0);
  const expensesTotal = scopedExpenses.reduce((s, e) => s + e.amount, 0);
  const receivable = Math.max(0, scopedLedger.filter((l) => l.direction === "receivable").reduce((s, l) => s + l.amount, 0));
  const payable = Math.max(0, scopedLedger.filter((l) => l.direction === "payable").reduce((s, l) => s + l.amount, 0));

  const accounting = useMemo(
    () => computeAccounting({ revenue, cogs, purchasesTotal, expensesTotal, receivable, payable }),
    [revenue, cogs, purchasesTotal, expensesTotal, receivable, payable],
  );

  return (
    <AppShell active="reports" title={t("rep.title")}>
      <div className="px-4 md:px-10 py-6 md:py-8 space-y-6">
        <header>
          <p className="text-xs uppercase tracking-widest text-muted-foreground">{t("rep.pnl")}</p>
          <h1 className="mt-1 font-display text-3xl md:text-4xl text-ink">{t("rep.title")}</h1>
        </header>

        {err && <div className="rounded-lg bg-destructive/10 text-destructive text-sm px-3 py-2">{err}</div>}

        {/* Report picker */}
        <div className="flex items-center gap-1 rounded-full border border-border bg-card p-0.5 text-xs overflow-x-auto">
          {REPORTS.map((r) => (
            <button
              key={r.key}
              onClick={() => setTab(r.key)}
              className={`shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full transition whitespace-nowrap ${
                tab === r.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {r.icon} {r.label}
            </button>
          ))}
        </div>

        {/* Shared shop scope — every tab reads it */}
        <section className="card-warm p-3 md:p-4">
          <div className="flex flex-wrap items-center gap-2">
            <Store size={16} className="text-muted-foreground ml-1" />
            <ScopeTab active={scope === "all"} onClick={() => setScope("all")}>
              {t("common.allShops")}
            </ScopeTab>
            {shopOptions.map((w) => (
              <ScopeTab key={w.id} active={scope === w.id} onClick={() => setScope(w.id)}>
                {w.name}
              </ScopeTab>
            ))}
          </div>
        </section>

        {/* Shared date range — P&L keeps its own month strip instead, see below */}
        {tab !== "pnl" && (
          <section className="card-warm p-3 md:p-4 flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-sm">
              <span className="text-xs uppercase tracking-wider text-muted-foreground">From</span>
              <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="rounded-lg border border-border bg-card px-2.5 py-1.5 text-sm" />
            </label>
            <label className="flex items-center gap-2 text-sm">
              <span className="text-xs uppercase tracking-wider text-muted-foreground">To</span>
              <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="rounded-lg border border-border bg-card px-2.5 py-1.5 text-sm" />
            </label>
            {(dateFrom || dateTo) && (
              <button
                onClick={() => {
                  setDateFrom("");
                  setDateTo("");
                }}
                className="text-xs text-muted-foreground hover:text-destructive inline-flex items-center gap-1"
              >
                <X size={12} /> Clear dates
              </button>
            )}
          </section>
        )}

        {tab === "bills" && (
          <BillsReport bills={scopedBills} partyName={partyName} warehouses={warehouses} />
        )}
        {tab === "purchases" && <PurchasesReport bills={scopedBills} partyName={partyName} warehouses={warehouses} />}
        {tab === "sales" && <SalesReport sales={scopedSales} warehouses={warehouses} />}
        {tab === "pnl" && <ProfitAndLoss sales={sales} expenses={expenses} scope={scope} allowedShopIds={allowedShopIds} t={t} />}
        {tab === "trial" && <TrialBalanceReport accounting={accounting} />}
        {tab === "balance" && <BalanceSheetReport accounting={accounting} />}
        {tab === "cashflow" && <CashFlowReport accounting={accounting} />}
        {tab === "final" && <FinalAccountsReport accounting={accounting} />}
      </div>
    </AppShell>
  );
}

function ScopeTab({ children, active, onClick }: { children: React.ReactNode; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full px-4 py-1.5 text-sm transition ${
        active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted"
      }`}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// 1. Bills repository
// ---------------------------------------------------------------------------
function BillsReport({
  bills,
  partyName,
  warehouses,
  typeFilterDefault = "all",
}: {
  bills: Bill[];
  partyName: (id: string | null) => string;
  warehouses: Warehouse[];
  typeFilterDefault?: "all" | "sale" | "purchase";
}) {
  const [typeFilter, setTypeFilter] = useState<"all" | "sale" | "purchase">(typeFilterDefault);
  const [query, setQuery] = useState("");
  const [openBillId, setOpenBillId] = useState<string | null>(null);

  const whName = (id: string) => warehouses.find((w) => w.id === id)?.name ?? "—";

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return bills
      .filter((b) => typeFilter === "all" || b.bill_type === typeFilter)
      .filter((b) => {
        if (!q) return true;
        const name = b.bill_type === "sale" ? b.customer_name ?? partyName(b.party_id) : b.supplier_name ?? partyName(b.party_id);
        return (b.invoice_number ?? "").toLowerCase().includes(q) || (name ?? "").toLowerCase().includes(q);
      });
  }, [bills, typeFilter, query, partyName]);

  return (
    <section className="card-warm p-4 md:p-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1 rounded-full bg-muted p-0.5 text-xs">
          {(["all", "sale", "purchase"] as const).map((k) => (
            <button
              key={k}
              onClick={() => setTypeFilter(k)}
              className={`px-3 py-1.5 rounded-full capitalize transition ${
                typeFilter === k ? "bg-card shadow-sm text-ink" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {k}
            </button>
          ))}
        </div>
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search invoice # or party…"
            className="rounded-lg border border-border bg-card pl-8 pr-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring/40"
          />
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[640px]">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground border-b border-border">
              <th className="py-2">Invoice #</th>
              <th className="py-2">Date</th>
              <th className="py-2">Shop</th>
              <th className="py-2">Party</th>
              <th className="py-2 text-right">GST</th>
              <th className="py-2 text-right">Total</th>
              <th className="py-2">Type</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {filtered.map((b) => {
              const name = b.bill_type === "sale" ? b.customer_name || partyName(b.party_id) : b.supplier_name || partyName(b.party_id);
              const gstAmount = b.total - (b.subtotal - b.discount_amount);
              return (
                <tr key={b.id} className="cursor-pointer hover:bg-muted/40" onClick={() => setOpenBillId(b.id)}>
                  <td className="py-2 text-ink">{b.invoice_number || "—"}</td>
                  <td className="py-2 text-muted-foreground">{new Date(b.invoice_date).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}</td>
                  <td className="py-2 text-muted-foreground">{whName(b.warehouse_id)}</td>
                  <td className="py-2 text-muted-foreground">{name || "Walk-in"}</td>
                  <td className="py-2 text-right tabular-nums text-muted-foreground">{inrRound(Math.max(0, gstAmount))}</td>
                  <td className="py-2 text-right tabular-nums text-ink font-medium">{inrRound(b.total)}</td>
                  <td className="py-2">
                    <span className={`text-[10px] px-2 py-0.5 rounded-full capitalize ${b.bill_type === "sale" ? "bg-success/15 text-success" : "bg-warning/15 text-warning"}`}>
                      {b.bill_type}
                    </span>
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={7} className="py-8 text-center text-muted-foreground">
                  No bills in this range yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {openBillId && <BillDetailModal billId={openBillId} onClose={() => setOpenBillId(null)} />}
    </section>
  );
}

function BillDetailModal({ billId, onClose }: { billId: string; onClose: () => void }) {
  const { profile } = useProfile();
  const [bill, setBill] = useState<CompletedBill | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const seller = useMemo(() => {
    const org = profile?.org;
    return {
      name: org?.name ?? profile?.full_name ?? "Your business",
      address: org?.business_address ?? profile?.business_address ?? "",
      gstin: org?.gstin ?? profile?.gstin ?? "",
      state: org?.state ?? profile?.state ?? "",
    };
  }, [profile]);

  useEffect(() => {
    (async () => {
      const [b, items, wh] = await Promise.all([
        sb.from("bills").select("*").eq("id", billId).single(),
        sb.from("bill_items").select("*").eq("bill_id", billId),
        supabase.from("warehouses").select("id, name"),
      ]);
      if (b.error) return setErr(b.error.message);
      const row = b.data as Record<string, unknown>;
      const rows = ((items.data as Record<string, unknown>[] | null) ?? []).map((it) => ({
        name: String(it.item_name ?? ""),
        qty: Number(it.quantity ?? 0),
        amt: Number(it.unit_price ?? 0),
        disc: Number(it.line_discount ?? 0),
        lineTotal: Number(it.line_total ?? 0),
        hsn: String(it.hsn_sac_code ?? ""),
        gstRate: Number(it.gst_rate ?? 0),
        cgst: Number(it.cgst_amount ?? 0),
        sgst: Number(it.sgst_amount ?? 0),
        igst: Number(it.igst_amount ?? 0),
      }));
      const shopName = ((wh.data as Warehouse[] | null) ?? []).find((w) => w.id === row.warehouse_id)?.name ?? "";
      const billType = row.bill_type as "sale" | "purchase";
      setBill({
        invoiceNumber: String(row.invoice_number ?? "—"),
        billType,
        invoiceDate: String(row.invoice_date),
        shopName,
        partyName: String((billType === "sale" ? row.customer_name : row.supplier_name) ?? ""),
        partyAddress: String((billType === "sale" ? row.customer_address : row.supplier_address) ?? ""),
        partyGstin: String((billType === "sale" ? row.customer_gstin : row.supplier_gstin) ?? ""),
        placeOfSupply: String(row.place_of_supply ?? ""),
        paymentMethod: (row.payment_method as "cash" | "credit") ?? "cash",
        rows,
        subtotal: Number(row.subtotal ?? 0),
        discountAmount: Number(row.discount_amount ?? 0),
        totalCgst: rows.reduce((s, r) => s + r.cgst, 0),
        totalSgst: rows.reduce((s, r) => s + r.sgst, 0),
        totalIgst: rows.reduce((s, r) => s + r.igst, 0),
        grandTotal: Number(row.total ?? 0),
      });
    })();
  }, [billId]);

  return (
    <div className="fixed inset-0 z-50 bg-ink/40 backdrop-blur-sm grid place-items-center p-4 print:static print:bg-transparent print:backdrop-blur-none print:p-0" onClick={onClose}>
      <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto print:max-h-none print:overflow-visible" onClick={(e) => e.stopPropagation()}>
        {err && <div className="rounded-lg bg-destructive/10 text-destructive text-sm px-3 py-2 mb-2">{err}</div>}
        {bill ? (
          <div className="space-y-3">
            <InvoiceView bill={bill} seller={seller} />
            <div className="flex gap-2 print:hidden">
              <button onClick={() => window.print()} className="rounded-full bg-primary text-primary-foreground px-4 py-2 text-sm">
                Print
              </button>
              <button onClick={onClose} className="rounded-full border border-border bg-card px-4 py-2 text-sm">
                Close
              </button>
            </div>
          </div>
        ) : (
          <div className="card-warm p-8 text-center text-sm text-muted-foreground">Loading…</div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 2. Purchases — Supplier Bill rows
// ---------------------------------------------------------------------------
function PurchasesReport({ bills, partyName, warehouses }: { bills: Bill[]; partyName: (id: string | null) => string; warehouses: Warehouse[] }) {
  const purchases = useMemo(() => bills.filter((b) => b.bill_type === "purchase"), [bills]);
  const total = purchases.reduce((s, b) => s + b.total, 0);

  const byDay = useMemo(() => {
    const map = new Map<string, number>();
    for (const b of purchases) map.set(b.invoice_date, (map.get(b.invoice_date) ?? 0) + b.total);
    return Array.from(map.entries()).sort(([a], [b]) => (a < b ? 1 : -1));
  }, [purchases]);

  return (
    <div className="space-y-4">
      <section className="card-warm p-5">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">Total purchases in range</p>
        <p className="mt-1 font-display text-3xl text-ink tabular-nums">{inrRound(total)}</p>
        <p className="mt-1 text-xs text-muted-foreground">{purchases.length} supplier bill(s)</p>
      </section>
      {byDay.length > 0 && (
        <section className="card-warm p-4 md:p-5">
          <p className="text-xs uppercase tracking-wider text-muted-foreground mb-3">By day</p>
          <div className="space-y-1.5">
            {byDay.map(([d, amt]) => (
              <div key={d} className="flex justify-between text-sm">
                <span className="text-muted-foreground">{new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</span>
                <span className="tabular-nums text-ink">{inrRound(amt)}</span>
              </div>
            ))}
          </div>
        </section>
      )}
      <BillsReport bills={bills} partyName={partyName} warehouses={warehouses} typeFilterDefault="purchase" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// 3. Sales — grouped by day / item / shop
// ---------------------------------------------------------------------------
function SalesReport({ sales, warehouses }: { sales: Sale[]; warehouses: Warehouse[] }) {
  const total = sales.reduce((s, r) => s + r.total, 0);
  const whName = (id: string | null) => warehouses.find((w) => w.id === id)?.name ?? "Unassigned";

  const byDay = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of sales) {
      const k = s.created_at.slice(0, 10);
      map.set(k, (map.get(k) ?? 0) + s.total);
    }
    return Array.from(map.entries()).sort(([a], [b]) => (a < b ? 1 : -1)).slice(0, 30);
  }, [sales]);

  const byItem = useMemo(() => {
    const map = new Map<string, { qty: number; total: number }>();
    for (const s of sales) {
      const cur = map.get(s.item_name) ?? { qty: 0, total: 0 };
      cur.qty += s.quantity;
      cur.total += s.total;
      map.set(s.item_name, cur);
    }
    return Array.from(map.entries()).sort((a, b) => b[1].total - a[1].total).slice(0, 15);
  }, [sales]);

  const byShop = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of sales) map.set(s.warehouse_id ?? "—", (map.get(s.warehouse_id ?? "—") ?? 0) + s.total);
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  }, [sales]);

  return (
    <div className="space-y-4">
      <section className="card-warm p-5">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">Total sales in range</p>
        <p className="mt-1 font-display text-3xl text-ink tabular-nums">{inrRound(total)}</p>
        <p className="mt-1 text-xs text-muted-foreground">{sales.length} line(s) sold</p>
      </section>

      <div className="grid gap-4 md:grid-cols-2">
        <section className="card-warm p-4 md:p-5">
          <p className="text-xs uppercase tracking-wider text-muted-foreground mb-3">By day</p>
          <div className="space-y-1.5 max-h-72 overflow-y-auto">
            {byDay.map(([d, amt]) => (
              <div key={d} className="flex justify-between text-sm">
                <span className="text-muted-foreground">{new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}</span>
                <span className="tabular-nums text-ink">{inrRound(amt)}</span>
              </div>
            ))}
            {byDay.length === 0 && <p className="text-sm text-muted-foreground">No sales yet.</p>}
          </div>
        </section>

        <section className="card-warm p-4 md:p-5">
          <p className="text-xs uppercase tracking-wider text-muted-foreground mb-3">By shop</p>
          <div className="space-y-1.5">
            {byShop.map(([w, amt]) => (
              <div key={w} className="flex justify-between text-sm">
                <span className="text-muted-foreground">{whName(w === "—" ? null : w)}</span>
                <span className="tabular-nums text-ink">{inrRound(amt)}</span>
              </div>
            ))}
            {byShop.length === 0 && <p className="text-sm text-muted-foreground">No sales yet.</p>}
          </div>
        </section>
      </div>

      <section className="card-warm p-4 md:p-5">
        <p className="text-xs uppercase tracking-wider text-muted-foreground mb-3">Top items</p>
        <div className="space-y-1.5">
          {byItem.map(([name, v]) => (
            <div key={name} className="flex justify-between text-sm">
              <span className="text-ink">{name} <span className="text-muted-foreground">× {v.qty}</span></span>
              <span className="tabular-nums text-ink">{inrRound(v.total)}</span>
            </div>
          ))}
          {byItem.length === 0 && <p className="text-sm text-muted-foreground">No sales yet.</p>}
        </div>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 4. Profit & Loss — moved here as-is, driven by the shared shop scope.
// ---------------------------------------------------------------------------
function normaliseMonthly(e: Expense) {
  if (e.cadence === "monthly") return e.amount;
  if (e.cadence === "weekly") return e.amount * 4.33;
  if (e.cadence === "yearly") return e.amount / 12;
  return 0; // one-time excluded from recurring pool
}
function monthKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function monthLabel(k: string) {
  const [y, m] = k.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-IN", { month: "short", year: "numeric" });
}

function ProfitAndLoss({
  sales,
  expenses,
  scope,
  allowedShopIds,
  t,
}: {
  sales: Sale[];
  expenses: Expense[];
  scope: string;
  allowedShopIds: Set<string>;
  t: (k: string) => string;
}) {
  const [selectedMonth, setSelectedMonth] = useState<string>("");

  const scopedSales = useMemo(
    () =>
      scope === "all"
        ? sales.filter((s) => !s.warehouse_id || allowedShopIds.has(s.warehouse_id))
        : sales.filter((s) => s.warehouse_id === scope),
    [sales, scope, allowedShopIds],
  );
  const scopedExpenses = useMemo(
    () =>
      scope === "all"
        ? expenses.filter((e) => e.warehouse_id === null || allowedShopIds.has(e.warehouse_id))
        : expenses.filter((e) => e.warehouse_id === scope || e.warehouse_id === null),
    [expenses, scope, allowedShopIds],
  );

  const monthAgg = useMemo(() => {
    const map = new Map<string, { revenue: number; cogs: number }>();
    for (const s of scopedSales) {
      const k = monthKey(new Date(s.created_at));
      const cur = map.get(k) ?? { revenue: 0, cogs: 0 };
      cur.revenue += s.total;
      cur.cogs += s.unit_cost * s.quantity;
      map.set(k, cur);
    }
    return map;
  }, [scopedSales]);

  const months = useMemo(() => {
    const keys = Array.from(monthAgg.keys());
    const nowKey = monthKey(new Date());
    if (!keys.includes(nowKey)) keys.push(nowKey);
    keys.sort();
    return keys;
  }, [monthAgg]);

  useEffect(() => {
    if (months.length && !months.includes(selectedMonth)) setSelectedMonth(months[months.length - 1]);
  }, [months, selectedMonth]);

  const recurringMonthly = useMemo(() => scopedExpenses.reduce((s, e) => s + normaliseMonthly(e), 0), [scopedExpenses]);

  const current = monthAgg.get(selectedMonth) ?? { revenue: 0, cogs: 0 };
  const grossProfit = current.revenue - current.cogs;
  const otherExpenses = 0;
  const netProfit = grossProfit - otherExpenses - recurringMonthly;
  const margin = current.revenue > 0 ? (netProfit / current.revenue) * 100 : 0;
  const maxRev = Math.max(1, ...Array.from(monthAgg.values()).map((v) => v.revenue));

  return (
    <div className="space-y-6">
      <section className="card-warm p-4 md:p-5">
        <div className="text-xs uppercase tracking-widest text-muted-foreground">{t("rep.chooseMonth")}</div>
        <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
          {months.map((m) => (
            <button
              key={m}
              onClick={() => setSelectedMonth(m)}
              className={`whitespace-nowrap rounded-full border px-4 py-1.5 text-sm transition ${
                selectedMonth === m ? "bg-primary text-primary-foreground border-primary" : "border-border bg-card text-muted-foreground hover:text-foreground"
              }`}
            >
              {monthLabel(m)}
            </button>
          ))}
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2 card-warm p-6">
          <div className="flex items-baseline justify-between">
            <h2 className="font-display text-xl text-ink">{selectedMonth ? monthLabel(selectedMonth) : "—"} · P&L</h2>
            <span className={`text-xs flex items-center gap-1 ${netProfit >= 0 ? "text-success" : "text-destructive"}`}>
              {netProfit >= 0 ? <TrendingUp size={13} /> : <TrendingDown size={13} />}
              {margin.toFixed(1)}% {t("rep.netMargin")}
            </span>
          </div>

          {current.revenue === 0 && recurringMonthly === 0 ? (
            <p className="mt-6 text-sm text-muted-foreground">{t("rep.noSales")}</p>
          ) : (
            <dl className="mt-5 divide-y divide-border">
              <PLRow label={t("rep.revenue")} value={current.revenue} />
              <PLRow label={t("rep.cogs")} value={-current.cogs} />
              <PLRow label={t("rep.grossProfit")} value={grossProfit} strong />
              <PLRow label={t("rep.recurringExpenses")} value={-recurringMonthly} />
              <PLRow label={t("rep.netProfit")} value={netProfit} strong big />
            </dl>
          )}
        </div>

        <div className="card-warm p-6">
          <h3 className="font-display text-lg text-ink">{t("rep.revenueTrend")}</h3>
          {months.length === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">{t("common.noDataYet")}</p>
          ) : (
            <div className="mt-5 space-y-2">
              {months.map((m) => {
                const rev = monthAgg.get(m)?.revenue ?? 0;
                return (
                  <div key={m} className="text-xs">
                    <div className="flex justify-between text-muted-foreground">
                      <span>{monthLabel(m)}</span>
                      <span className="tabular-nums">{inrRound(rev)}</span>
                    </div>
                    <div className="mt-1 h-1.5 rounded-full bg-muted overflow-hidden">
                      <div className={`h-full ${m === selectedMonth ? "bg-primary" : "bg-sand-300"}`} style={{ width: `${(rev / maxRev) * 100}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function PLRow({ label, value, strong, big }: { label: string; value: number; strong?: boolean; big?: boolean }) {
  const negative = value < 0;
  return (
    <div className="flex items-baseline justify-between py-3">
      <span className={`${strong ? "text-ink font-medium" : "text-muted-foreground"} ${big ? "font-display text-lg" : "text-sm"}`}>{label}</span>
      <span className={`tabular-nums ${big ? "font-display text-2xl" : "text-sm"} ${strong ? "text-ink font-medium" : negative ? "text-muted-foreground" : "text-ink"}`}>
        {negative ? "− " : ""}
        {inrRound(Math.abs(value))}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared disclaimer banner for the four aggregate statements
// ---------------------------------------------------------------------------
function AccountingBanner() {
  return (
    <div className="rounded-lg border border-warning/30 bg-warning/10 text-warning px-3 py-2.5 text-xs flex items-start gap-2">
      <AlertTriangle size={14} className="shrink-0 mt-0.5" />
      <span>
        Simplified statement — not a certified accounting document. Not yet validated against Indian GAAP / Ind AS.
        Consult an accountant before relying on this for compliance.
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 5. Trial Balance
// ---------------------------------------------------------------------------
function TrialBalanceReport({ accounting }: { accounting: ReturnType<typeof computeAccounting> }) {
  return (
    <section className="card-warm p-4 md:p-5 space-y-4">
      <AccountingBanner />
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground border-b border-border">
            <th className="py-2">Account</th>
            <th className="py-2 text-right">Debit</th>
            <th className="py-2 text-right">Credit</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {accounting.trialBalance.map((l) => (
            <tr key={l.account}>
              <td className="py-2 text-ink">{l.account}</td>
              <td className="py-2 text-right tabular-nums">{l.debit ? inrRound(l.debit) : ""}</td>
              <td className="py-2 text-right tabular-nums">{l.credit ? inrRound(l.credit) : ""}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-border font-medium text-ink">
            <td className="py-2">Total</td>
            <td className="py-2 text-right tabular-nums">{inrRound(accounting.trialBalanceTotals.debit)}</td>
            <td className="py-2 text-right tabular-nums">{inrRound(accounting.trialBalanceTotals.credit)}</td>
          </tr>
        </tfoot>
      </table>
    </section>
  );
}

// ---------------------------------------------------------------------------
// 6. Balance Sheet
// ---------------------------------------------------------------------------
function BalanceSheetReport({ accounting }: { accounting: ReturnType<typeof computeAccounting> }) {
  const { assets, liabilities, equity } = accounting.balanceSheet;
  return (
    <section className="card-warm p-4 md:p-5 space-y-4">
      <AccountingBanner />
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <p className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Assets</p>
          <Row label="Cash" value={inrRound(assets.cash)} />
          <Row label="Accounts receivable" value={inrRound(assets.receivable)} />
          <Row label="Total assets" value={inrRound(assets.total)} bold />
        </div>
        <div>
          <p className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Liabilities & equity</p>
          <Row label="Accounts payable" value={inrRound(liabilities.payable)} />
          {liabilities.overdraft > 0 && <Row label="Bank overdraft" value={inrRound(liabilities.overdraft)} />}
          <Row label="Retained earnings (net profit)" value={inrRound(equity.netProfit)} />
          <Row label="Total liabilities & equity" value={inrRound(liabilities.total + equity.total)} bold />
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// 7. Cash Flow Statement
// ---------------------------------------------------------------------------
function CashFlowReport({ accounting }: { accounting: ReturnType<typeof computeAccounting> }) {
  const { netProfit, payableIncrease, receivableIncrease, netCash } = accounting.cashFlow;
  return (
    <section className="card-warm p-4 md:p-5 space-y-4">
      <AccountingBanner />
      <p className="text-xs text-muted-foreground">
        Operating activities for the selected range. There's no separate opening cash balance tracked, so this is the
        net cash generated within the range, not a running bank balance.
      </p>
      <div className="max-w-sm space-y-1">
        <Row label="Net profit" value={inrRound(netProfit)} />
        <Row label="+ Accounts payable (unpaid bills)" value={inrRound(payableIncrease)} />
        <Row label="− Accounts receivable (uncollected)" value={"− " + inrRound(receivableIncrease)} />
        <Row label="Net cash from operations" value={inrRound(netCash)} bold />
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// 8. Final Accounts — Trading + P&L + Balance Sheet, combined
// ---------------------------------------------------------------------------
function FinalAccountsReport({ accounting }: { accounting: ReturnType<typeof computeAccounting> }) {
  const { revenue, cogs, purchasesTotal, expensesTotal, grossProfit, netProfit, balanceSheet } = accounting;
  return (
    <div className="space-y-4">
      <AccountingBanner />
      <section className="card-warm p-4 md:p-5">
        <h3 className="font-display text-lg text-ink mb-3">Trading account</h3>
        <div className="max-w-sm space-y-1">
          <Row label="Sales revenue" value={inrRound(revenue)} />
          <Row label="− Cost of goods sold" value={"− " + inrRound(cogs)} />
          <Row label="− Purchases" value={"− " + inrRound(purchasesTotal)} />
          <Row label="Gross profit" value={inrRound(grossProfit - purchasesTotal)} bold />
        </div>
      </section>
      <section className="card-warm p-4 md:p-5">
        <h3 className="font-display text-lg text-ink mb-3">Profit & loss account</h3>
        <div className="max-w-sm space-y-1">
          <Row label="Gross profit" value={inrRound(grossProfit - purchasesTotal)} />
          <Row label="− Operating expenses" value={"− " + inrRound(expensesTotal)} />
          <Row label="Net profit" value={inrRound(netProfit)} bold />
        </div>
      </section>
      <section className="card-warm p-4 md:p-5">
        <h3 className="font-display text-lg text-ink mb-3">Balance sheet</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <p className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Assets</p>
            <Row label="Cash" value={inrRound(balanceSheet.assets.cash)} />
            <Row label="Accounts receivable" value={inrRound(balanceSheet.assets.receivable)} />
            <Row label="Total" value={inrRound(balanceSheet.assets.total)} bold />
          </div>
          <div>
            <p className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Liabilities & equity</p>
            <Row label="Accounts payable" value={inrRound(balanceSheet.liabilities.payable)} />
            <Row label="Retained earnings" value={inrRound(balanceSheet.equity.netProfit)} />
            <Row label="Total" value={inrRound(balanceSheet.liabilities.total + balanceSheet.equity.total)} bold />
          </div>
        </div>
      </section>
    </div>
  );
}
