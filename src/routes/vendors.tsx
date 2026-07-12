import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Search, Clock, CheckCircle2, ArrowDownLeft, Plus } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/hooks/use-auth";
import { useProfile } from "@/hooks/use-profile";
import { supabase } from "@/integrations/supabase/client";
import { useT } from "@/lib/i18n";
import { can } from "@/lib/permissions";
import { PartyForm, type PartyRow } from "@/components/PartyForm";

export const Route = createFileRoute("/vendors")({
  component: VendorsPage,
  head: () => ({
    meta: [
      { title: "Vendors · Hisab" },
      { name: "description", content: "Vendors and their outstanding balances, computed from real bills, expenses and payments." },
    ],
  }),
});

// Balances now come from the same `parties` + `party_ledger` system used by
// the Parties page — Vendors is simply that data filtered to type
// vendor/both. Nothing here is a manually-typed status any more.
type LedgerRow = { party_id: string; date: string; direction: "payable" | "receivable"; amount: number };

type RangeKey = "day" | "week" | "month" | "all";
type StatusKey = "pending" | "settled" | "owed";
type TabKey = "all" | StatusKey;

const RANGE_DAYS: Record<RangeKey, number> = { day: 1, week: 7, month: 30, all: 3650 };
const inr = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");

type Sb = {
  from: (t: string) => {
    select: (s: string) => {
      order: (c: string) => Promise<{ data: unknown[] | null; error: { message: string } | null }>;
    };
  };
};
const sb = supabase as unknown as Sb;

