import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { TrendingUp, TrendingDown, Store } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { useT } from "@/lib/i18n";

export const Route = createFileRoute("/reports")({
  component: ReportsPage,
  head: () => ({
    meta: [
      { title: "Reports · Hisab" },
      {
        name: "description",
        content:
          "Profit & loss summary, monthly breakdown and recurring expenses for your shop.",
      },
    ],
  }),
});

type Warehouse = { id: string; name: string };
type Sale = {
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
};

const inr = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");

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

function ReportsPage() {
  const { user } = useAuth();
  const { t } = useT();

  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [scope, setScope] = useState<string>("all");
  const [sales, setSales] = useState<Sale[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [selectedMonth, setSelectedMonth] = useState<string>("");
  
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    const [wh, sl, ex] = await Promise.all([
      supabase.from("warehouses").select("id, name").order("created_at"),
      supabase
        .from("sales")
        .select("warehouse_id, quantity, unit_price, unit_cost, total, created_at")
        .order("created_at", { ascending: false }),
      supabase.from("expenses").select("id, label, amount, cadence, warehouse_id").order("created_at"),
    ]);
    if (wh.error) setErr(wh.error.message);
    if (sl.error) setErr(sl.error.message);
    if (ex.error) setErr(ex.error.message);
    setWarehouses(wh.data ?? []);
    setSales(
      (sl.data ?? []).map((s) => ({
        warehouse_id: s.warehouse_id,
        quantity: s.quantity,
        unit_price: Number(s.unit_price),
        unit_cost: Number(s.unit_cost),
        total: Number(s.total),
        created_at: s.created_at,
      })),
    );
    setExpenses(
      (ex.data ?? []).map((e) => ({
        id: e.id,
        label: e.label,
        amount: Number(e.amount),
        cadence: (e.cadence as Expense["cadence"]) ?? "monthly",
        warehouse_id: e.warehouse_id,
      })),
    );
  }, [user]);

  useEffect(() => {
    if (user) void load();
  }, [user, load]);

  const scopedSales = useMemo(
    () => (scope === "all" ? sales : sales.filter((s) => s.warehouse_id === scope)),
    [sales, scope],
  );
  const scopedExpenses = useMemo(
    () => (scope === "all" ? expenses : expenses.filter((e) => e.warehouse_id === scope || e.warehouse_id === null)),
    [expenses, scope],
  );

  // Group sales by month
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
    // ensure current month appears
    const nowKey = monthKey(new Date());
    if (!keys.includes(nowKey)) keys.push(nowKey);
    keys.sort();
    return keys;
  }, [monthAgg]);

  useEffect(() => {
    if (months.length && !months.includes(selectedMonth)) {
      setSelectedMonth(months[months.length - 1]);
    }
  }, [months, selectedMonth]);

  const recurringMonthly = useMemo(
    () => scopedExpenses.reduce((s, e) => s + normaliseMonthly(e), 0),
    [scopedExpenses],
  );

  const current = monthAgg.get(selectedMonth) ?? { revenue: 0, cogs: 0 };
  const grossProfit = current.revenue - current.cogs;
  // "Other expenses" = one-time expenses recorded (kept 0 for now)
  const otherExpenses = 0;
  const netProfit = grossProfit - otherExpenses - recurringMonthly;
  const margin = current.revenue > 0 ? (netProfit / current.revenue) * 100 : 0;

  const maxRev = Math.max(1, ...Array.from(monthAgg.values()).map((v) => v.revenue));

  return (
    <AppShell active="reports" title={t("rep.title")}>
      <div className="px-4 md:px-10 py-6 md:py-8 space-y-6">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-widest text-muted-foreground">
              {t("rep.pnl")}
            </p>
            <h1 className="mt-1 font-display text-3xl md:text-4xl text-ink">
              {t("rep.title")}
            </h1>
          </div>
        </header>

        {err && (
          <div className="rounded-lg bg-destructive/10 text-destructive text-sm px-3 py-2">
            {err}
          </div>
        )}

        {/* Shop scope */}
        <section className="card-warm p-3 md:p-4">
          <div className="flex flex-wrap items-center gap-2">
            <Store size={16} className="text-muted-foreground ml-1" />
            <ScopeTab active={scope === "all"} onClick={() => setScope("all")}>
              {t("common.allShops")}
            </ScopeTab>
            {warehouses.map((w) => (
              <ScopeTab key={w.id} active={scope === w.id} onClick={() => setScope(w.id)}>
                {w.name}
              </ScopeTab>
            ))}
          </div>
        </section>

        {/* Month selector */}
        <section className="card-warm p-4 md:p-5">
          <div className="text-xs uppercase tracking-widest text-muted-foreground">
            {t("rep.chooseMonth")}
          </div>
          <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
            {months.map((m) => (
              <button
                key={m}
                onClick={() => setSelectedMonth(m)}
                className={`whitespace-nowrap rounded-full border px-4 py-1.5 text-sm transition ${
                  selectedMonth === m
                    ? "bg-primary text-primary-foreground border-primary"
                    : "border-border bg-card text-muted-foreground hover:text-foreground"
                }`}
              >
                {monthLabel(m)}
              </button>
            ))}
          </div>
        </section>

        {/* P&L summary */}
        <section className="grid gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2 card-warm p-6">
            <div className="flex items-baseline justify-between">
              <h2 className="font-display text-xl text-ink">
                {selectedMonth ? monthLabel(selectedMonth) : "—"} · P&L
              </h2>
              <span
                className={`text-xs flex items-center gap-1 ${
                  netProfit >= 0 ? "text-success" : "text-destructive"
                }`}
              >
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
                        <span className="tabular-nums">{inr(rev)}</span>
                      </div>
                      <div className="mt-1 h-1.5 rounded-full bg-muted overflow-hidden">
                        <div
                          className={`h-full ${m === selectedMonth ? "bg-primary" : "bg-sand-300"}`}
                          style={{ width: `${(rev / maxRev) * 100}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>

        {/* Recurring expenses moved to /expenses — P&L still reads the same expenses table above. */}
      </div>

    </AppShell>
  );
}

function ScopeTab({
  children,
  active,
  onClick,
}: {
  children: React.ReactNode;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full px-4 py-1.5 text-sm transition ${
        active
          ? "bg-primary text-primary-foreground"
          : "text-muted-foreground hover:text-foreground hover:bg-muted"
      }`}
    >
      {children}
    </button>
  );
}

function PLRow({
  label,
  value,
  strong,
  big,
}: {
  label: string;
  value: number;
  strong?: boolean;
  big?: boolean;
}) {
  const negative = value < 0;
  return (
    <div className="flex items-baseline justify-between py-3">
      <span
        className={`${strong ? "text-ink font-medium" : "text-muted-foreground"} ${
          big ? "font-display text-lg" : "text-sm"
        }`}
      >
        {label}
      </span>
      <span
        className={`tabular-nums ${big ? "font-display text-2xl" : "text-sm"} ${
          strong ? "text-ink font-medium" : negative ? "text-muted-foreground" : "text-ink"
        }`}
      >
        {negative ? "− " : ""}
        {inr(Math.abs(value))}
      </span>
    </div>
  );
}

