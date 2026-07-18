import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, Search, Contact, TrendingUp, TrendingDown, Pencil } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/hooks/use-auth";
import { useProfile } from "@/hooks/use-profile";
import { supabase } from "@/integrations/supabase/client";
import { can } from "@/lib/permissions";
import { PartyForm, type PartyRow } from "@/components/PartyForm";
import { useT } from "@/lib/i18n";

export const Route = createFileRoute("/parties")({
  component: PartiesPage,
  head: () => ({
    meta: [
      { title: "Parties · Hisab" },
      { name: "description", content: "Customers, vendors and their outstanding balances." },
    ],
  }),
});

type LedgerRow = { party_id: string; direction: "payable" | "receivable"; amount: number };

function PartiesPage() {
  const { user } = useAuth();
  const { profile } = useProfile();
  const { t, formatNumber } = useT();
  const canManage = can.manageParties(profile?.role);

  const [parties, setParties] = useState<PartyRow[]>([]);
  const [ledger, setLedger] = useState<LedgerRow[]>([]);
  const [q, setQ] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<PartyRow | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    const sb = supabase as unknown as {
      from: (t: string) => {
        select: (s: string) => {
          order: (c: string) => Promise<{ data: unknown[] | null; error: { message: string } | null }>;
        };
      };
    };
    const [pa, lg] = await Promise.all([
      sb.from("parties").select("*").order("name"),
      sb.from("party_ledger").select("party_id, direction, amount").order("date"),
    ]);
    if (pa.error) setErr(pa.error.message);
    setParties((pa.data as PartyRow[] | null) ?? []);
    setLedger(
      ((lg.data as LedgerRow[] | null) ?? []).map((r) => ({ ...r, amount: Number(r.amount) })),
    );
  }, [user]);

  useEffect(() => {
    void load();
  }, [load]);

  const balances = useMemo(() => {
    const map = new Map<string, { payable: number; receivable: number }>();
    for (const r of ledger) {
      const cur = map.get(r.party_id) ?? { payable: 0, receivable: 0 };
      cur[r.direction] += r.amount;
      map.set(r.party_id, cur);
    }
    return map;
  }, [ledger]);

  const orgTotals = useMemo(() => {
    let payable = 0;
    let receivable = 0;
    for (const b of balances.values()) {
      payable += Math.max(0, b.payable);
      receivable += Math.max(0, b.receivable);
    }
    return { payable, receivable };
  }, [balances]);

  const filtered = parties.filter((p) => {
    if (q && !p.name.toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  });

  const inr = (n: number) => "₹" + formatNumber(Math.round(n).toLocaleString("en-IN"));

  const typeLabel = (ty: PartyRow["type"]) => (ty === "vendor" ? t("party.vendor") : ty === "customer" ? t("party.customer") : t("party.both"));

  return (
    <AppShell active="parties" title={t("party.title")}>
      <div className="px-4 md:px-10 py-6 md:py-8 space-y-6">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-widest text-muted-foreground">
              <Contact size={12} className="inline mr-1" /> {t("party.tagline")}
            </p>
            <h1 className="mt-1 font-display text-3xl md:text-4xl text-ink">{t("party.title")}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{formatNumber(parties.length)} {t("party.title").toLowerCase()}</p>
          </div>
          {canManage && (
            <button
              onClick={() => setShowAdd(true)}
              className="inline-flex items-center gap-1.5 rounded-full bg-primary text-primary-foreground px-4 py-2 text-sm"
            >
              <Plus size={14} /> {t("party.addParty")}
            </button>
          )}
        </header>

        {err && <div className="rounded-lg bg-destructive/10 text-destructive text-sm px-3 py-2">{err}</div>}

        <section className="grid gap-3 sm:grid-cols-2">
          <div className="card-warm p-5">
            <div className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <TrendingDown size={13} className="text-destructive" /> {t("party.youOwe")}
            </div>
            <div className="mt-2 font-display text-3xl text-ink tabular-nums">{inr(orgTotals.payable)}</div>
          </div>
          <div className="card-warm p-5">
            <div className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <TrendingUp size={13} className="text-success" /> {t("party.owesYou")}
            </div>
            <div className="mt-2 font-display text-3xl text-ink tabular-nums">{inr(orgTotals.receivable)}</div>
          </div>
        </section>

        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("party.searchPlaceholder")}
            className="w-full rounded-lg border border-border bg-card pl-9 pr-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-ring/40"
          />
        </div>

        <section className="card-warm p-4 md:p-6">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <th className="py-2 font-medium">{t("party.name")}</th>
                  <th className="py-2 font-medium">{t("party.type")}</th>
                  <th className="py-2 font-medium">{t("party.gstNo")}</th>
                  <th className="py-2 font-medium text-right">{t("party.youOwe")}</th>
                  <th className="py-2 font-medium text-right">{t("party.owesYou")}</th>
                  <th className="py-2 font-medium text-right">{t("party.netBalance")}</th>
                  <th className="py-2 w-8" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map((p) => {
                  const b = balances.get(p.id) ?? { payable: 0, receivable: 0 };
                  const net = b.receivable - b.payable;
                  return (
                    <tr key={p.id} className="hover:bg-muted/40 group">
                      <td className="py-3">
                        <Link to="/parties/$id" params={{ id: p.id }} className="text-ink hover:underline">
                          {p.name}
                        </Link>
                      </td>
                      <td className="py-3 text-muted-foreground text-xs">{typeLabel(p.type)}</td>
                      <td className="py-3 text-muted-foreground text-xs font-mono">{p.gst_no ?? "—"}</td>
                      <td className="py-3 text-right tabular-nums text-destructive">{inr(Math.max(0, b.payable))}</td>
                      <td className="py-3 text-right tabular-nums text-success">{inr(Math.max(0, b.receivable))}</td>
                      <td className={`py-3 text-right tabular-nums font-medium ${net >= 0 ? "text-success" : "text-destructive"}`}>
                        {net >= 0 ? "+" : "−"}{inr(Math.abs(net))}
                      </td>
                      <td className="py-3 text-right">
                        {canManage && (
                          <button
                            onClick={() => setEditing(p)}
                            aria-label={t("party.edit")}
                            className="text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-primary transition"
                          >
                            <Pencil size={14} />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-sm text-muted-foreground">
                      {t("party.noPartiesYet")}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {(showAdd || editing) && user && (
        <PartyForm
          party={editing}
          userId={user.id}
          onClose={() => {
            setShowAdd(false);
            setEditing(null);
          }}
          onSaved={() => {
            setShowAdd(false);
            setEditing(null);
            void load();
          }}
        />
      )}
    </AppShell>
  );
}
