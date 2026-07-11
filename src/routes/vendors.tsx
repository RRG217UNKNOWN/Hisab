import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { z } from "zod";
import {
  Search,
  Clock,
  CheckCircle2,
  ArrowDownLeft,
  Plus,
  Trash2,
  Pencil,
  X,
} from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { useT } from "@/lib/i18n";

export const Route = createFileRoute("/vendors")({
  component: VendorsPage,
  head: () => ({
    meta: [
      { title: "Vendors · Hisab" },
      { name: "description", content: "Vendor dues ledger: pending, settled, and amounts others owe you." },
    ],
  }),
});

type Status = "pending" | "settled" | "owed";
type Entry = {
  id: string;
  vendor_name: string;
  category: string;
  amount: number;
  status: Status;
  note: string | null;
  created_at: string;
};

type RangeKey = "day" | "week" | "month" | "all";
type TabKey = "all" | Status;

const RANGE_DAYS: Record<RangeKey, number> = { day: 1, week: 7, month: 30, all: 3650 };
const inr = (n: number) => "₹" + n.toLocaleString("en-IN");

const entrySchema = z.object({
  vendor_name: z.string().trim().min(1, "Vendor name required").max(120),
  category: z.string().trim().max(60),
  amount: z.number().min(0).max(10_000_000),
  status: z.enum(["pending", "settled", "owed"]),
  note: z.string().trim().max(200).optional().or(z.literal("")),
});

// Untyped Supabase table refs for new tables not yet in generated types.
type Sb = {
  from: (t: string) => {
    select: (s: string, opts?: unknown) => {
      order: (c: string, o?: unknown) => Promise<{ data: unknown[] | null; error: { message: string } | null }>;
    };
    insert: (row: unknown) => { select: (s: string) => { single: () => Promise<{ data: unknown; error: { message: string } | null }> } };
    update: (row: unknown) => { eq: (c: string, v: string) => Promise<{ error: { message: string } | null }> };
    delete: () => { eq: (c: string, v: string) => Promise<{ error: { message: string } | null }> };
  };
};
const sb = supabase as unknown as Sb;

