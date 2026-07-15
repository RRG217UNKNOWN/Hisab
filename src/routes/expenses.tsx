import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, Repeat, X, Trash2, Store, Wallet } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/hooks/use-auth";
import { useProfile } from "@/hooks/use-profile";
import { supabase } from "@/integrations/supabase/client";
import { useT } from "@/lib/i18n";
import { can } from "@/lib/permissions";

export const Route = createFileRoute("/expenses")({
  component: ExpensesPage,
  head: () => ({
    meta: [
      { title: "Expenses · Hisab" },
      { name: "description", content: "Track recurring and one-time expenses across your shops." },
    ],
  }),
});

type Warehouse = { id: string; name: string };
type Party = { id: string; name: string; type: string };
type Expense = {
  id: string;
  label: string;
  amount: number;
  cadence: "one-time" | "monthly" | "weekly" | "yearly";
  warehouse_id: string | null;
  party_id: string | null;
  payment_method: "cash" | "credit" | null;
  created_at: string;
};

function normaliseMonthly(e: Expense) {
  if (e.cadence === "monthly") return e.amount;
  if (e.cadence === "weekly") return e.amount * 4.33;
  if (e.cadence === "yearly") return e.amount / 12;
  return 0;
}

function ExpensesPage() {
  const { user } = useAuth();
  const { profile } = useProfile();
  const { t, formatNumber } = useT();
  const role = profile?.role;
  const canWrite = can.writeExpenses(role);
  const inr = (n: number) => "₹" + formatNumber(Math.round(n).toLocaleString("en-IN"));

  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [parties, setParties] = useState<Party[]>([]);
  const [scope, setScope] = useState<string>("all");
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [addOpen, setAddOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    const [wh, ex, pa] = await Promise.all([
      supabase.from("warehouses").select("id, name").order("created_at"),
      supabase
        .from("expenses")
        .select("id, label, amount, cadence, warehouse_id, party_id, payment_method, created_at")
        .order("created_at", { ascending: false }),
      (supabase as unknown as {
        from: (t: string) => {
          select: (s: string) => { order: (c: string) => Promise<{ data: Party[] | null; error: { message: string } | null }> };
        };
      })
        .from("parties")
        .select("id, name, type")
        .order("name"),
    ]);
    if (wh.error) setErr(wh.error.message);
    if (ex.error) setErr(ex.error.message);
    setWarehouses(wh.data ?? []);
    setParties(pa.data ?? []);
    setExpenses(
      (ex.data ?? []).map((e) => ({
        id: e.id,
        label: e.label,
        amount: Number(e.amount),
        cadence: (e.cadence as Expense["cadence"]) ?? "monthly",
        warehouse_id: e.warehouse_id,
        party_id: (e as { party_id?: string | null }).party_id ?? null,
        payment_method: ((e as { payment_method?: string | null }).payment_method ?? "cash") as Expense["payment_method"],
        created_at: e.created_at,
      })),
    );
  }, [user]);

  useEffect(() => {
    if (user) void load();
  }, [user, load]);

  const scoped = useMemo(
    () =>
      scope === "all"
        ? expenses
        : expenses.filter((e) => e.warehouse_id === scope || e.warehouse_id === null),
    [expenses, scope],
  );

  const recurringMonthly = scoped.reduce((s, e) => s + normaliseMonthly(e), 0);
  const oneTimeTotal = scoped.filter((e) => e.cadence === "one-time").reduce((s, e) => s + e.amount, 0);

  const cadenceLabel = (c: Expense["cadence"]) =>
    c === "monthly" ? t("exp.monthly") : c === "weekly" ? t("exp.weekly") : c === "yearly" ? t("exp.yearly") : t("exp.oneTimeOption");
  const paymentLabel = (p: string | null) => (p === "credit" ? t("exp.credit") : t("exp.cash"));

  return (
    <AppShell active="expenses" title={t("nav.expenses")}>
      <div className="px-4 md:px-10 py-6 md:py-8 space-y-6">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-widest text-muted-foreground">
              <Wallet size={12} className="inline mr-1" /> {t("exp.shopExpenses")}
            </p>
            <h1 className="mt-1 font-display text-3xl md:text-4xl text-ink">{t("nav.expenses")}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {inr(recurringMonthly)} / {t("exp.recurring")} · {inr(oneTimeTotal)} {t("exp.oneTime")}
            </p>
          </div>
          {canWrite && (
            <button
              onClick={() => setAddOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-full bg-primary text-primary-foreground px-4 py-2 text-sm"
            >
              <Plus size={14} /> {t("exp.addExpense")}
            </button>
          )}
        </header>

        {err && (
          <div className="rounded-lg bg-destructive/10 text-destructive text-sm px-3 py-2">
            {err}
          </div>
        )}

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

        <section className="card-warm p-6">
          <div className="flex items-baseline justify-between">
            <h2 className="font-display text-xl text-ink flex items-center gap-2">
              <Repeat size={16} className="text-muted-foreground" />
              {t("exp.allExpenses")}
            </h2>
          </div>
          <div className="mt-5 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <th className="py-2 font-medium">{t("common.name")}</th>
                  <th className="py-2 font-medium">{t("exp.cadence")}</th>
                  <th className="py-2 font-medium">{t("exp.payment")}</th>
                  <th className="py-2 font-medium text-right">{t("common.amount")}</th>
                  <th className="py-2 font-medium text-right">{t("exp.perMonth")}</th>
                  <th className="py-2 font-medium text-right">—</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {scoped.map((e) => (
                  <tr key={e.id}>
                    <td className="py-3 text-ink">
                      <div>{e.label}</div>
                      {e.party_id && (
                        <div className="text-xs text-muted-foreground">
                          {parties.find((p) => p.id === e.party_id)?.name ?? "—"}
                        </div>
                      )}
                    </td>
                    <td className="py-3 text-muted-foreground">{cadenceLabel(e.cadence)}</td>
                    <td className="py-3 text-muted-foreground">{paymentLabel(e.payment_method)}</td>
                    <td className="py-3 text-right tabular-nums">{inr(e.amount)}</td>
                    <td className="py-3 text-right tabular-nums text-muted-foreground">
                      {inr(normaliseMonthly(e))}
                    </td>
                    <td className="py-3 text-right">
                      {canWrite && (
                        <button
                          onClick={async () => {
                            if (!confirm(t("exp.confirmRemove"))) return;
                            const { error } = await supabase.from("expenses").delete().eq("id", e.id);
                            if (error) alert(error.message);
                            else void load();
                          }}
                          aria-label={t("exp.remove")}
                          className="h-8 w-8 grid place-items-center rounded-full hover:bg-muted text-muted-foreground hover:text-destructive"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {scoped.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-6 text-center text-muted-foreground text-sm">
                      {t("common.noDataYet")}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {addOpen && user && (
        <AddExpenseModal
          warehouses={warehouses}
          parties={parties}
          defaultShopId={scope === "all" ? null : scope}
          onClose={() => setAddOpen(false)}
          onAdded={() => {
            setAddOpen(false);
            void load();
          }}
          userId={user.id}
        />
      )}
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

function AddExpenseModal({
  warehouses,
  parties,
  defaultShopId,
  onClose,
  onAdded,
  userId,
}: {
  warehouses: Warehouse[];
  parties: Party[];
  defaultShopId: string | null;
  onClose: () => void;
  onAdded: () => void;
  userId: string;
}) {
  const { t } = useT();
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");
  const [cadence, setCadence] = useState<Expense["cadence"]>("monthly");
  const [shopId, setShopId] = useState<string>(defaultShopId ?? "");
  const [partyId, setPartyId] = useState<string>("");
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "credit">("cash");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    const n = Number(amount);
    if (!label.trim() || !Number.isFinite(n) || n <= 0) {
      setErr(t("exp.enterNameAmount"));
      return;
    }
    setBusy(true);
    const { error } = await supabase.from("expenses").insert({
      user_id: userId,
      warehouse_id: shopId || null,
      label: label.trim(),
      amount: n,
      cadence,
      party_id: partyId || null,
      payment_method: paymentMethod,
    } as unknown as never);
    setBusy(false);
    if (error) setErr(error.message);
    else onAdded();
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
        <h2 className="font-display text-2xl text-ink">{t("exp.addExpense")}</h2>

        <form onSubmit={submit} className="mt-5 space-y-3">
          <div>
            <label className="text-xs uppercase tracking-wider text-muted-foreground">{t("common.name")}</label>
            <input
              autoFocus
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={t("exp.rentPlaceholder")}
              className="mt-1 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/40"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs uppercase tracking-wider text-muted-foreground">{t("common.amount")} (₹)</label>
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0"
                className="mt-1 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm tabular-nums outline-none focus:ring-2 focus:ring-ring/40"
              />
            </div>
            <div>
              <label className="text-xs uppercase tracking-wider text-muted-foreground">{t("exp.cadence")}</label>
              <select
                value={cadence}
                onChange={(e) => setCadence(e.target.value as Expense["cadence"])}
                className="mt-1 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/40"
              >
                <option value="monthly">{t("exp.monthly")}</option>
                <option value="weekly">{t("exp.weekly")}</option>
                <option value="yearly">{t("exp.yearly")}</option>
                <option value="one-time">{t("exp.oneTimeOption")}</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs uppercase tracking-wider text-muted-foreground">{t("exp.shop")}</label>
              <select
                value={shopId}
                onChange={(e) => setShopId(e.target.value)}
                className="mt-1 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/40"
              >
                <option value="">{t("common.allShops")}</option>
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs uppercase tracking-wider text-muted-foreground">{t("exp.payment")}</label>
              <select
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value as "cash" | "credit")}
                className="mt-1 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/40"
              >
                <option value="cash">{t("exp.cash")}</option>
                <option value="credit">{t("exp.credit")}</option>
              </select>
            </div>
          </div>
          <div>
            <label className="text-xs uppercase tracking-wider text-muted-foreground">{t("exp.partyOptional")}</label>
            <select
              value={partyId}
              onChange={(e) => setPartyId(e.target.value)}
              className="mt-1 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/40"
            >
              <option value="">—</option>
              {parties.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          {err && <div className="text-sm text-destructive">{err}</div>}
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="rounded-lg border border-border bg-card px-4 py-2 text-sm">
              {t("common.cancel")}
            </button>
            <button
              type="submit"
              disabled={busy}
              className="rounded-lg bg-primary text-primary-foreground px-4 py-2 text-sm disabled:opacity-60"
            >
              {busy ? t("party.saving") : t("exp.addExpense")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
