import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Plus, X } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/hooks/use-auth";
import { useProfile } from "@/hooks/use-profile";
import { supabase } from "@/integrations/supabase/client";
import { can } from "@/lib/permissions";
import type { PartyRow } from "@/components/PartyForm";

export const Route = createFileRoute("/parties/$id")({
  component: PartyDetail,
  head: () => ({
    meta: [{ title: "Party ledger · Hisab" }],
  }),
});

type LedgerRow = {
  party_id: string;
  date: string;
  source_table: string;
  source_id: string;
  description: string;
  direction: "payable" | "receivable";
  amount: number;
};

const inr = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");

function PartyDetail() {
  const { id } = Route.useParams();
  const { user } = useAuth();
  const { profile } = useProfile();
  const canPay = can.manageParties(profile?.role);

  const [party, setParty] = useState<PartyRow | null>(null);
  const [rows, setRows] = useState<LedgerRow[]>([]);
  const [payOpen, setPayOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    const sb = supabase as unknown as {
      from: (t: string) => {
        select: (s: string) => {
          eq: (c: string, v: string) => {
            maybeSingle?: () => Promise<{ data: PartyRow | null; error: { message: string } | null }>;
            order: (c: string) => Promise<{ data: unknown[] | null; error: { message: string } | null }>;
          };
        };
      };
    };
    const p = await sb.from("parties").select("*").eq("id", id).maybeSingle!();
    if (p.error) setErr(p.error.message);
    setParty((p.data as PartyRow) ?? null);
    const l = await sb.from("party_ledger").select("*").eq("party_id", id).order("date");
    if (l.error) setErr(l.error.message);
    setRows(
      ((l.data as LedgerRow[] | null) ?? []).map((r) => ({ ...r, amount: Number(r.amount) })),
    );
  }, [user, id]);

  useEffect(() => {
    void load();
  }, [load]);

  const sorted = useMemo(
    () => [...rows].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()),
    [rows],
  );

  const totals = useMemo(() => {
    let payable = 0;
    let receivable = 0;
    for (const r of rows) {
      if (r.direction === "payable") payable += r.amount;
      else receivable += r.amount;
    }
    return { payable, receivable, net: receivable - payable };
  }, [rows]);

  return (
    <AppShell active="parties" title={party?.name ?? "Party"}>
      <div className="px-4 md:px-10 py-6 md:py-8 space-y-6 max-w-4xl">
        <Link to="/parties" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft size={14} /> All parties
        </Link>

        {err && <div className="rounded-lg bg-destructive/10 text-destructive text-sm px-3 py-2">{err}</div>}

        {party && (
          <header>
            <p className="text-xs uppercase tracking-widest text-muted-foreground capitalize">{party.type}</p>
            <h1 className="mt-1 font-display text-3xl md:text-4xl text-ink">{party.name}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {[party.phone, party.email, party.gst_no].filter(Boolean).join(" · ") || "—"}
            </p>
          </header>
        )}

        <section className="grid gap-3 sm:grid-cols-3">
          <StatCard label="You owe" value={inr(Math.max(0, totals.payable))} tone="danger" />
          <StatCard label="Owed to you" value={inr(Math.max(0, totals.receivable))} tone="success" />
          <StatCard
            label="Net balance"
            value={(totals.net >= 0 ? "+" : "−") + inr(Math.abs(totals.net))}
            tone={totals.net >= 0 ? "success" : "danger"}
          />
        </section>

        <div className="flex justify-end">
          {canPay && (
            <button
              onClick={() => setPayOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-full bg-primary text-primary-foreground px-4 py-2 text-sm"
            >
              <Plus size={14} /> Record payment
            </button>
          )}
        </div>

        <section className="card-warm p-4 md:p-6">
          <h2 className="font-display text-xl text-ink mb-3">Transaction history</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <th className="py-2 font-medium">Date</th>
                  <th className="py-2 font-medium">Description</th>
                  <th className="py-2 font-medium">Type</th>
                  <th className="py-2 font-medium text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {sorted.map((r) => (
                  <tr key={`${r.source_table}-${r.source_id}`}>
                    <td className="py-2 text-muted-foreground text-xs">
                      {new Date(r.date).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
                    </td>
                    <td className="py-2 text-ink">{r.description}</td>
                    <td className="py-2 text-xs text-muted-foreground capitalize">{r.source_table}</td>
                    <td className={`py-2 text-right tabular-nums ${r.direction === "payable" ? "text-destructive" : "text-success"}`}>
                      {r.amount < 0 ? "−" : "+"}
                      {inr(Math.abs(r.amount))}
                    </td>
                  </tr>
                ))}
                {sorted.length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-8 text-center text-sm text-muted-foreground">
                      No transactions yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {payOpen && user && (
        <PaymentModal
          partyId={id}
          userId={user.id}
          onClose={() => setPayOpen(false)}
          onSaved={() => {
            setPayOpen(false);
            void load();
          }}
        />
      )}
    </AppShell>
  );
}

function StatCard({ label, value, tone }: { label: string; value: string; tone: "danger" | "success" }) {
  return (
    <div className="card-warm p-5">
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`mt-2 font-display text-2xl md:text-3xl tabular-nums ${tone === "success" ? "text-success" : "text-destructive"}`}>
        {value}
      </div>
    </div>
  );
}

function PaymentModal({
  partyId,
  userId,
  onClose,
  onSaved,
}: {
  partyId: string;
  userId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [amount, setAmount] = useState("");
  const [direction, setDirection] = useState<"payable" | "receivable">("payable");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) {
      setErr("Enter a positive amount");
      return;
    }
    setBusy(true);
    const sb = supabase as unknown as { from: (t: string) => { insert: (r: unknown) => Promise<{ error: { message: string } | null }> } };
    const { error } = await sb.from("party_payments").insert({
      user_id: userId,
      party_id: partyId,
      amount: n,
      direction,
      note: note || null,
    });
    setBusy(false);
    if (error) setErr(error.message);
    else onSaved();
  };

  return (
    <div className="fixed inset-0 z-50 bg-ink/40 backdrop-blur-sm grid place-items-center p-4" onClick={onClose}>
      <div className="w-full max-w-md card-warm p-6 relative" onClick={(e) => e.stopPropagation()}>
        <button onClick={onClose} className="absolute right-3 top-3 h-8 w-8 grid place-items-center rounded-full hover:bg-muted">
          <X size={16} />
        </button>
        <h2 className="font-display text-2xl text-ink">Record payment</h2>
        <form onSubmit={submit} className="mt-5 space-y-3">
          <div>
            <label className="text-xs uppercase tracking-wider text-muted-foreground">Direction</label>
            <select
              value={direction}
              onChange={(e) => setDirection(e.target.value as "payable" | "receivable")}
              className="mt-1 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm"
            >
              <option value="payable">I paid them (settle payable)</option>
              <option value="receivable">They paid me (settle receivable)</option>
            </select>
          </div>
          <div>
            <label className="text-xs uppercase tracking-wider text-muted-foreground">Amount (₹)</label>
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="mt-1 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm"
              autoFocus
            />
          </div>
          <div>
            <label className="text-xs uppercase tracking-wider text-muted-foreground">Note</label>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="mt-1 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm"
            />
          </div>
          {err && <div className="text-sm text-destructive">{err}</div>}
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="rounded-lg border border-border bg-card px-4 py-2 text-sm">
              Cancel
            </button>
            <button type="submit" disabled={busy} className="rounded-lg bg-primary text-primary-foreground px-4 py-2 text-sm disabled:opacity-60">
              {busy ? "Saving…" : "Record"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
