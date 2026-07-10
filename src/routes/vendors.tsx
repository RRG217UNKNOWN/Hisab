import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { z } from "zod";
import {
  Search,
  ArrowDownLeft,
  ArrowUpRight,
  Scale,
  Plus,
  Trash2,
  Pencil,
  X,
  Receipt,
} from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/hooks/use-auth";
import { useProfile } from "@/hooks/use-profile";
import { supabase } from "@/integrations/supabase/client";
import { useT } from "@/lib/i18n";
import { can } from "@/lib/permissions";

export const Route = createFileRoute("/vendors")({
  component: PartiesPage,
  head: () => ({
    meta: [
      { title: "Parties · Hisab" },
      { name: "description", content: "Vendors and customers with a real running ledger of what you owe and what's owed to you." },
    ],
  }),
});

type PartyType = "vendor" | "customer" | "both";
type Party = {
  id: string;
  name: string;
  type: PartyType;
  address: string | null;
  state: string | null;
  country: string | null;
  phone: string | null;
  email: string | null;
  gst_no: string | null;
  pan_no: string | null;
  registration_type: string | null;
  bank_account_no: string | null;
  bank_ifsc: string | null;
  bank_name: string | null;
  notes: string | null;
  created_at: string;
};

type LedgerRow = {
  party_id: string;
  kind: "purchase" | "expense" | "sale";
  label: string;
  amount: number;
  payment_method: "cash" | "credit";
  date: string;
};

const inr = (n: number) => "₹" + Math.abs(n).toLocaleString("en-IN", { maximumFractionDigits: 2 });

const partySchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  type: z.enum(["vendor", "customer", "both"]),
  address: z.string().trim().max(300).optional().or(z.literal("")),
  state: z.string().trim().max(100).optional().or(z.literal("")),
  country: z.string().trim().max(100).optional().or(z.literal("")),
  phone: z.string().trim().max(30).optional().or(z.literal("")),
  email: z.string().trim().email("Invalid email").max(200).optional().or(z.literal("")),
  gst_no: z.string().trim().max(30).optional().or(z.literal("")),
  pan_no: z.string().trim().max(20).optional().or(z.literal("")),
  registration_type: z.string().trim().max(60).optional().or(z.literal("")),
  bank_account_no: z.string().trim().max(40).optional().or(z.literal("")),
  bank_ifsc: z.string().trim().max(20).optional().or(z.literal("")),
  bank_name: z.string().trim().max(120).optional().or(z.literal("")),
  notes: z.string().trim().max(500).optional().or(z.literal("")),
});