function VendorsPage() {
  const { user } = useAuth();
  const { t } = useT();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [range, setRange] = useState<RangeKey>("month");
  const [tab, setTab] = useState<TabKey>("all");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<Entry | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    const { data, error } = await sb
      .from("vendor_dues")
      .select("id, vendor_name, category, amount, status, note, created_at")
      .order("created_at", { ascending: false });
    if (error) setError(error.message);
    setEntries(
      ((data as Entry[] | null) ?? []).map((r) => ({
        ...r,
        amount: Number(r.amount),
      })),
    );
    setLoading(false);
  }, [user]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const now = new Date();
    const cutoff = new Date(now);
    cutoff.setDate(cutoff.getDate() - RANGE_DAYS[range]);
    const q = query.trim().toLowerCase();
    return entries.filter((e) => {
      if (new Date(e.created_at) < cutoff) return false;
      if (tab !== "all" && e.status !== tab) return false;
      if (q && !e.vendor_name.toLowerCase().includes(q) && !e.category.toLowerCase().includes(q))
        return false;
      return true;
    });
  }, [entries, range, tab, query]);

  const totals = useMemo(() => {
    const now = new Date();
    const cutoff = new Date(now);
    cutoff.setDate(cutoff.getDate() - RANGE_DAYS[range]);
    const scope = entries.filter((e) => new Date(e.created_at) >= cutoff);
    const sum = (s: Status) => scope.filter((e) => e.status === s).reduce((a, b) => a + b.amount, 0);
    return {
      pending: sum("pending"),
      settled: sum("settled"),
      owed: sum("owed"),
      count: scope.length,
    };
  }, [entries, range]);

  const removeEntry = async (id: string) => {
    if (!confirm("Delete this entry?")) return;
    const { error } = await sb.from("vendor_dues").delete().eq("id", id);
    if (error) alert(error.message);
    else void load();
  };

  return (
    <AppShell active="vendors" title={t("ven.title")}>
      <div className="px-4 md:px-10 py-6 md:py-8 space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-widest text-muted-foreground">
              Vendors · व्यापारी
            </p>
            <h1 className="mt-1 font-display text-3xl md:text-4xl text-ink">{t("ven.title")}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{totals.count} entries in view</p>
          </div>
          <button
            onClick={() => setShowAdd(true)}
            className="inline-flex items-center gap-1.5 rounded-full bg-primary text-primary-foreground px-4 py-2 text-sm"
          >
            <Plus size={14} /> Add entry
          </button>
        </div>

        {error && (
          <div className="rounded-lg bg-destructive/10 text-destructive text-sm px-3 py-2">{error}</div>
        )}

        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search vendor or category…"
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
            value={inr(totals.settled)}
            caption="Paid this period"
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
                  tab === k ? "bg-card text-ink shadow-sm" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="mt-4 space-y-2">
            {filtered.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">
                {loading ? "Loading…" : "No entries yet. Add your first vendor due."}
              </p>
            ) : (
              filtered.map((e) => (
                <div key={e.id} className="rounded-lg border border-border p-3 flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm text-ink truncate">{e.vendor_name}</div>
                    <div className="text-xs text-muted-foreground truncate">
                      {e.category} · {new Date(e.created_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}
                    </div>
                    {e.note && (
                      <div className="text-xs text-muted-foreground mt-1 truncate">{e.note}</div>
                    )}
                  </div>
                  <div className="text-right shrink-0">
                    <div className="font-medium tabular-nums text-ink">{inr(e.amount)}</div>
                    <StatusPill status={e.status} />
                  </div>
                  <div className="flex flex-col gap-1 shrink-0">
                    <button
                      onClick={() => setEditing(e)}
                      className="h-7 w-7 grid place-items-center rounded hover:bg-muted text-muted-foreground"
                      aria-label="Edit"
                    >
                      <Pencil size={13} />
                    </button>
                    <button
                      onClick={() => void removeEntry(e.id)}
                      className="h-7 w-7 grid place-items-center rounded hover:bg-muted text-destructive"
                      aria-label="Delete"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      </div>

      {(showAdd || editing) && (
        <EntryDialog
          entry={editing}
          userId={user?.id ?? ""}
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

function StatusPill({ status }: { status: Status }) {
  const map: Record<Status, { label: string; cls: string }> = {
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

function EntryDialog({
  entry,
  userId,
  onClose,
  onSaved,
}: {
  entry: Entry | null;
  userId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    vendor_name: entry?.vendor_name ?? "",
    category: entry?.category ?? "General",
    amount: entry?.amount ?? 0,
    status: (entry?.status ?? "pending") as Status,
    note: entry?.note ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    setErr(null);
    const parsed = entrySchema.safeParse({ ...form, amount: Number(form.amount) });
    if (!parsed.success) {
      setErr(parsed.error.issues[0]?.message ?? "Invalid input");
      return;
    }
    setBusy(true);
    if (entry) {
      const { error } = await sb
        .from("vendor_dues")
        .update({ ...parsed.data, note: parsed.data.note || null })
        .eq("id", entry.id);
      if (error) setErr(error.message);
      else onSaved();
    } else {
      const { error } = await sb
        .from("vendor_dues")
        .insert({ ...parsed.data, note: parsed.data.note || null, user_id: userId })
        .select("id")
        .single();
      if (error) setErr(error.message);
      else onSaved();
    }
    setBusy(false);
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/40 backdrop-blur-sm px-4">
      <div className="w-full max-w-md rounded-xl bg-card p-5 shadow-xl">
        <div className="flex items-center justify-between mb-4">
          <div className="font-display text-lg text-ink">{entry ? "Edit entry" : "New vendor entry"}</div>
          <button onClick={onClose} aria-label="Close" className="h-8 w-8 grid place-items-center rounded hover:bg-muted">
            <X size={16} />
          </button>
        </div>
        <div className="space-y-3">
          <Field label="Vendor" value={form.vendor_name} onChange={(v) => setForm({ ...form, vendor_name: v })} />
          <Field label="Category" value={form.category} onChange={(v) => setForm({ ...form, category: v })} />
          <label className="block">
            <span className="block text-xs text-muted-foreground mb-1">Amount (₹)</span>
            <input
              type="number"
              value={form.amount}
              onChange={(e) => setForm({ ...form, amount: Number(e.target.value) })}
              className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/40"
            />
          </label>
          <label className="block">
            <span className="block text-xs text-muted-foreground mb-1">Status</span>
            <select
              value={form.status}
              onChange={(e) => setForm({ ...form, status: e.target.value as Status })}
              className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/40"
            >
              <option value="pending">Pending — you owe</option>
              <option value="settled">Settled</option>
              <option value="owed">They owe you</option>
            </select>
          </label>
          <Field label="Note (optional)" value={form.note} onChange={(v) => setForm({ ...form, note: v })} />
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
              {busy ? "Saving…" : entry ? "Save changes" : "Add entry"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
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