function VendorsPage() {
  const { user } = useAuth();
  const { profile } = useProfile();
  const { t } = useT();
  const canManage = can.manageParties(profile?.role);

  const [parties, setParties] = useState<PartyRow[]>([]);
  const [ledger, setLedger] = useState<LedgerRow[]>([]);
  const [range, setRange] = useState<RangeKey>("all");
  const [tab, setTab] = useState<TabKey>("all");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    const [pa, lg] = await Promise.all([
      sb.from("parties").select("*").order("name"),
      sb.from("party_ledger").select("party_id, date, direction, amount").order("date"),
    ]);
    if (pa.error) setError(pa.error.message);
    else if (lg.error) setError(lg.error.message);
    setParties(
      ((pa.data as PartyRow[] | null) ?? []).filter((p) => p.type === "vendor" || p.type === "both"),
    );
    setLedger(
      ((lg.data as LedgerRow[] | null) ?? []).map((r) => ({ ...r, amount: Number(r.amount) })),
    );
    setLoading(false);
  }, [user]);

  useEffect(() => {
    void load();
  }, [load]);

  // Balance per vendor, computed live from the ledger — never a stored enum.
  const balanceByParty = useMemo(() => {
    const map = new Map<string, { payable: number; receivable: number; lastDate: string | null }>();
    for (const r of ledger) {
      const cur = map.get(r.party_id) ?? { payable: 0, receivable: 0, lastDate: null };
      cur[r.direction] += r.amount;
      if (!cur.lastDate || new Date(r.date) > new Date(cur.lastDate)) cur.lastDate = r.date;
      map.set(r.party_id, cur);
    }
    return map;
  }, [ledger]);

  const rows = useMemo(() => {
    return parties.map((p) => {
      const b = balanceByParty.get(p.id) ?? { payable: 0, receivable: 0, lastDate: null };
      const payable = Math.max(0, b.payable);
      const receivable = Math.max(0, b.receivable);
      const status: StatusKey = payable > 0.5 ? "pending" : receivable > 0.5 ? "owed" : "settled";
      return { party: p, payable, receivable, status, lastDate: b.lastDate };
    });
  }, [parties, balanceByParty]);

  const filtered = useMemo(() => {
    const now = new Date();
    const cutoff = new Date(now);
    cutoff.setDate(cutoff.getDate() - RANGE_DAYS[range]);
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (range !== "all") {
        // Show vendors that either have no history yet, or had activity in range.
        if (r.lastDate && new Date(r.lastDate) < cutoff) return false;
      }
      if (tab !== "all" && r.status !== tab) return false;
      if (q && !r.party.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [rows, range, tab, query]);

  const totals = useMemo(() => {
    return filtered.reduce(
      (acc, r) => {
        acc.pending += r.payable;
        acc.owed += r.receivable;
        if (r.status === "settled") acc.settledCount += 1;
        return acc;
      },
      { pending: 0, owed: 0, settledCount: 0 },
    );
  }, [filtered]);

  return (
    <AppShell active="vendors" title={t("ven.title")}>
      <div className="px-4 md:px-10 py-6 md:py-8 space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-widest text-muted-foreground">
              Vendors · व्यापारी
            </p>
            <h1 className="mt-1 font-display text-3xl md:text-4xl text-ink">{t("ven.title")}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{filtered.length} vendors in view</p>
          </div>
          {canManage && (
            <button
              onClick={() => setShowAdd(true)}
              className="inline-flex items-center gap-1.5 rounded-full bg-primary text-primary-foreground px-4 py-2 text-sm"
            >
              <Plus size={14} /> Add party
            </button>
          )}
        </div>

        {error && (
          <div className="rounded-lg bg-destructive/10 text-destructive text-sm px-3 py-2">{error}</div>
        )}

        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search vendor…"
            className="w-full rounded-lg border border-border bg-card pl-9 pr-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-ring/40"
          />
        </div>

        <div className="flex items-center gap-1 rounded-full border border-border bg-card p-0.5 text-xs overflow-x-auto">
          {(
            [
              ["day", "Today"],
              ["week", "Week"],
              ["month", "Month"],
              ["all", "All"],
            ] as [RangeKey, string][]
          ).map(([k, label]) => (
            <button
              key={k}
              onClick={() => setRange(k)}
              className={`flex-1 px-3 py-1.5 rounded-full transition whitespace-nowrap ${
                range === k
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <section className="grid gap-3 sm:grid-cols-3">
          <SummaryCard
            icon={<Clock size={16} className="text-warning" />}
            label={t("ven.duesPending")}
            value={inr(totals.pending)}
            caption="You owe vendors"
          />
          <SummaryCard
            icon={<CheckCircle2 size={16} className="text-success" />}
            label={t("ven.duesSettled")}
            value={String(totals.settledCount)}
            caption="Vendors settled up"
          />
          <SummaryCard
            icon={<ArrowDownLeft size={16} className="text-ink" />}
            label={t("ven.duesOwed")}
            value={inr(totals.owed)}
            caption="Credits & refunds"
          />
        </section>

        <section className="card-warm p-4 md:p-6">
          <div className="flex items-center gap-1 rounded-full bg-muted p-0.5 text-xs overflow-x-auto">
            {(
              [
                ["all", "All"],
                ["pending", "Pending"],
                ["settled", "Settled"],
                ["owed", "Owed to you"],
              ] as [TabKey, string][]
            ).map(([k, label]) => (
              <button
                key={k}
                onClick={() => setTab(k)}
                className={`flex-1 min-w-max px-3 py-1.5 rounded-full transition whitespace-nowrap ${
                  tab === k ? "bg-card shadow-sm text-ink" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="mt-4 space-y-2">
            {filtered.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">
                {loading ? "Loading…" : "No vendors yet. Add your first vendor."}
              </p>
            ) : (
              filtered.map(({ party, payable, receivable, status }) => (
                <Link
                  key={party.id}
                  to="/parties/$id"
                  params={{ id: party.id }}
                  className="rounded-lg border border-border p-3 flex items-start gap-3 hover:bg-muted/40"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-sm text-ink truncate">{party.name}</div>
                    <div className="text-xs text-muted-foreground truncate capitalize">{party.type}</div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="font-medium tabular-nums text-ink">
                      {status === "owed" ? inr(receivable) : inr(payable)}
                    </div>
                    <StatusPill status={status} />
                  </div>
                </Link>
              ))
            )}
          </div>
        </section>
      </div>

      {showAdd && user && (
        <PartyForm
          userId={user.id}
          defaultType="vendor"
          onClose={() => setShowAdd(false)}
          onSaved={() => {
            setShowAdd(false);
            void load();
          }}
        />
      )}
    </AppShell>
  );
}

function StatusPill({ status }: { status: StatusKey }) {
  const map: Record<StatusKey, { label: string; cls: string }> = {
    pending: { label: "Pending", cls: "bg-warning/15 text-warning" },
    settled: { label: "Settled", cls: "bg-success/15 text-success" },
    owed: { label: "Owed to you", cls: "bg-primary/15 text-ink" },
  };
  const s = map[status];
  return (
    <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${s.cls}`}>
      {s.label}
    </span>
  );
}

function SummaryCard({
  icon,
  label,
  value,
  caption,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  caption: string;
}) {
  return (
    <div className="card-warm p-4 md:p-5">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="mt-2 font-display text-2xl md:text-3xl text-ink tabular-nums">{value}</div>
      <div className="mt-1 text-xs text-muted-foreground">{caption}</div>
    </div>
  );
}