function PartiesPage() {
  const { user } = useAuth();
  const { profile } = useProfile();
  const { t } = useT();
  const role = profile?.role;
  const canWrite = can.writeInventory(role); // owner/manager/staff — same roles that can record purchases/sales on credit

  const [parties, setParties] = useState<Party[]>([]);
  const [ledger, setLedger] = useState<LedgerRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [typeTab, setTypeTab] = useState<"all" | PartyType>("all");
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Party | null>(null);
  const [viewing, setViewing] = useState<Party | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    const [p, pu, ex, sa] = await Promise.all([
      supabase
        .from("parties")
        .select(
          "id, name, type, address, state, country, phone, email, gst_no, pan_no, registration_type, bank_account_no, bank_ifsc, bank_name, notes, created_at",
        )
        .order("name"),
      supabase.from("purchases").select("party_id, total, payment_method, transaction_date, invoice_number"),
      supabase.from("expenses").select("party_id, amount, payment_method, created_at, label"),
      supabase.from("sales").select("party_id, total, payment_method, created_at, item_name"),
    ]);
    if (p.error) setError(p.error.message);
    setParties(((p.data as Party[] | null) ?? []));

    const rows: LedgerRow[] = [];
    for (const r of (pu.data as { party_id: string | null; total: number; payment_method: "cash" | "credit"; transaction_date: string; invoice_number: string | null }[] | null) ?? []) {
      if (!r.party_id) continue;
      rows.push({
        party_id: r.party_id,
        kind: "purchase",
        label: r.invoice_number ? `Purchase · Inv #${r.invoice_number}` : "Purchase voucher",
        amount: Number(r.total),
        payment_method: r.payment_method,
        date: r.transaction_date,
      });
    }
    for (const r of (ex.data as { party_id: string | null; amount: number; payment_method: "cash" | "credit"; created_at: string; label: string }[] | null) ?? []) {
      if (!r.party_id) continue;
      rows.push({
        party_id: r.party_id,
        kind: "expense",
        label: `Expense · ${r.label}`,
        amount: Number(r.amount),
        payment_method: r.payment_method,
        date: r.created_at,
      });
    }
    for (const r of (sa.data as { party_id: string | null; total: number; payment_method: "cash" | "credit"; created_at: string; item_name: string }[] | null) ?? []) {
      if (!r.party_id) continue;
      rows.push({
        party_id: r.party_id,
        kind: "sale",
        label: `Sale · ${r.item_name}`,
        amount: Number(r.total),
        payment_method: r.payment_method,
        date: r.created_at,
      });
    }
    rows.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    setLedger(rows);
    setLoading(false);
  }, [user]);

  useEffect(() => {
    void load();
  }, [load]);

  // Outstanding balance per party. Credit purchases/expenses = you owe them (payable).
  // Credit sales = they owe you (receivable). Cash transactions net to zero (already settled).
  const balances = useMemo(() => {
    const map = new Map<string, { payable: number; receivable: number }>();
    for (const row of ledger) {
      if (row.payment_method !== "credit") continue;
      const b = map.get(row.party_id) ?? { payable: 0, receivable: 0 };
      if (row.kind === "sale") b.receivable += row.amount;
      else b.payable += row.amount;
      map.set(row.party_id, b);
    }
    return map;
  }, [ledger]);

  const totals = useMemo(() => {
    let payable = 0;
    let receivable = 0;
    for (const b of balances.values()) {
      payable += b.payable;
      receivable += b.receivable;
    }
    return { payable, receivable, net: receivable - payable };
  }, [balances]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return parties.filter((p) => {
      if (typeTab !== "all" && p.type !== typeTab && p.type !== "both") return false;
      if (q && !p.name.toLowerCase().includes(q) && !(p.phone ?? "").includes(q) && !(p.email ?? "").toLowerCase().includes(q))
        return false;
      return true;
    });
  }, [parties, typeTab, query]);

  const removeParty = async (id: string) => {
    if (!confirm("Delete this party? This does not delete past transactions.")) return;
    const { error } = await supabase.from("parties").delete().eq("id", id);
    if (error) alert(error.message);
    else void load();
  };

  return (
    <AppShell active="vendors" title={t("ven.title")}>
      <div className="px-4 md:px-10 py-6 md:py-8 space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-widest text-muted-foreground">Parties · व्यापारी</p>
            <h1 className="mt-1 font-display text-3xl md:text-4xl text-ink">{t("ven.title")}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{filtered.length} parties</p>
          </div>
          {canWrite && (
            <button
              onClick={() => setShowForm(true)}
              className="inline-flex items-center gap-1.5 rounded-full bg-primary text-primary-foreground px-4 py-2 text-sm"
            >
              <Plus size={14} /> Add party
            </button>
          )}
        </div>

        {error && <div className="rounded-lg bg-destructive/10 text-destructive text-sm px-3 py-2">{error}</div>}

        <section className="grid gap-3 sm:grid-cols-3">
          <SummaryCard
            icon={<ArrowUpRight size={16} className="text-warning" />}
            label="You owe them"
            value={inr(totals.payable)}
            caption="Outstanding credit purchases & expenses"
          />
          <SummaryCard
            icon={<ArrowDownLeft size={16} className="text-success" />}
            label="They owe you"
            value={inr(totals.receivable)}
            caption="Outstanding credit sales"
          />
          <SummaryCard
            icon={<Scale size={16} className="text-ink" />}
            label="Net balance"
            value={`${totals.net >= 0 ? "+" : "−"}${inr(totals.net)}`}
            caption={totals.net >= 0 ? "In your favor overall" : "You owe more overall"}
          />
        </section>

        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search party, phone or email…"
            className="w-full rounded-lg border border-border bg-card pl-9 pr-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-ring/40"
          />
        </div>

        <div className="flex items-center gap-1 rounded-full border border-border bg-card p-0.5 text-xs overflow-x-auto w-fit">
          {(
            [
              ["all", "All"],
              ["vendor", "Vendors"],
              ["customer", "Customers"],
              ["both", "Both"],
            ] as [typeof typeTab, string][]
          ).map(([k, label]) => (
            <button
              key={k}
              onClick={() => setTypeTab(k)}
              className={`px-3 py-1.5 rounded-full transition whitespace-nowrap ${
                typeTab === k ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <section className="card-warm p-4 md:p-6">
          <div className="space-y-2">
            {filtered.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">
                {loading ? "Loading…" : "No parties yet. Add a vendor or customer to start a ledger."}
              </p>
            ) : (
              filtered.map((p) => {
                const bal = balances.get(p.id) ?? { payable: 0, receivable: 0 };
                const net = bal.receivable - bal.payable;
                return (
                  <div
                    key={p.id}
                    onClick={() => setViewing(p)}
                    className="rounded-lg border border-border p-3 flex items-start gap-3 cursor-pointer hover:bg-muted/40"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-sm text-ink truncate font-medium">{p.name}</div>
                      <div className="text-xs text-muted-foreground truncate capitalize">
                        {p.type} {p.phone ? `· ${p.phone}` : ""}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className={`font-medium tabular-nums ${net >= 0 ? "text-success" : "text-warning"}`}>
                        {net >= 0 ? "+" : "−"}
                        {inr(net)}
                      </div>
                      <div className="text-[10px] text-muted-foreground">{net >= 0 ? "owes you" : "you owe"}</div>
                    </div>
                    {canWrite && (
                      <div className="flex flex-col gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={() => setEditing(p)}
                          className="h-7 w-7 grid place-items-center rounded hover:bg-muted text-muted-foreground"
                          aria-label="Edit"
                        >
                          <Pencil size={13} />
                        </button>
                        <button
                          onClick={() => void removeParty(p.id)}
                          className="h-7 w-7 grid place-items-center rounded hover:bg-muted text-destructive"
                          aria-label="Delete"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </section>
      </div>

      {(showForm || editing) && (
        <PartyDialog
          party={editing}
          userId={user?.id ?? ""}
          onClose={() => {
            setShowForm(false);
            setEditing(null);
          }}
          onSaved={() => {
            setShowForm(false);
            setEditing(null);
            void load();
          }}
        />
      )}

      {viewing && (
        <LedgerDrawer
          party={viewing}
          rows={ledger.filter((r) => r.party_id === viewing.id)}
          onClose={() => setViewing(null)}
        />
      )}
    </AppShell>
  );
}

function SummaryCard({ icon, label, value, caption }: { icon: React.ReactNode; label: string; value: string; caption: string }) {
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

function LedgerDrawer({ party, rows, onClose }: { party: Party; rows: LedgerRow[]; onClose: () => void }) {
  let running = 0;
  const withRunning = rows.map((r) => {
    if (r.payment_method === "credit") {
      running += r.kind === "sale" ? r.amount : -r.amount;
    }
    return { ...r, running };
  });
  const payable = rows.filter((r) => r.payment_method === "credit" && r.kind !== "sale").reduce((a, b) => a + b.amount, 0);
  const receivable = rows.filter((r) => r.payment_method === "credit" && r.kind === "sale").reduce((a, b) => a + b.amount, 0);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/40 backdrop-blur-sm px-4 py-6">
      <div className="w-full max-w-lg max-h-[85vh] overflow-y-auto rounded-xl bg-card p-5 shadow-xl">
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="font-display text-lg text-ink">{party.name}</div>
            <div className="text-xs text-muted-foreground capitalize">{party.type} ledger</div>
          </div>
          <button onClick={onClose} aria-label="Close" className="h-8 w-8 grid place-items-center rounded hover:bg-muted">
            <X size={16} />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3 mb-4">
          <div className="rounded-lg border border-border p-3">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">You owe them</div>
            <div className="mt-1 font-display text-xl text-warning tabular-nums">{inr(payable)}</div>
          </div>
          <div className="rounded-lg border border-border p-3">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">They owe you</div>
            <div className="mt-1 font-display text-xl text-success tabular-nums">{inr(receivable)}</div>
          </div>
        </div>
        <div className="text-xs text-muted-foreground mb-4">
          Net: <span className="text-ink font-medium">{receivable - payable >= 0 ? "+" : "−"}{inr(receivable - payable)}</span>{" "}
          {receivable - payable >= 0 ? "(they owe you)" : "(you owe them)"} — outstanding credit only; cash transactions below are already settled.
        </div>

        <div className="space-y-2">
          {withRunning.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No transactions with this party yet.</p>
          ) : (
            [...withRunning].reverse().map((r, i) => (
              <div key={i} className="rounded-lg border border-border p-3 flex items-center gap-3">
                <Receipt size={14} className="text-muted-foreground shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-ink truncate">{r.label}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {new Date(r.date).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })} ·{" "}
                    {r.payment_method === "credit" ? "On credit" : "Paid in cash"}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className={`text-sm tabular-nums ${r.kind === "sale" ? "text-success" : "text-warning"}`}>
                    {r.kind === "sale" ? "+" : "−"}
                    {inr(r.amount)}
                  </div>
                  <div className="text-[10px] text-muted-foreground tabular-nums">bal {r.running >= 0 ? "+" : "−"}{inr(r.running)}</div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function PartyDialog({
  party,
  userId,
  onClose,
  onSaved,
}: {
  party: Party | null;
  userId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    name: party?.name ?? "",
    type: (party?.type ?? "vendor") as PartyType,
    address: party?.address ?? "",
    state: party?.state ?? "",
    country: party?.country ?? "",
    phone: party?.phone ?? "",
    email: party?.email ?? "",
    gst_no: party?.gst_no ?? "",
    pan_no: party?.pan_no ?? "",
    registration_type: party?.registration_type ?? "",
    bank_account_no: party?.bank_account_no ?? "",
    bank_ifsc: party?.bank_ifsc ?? "",
    bank_name: party?.bank_name ?? "",
    notes: party?.notes ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    setErr(null);
    const parsed = partySchema.safeParse(form);
    if (!parsed.success) {
      setErr(parsed.error.issues[0]?.message ?? "Invalid input");
      return;
    }
    const cleaned = Object.fromEntries(
      Object.entries(parsed.data).map(([k, v]) => [k, v === "" ? null : v]),
    );
    setBusy(true);
    if (party) {
      const { error } = await supabase.from("parties").update(cleaned).eq("id", party.id);
      if (error) setErr(error.message);
      else onSaved();
    } else {
      const { error } = await supabase.from("parties").insert({ ...cleaned, user_id: userId });
      if (error) setErr(error.message);
      else onSaved();
    }
    setBusy(false);
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/40 backdrop-blur-sm px-4 py-6">
      <div className="w-full max-w-lg max-h-[85vh] overflow-y-auto rounded-xl bg-card p-5 shadow-xl">
        <div className="flex items-center justify-between mb-4">
          <div className="font-display text-lg text-ink">{party ? "Edit party" : "New party"}</div>
          <button onClick={onClose} aria-label="Close" className="h-8 w-8 grid place-items-center rounded hover:bg-muted">
            <X size={16} />
          </button>
        </div>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Name *" value={form.name} onChange={set("name")} />
            <label className="block">
              <span className="block text-xs text-muted-foreground mb-1">Type *</span>
              <select
                value={form.type}
                onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as PartyType }))}
                className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/40"
              >
                <option value="vendor">Vendor</option>
                <option value="customer">Customer</option>
                <option value="both">Both</option>
              </select>
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Phone" value={form.phone} onChange={set("phone")} />
            <Field label="Email" value={form.email} onChange={set("email")} />
          </div>
          <Field label="Address" value={form.address} onChange={set("address")} />
          <div className="grid grid-cols-2 gap-3">
            <Field label="State" value={form.state} onChange={set("state")} />
            <Field label="Country" value={form.country} onChange={set("country")} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="GST No." value={form.gst_no} onChange={set("gst_no")} />
            <Field label="PAN No." value={form.pan_no} onChange={set("pan_no")} />
          </div>
          <Field label="Registration type" value={form.registration_type} onChange={set("registration_type")} />
          <div className="grid grid-cols-2 gap-3">
            <Field label="Bank account no." value={form.bank_account_no} onChange={set("bank_account_no")} />
            <Field label="IFSC" value={form.bank_ifsc} onChange={set("bank_ifsc")} />
          </div>
          <Field label="Bank name" value={form.bank_name} onChange={set("bank_name")} />
          <Field label="Notes" value={form.notes} onChange={set("notes")} />
          {err && <div className="text-sm text-destructive">{err}</div>}
          <div className="flex justify-end gap-2 pt-2">
            <button onClick={onClose} className="rounded-lg border border-border bg-card px-4 py-2 text-sm">
              Cancel
            </button>
            <button
              onClick={submit}
              disabled={busy}
              className="rounded-lg bg-primary text-primary-foreground px-4 py-2 text-sm disabled:opacity-60"
            >
              {busy ? "Saving…" : party ? "Save changes" : "Add party"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className="block text-xs text-muted-foreground mb-1">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/40"
      />
    </label>
  );
}
