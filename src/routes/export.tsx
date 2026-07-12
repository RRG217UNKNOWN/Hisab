import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { Download } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/hooks/use-auth";
import { useProfile } from "@/hooks/use-profile";
import { supabase } from "@/integrations/supabase/client";
import { can } from "@/lib/permissions";

export const Route = createFileRoute("/export")({
  component: ExportPage,
  head: () => ({ meta: [{ title: "Export · Hisab" }] }),
});

type Warehouse = { id: string; name: string };
type DataType = "inventory" | "sales" | "expenses" | "bills";

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[,"\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function download(filename: string, rows: Record<string, unknown>[]) {
  if (!rows.length) {
    alert("No data to export");
    return;
  }
  const headers = Object.keys(rows[0]);
  const csv = [
    headers.join(","),
    ...rows.map((r) => headers.map((h) => csvEscape(r[h])).join(",")),
  ].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function ExportPage() {
  const { user } = useAuth();
  const { profile } = useProfile();
  if (!can.viewReports(profile?.role)) {
    return (
      <AppShell active="export" title="Export">
        <div className="px-4 md:px-10 py-6"><p className="text-muted-foreground">Not authorised.</p></div>
      </AppShell>
    );
  }

  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [scope, setScope] = useState("all");
  const [type, setType] = useState<DataType>("inventory");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase.from("warehouses").select("id, name").order("created_at");
    setWarehouses(data ?? []);
  }, []);
  useEffect(() => {
    if (user) void load();
  }, [user, load]);

  const doExport = async () => {
    setBusy(true);
    const table = type;
    const dateCol = type === "bills" ? "invoice_date" : "created_at";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q: any = (supabase as any).from(table).select("*");
    if (scope !== "all" && type !== "expenses") q = q.eq("warehouse_id", scope);
    if (from) q = q.gte(dateCol, from);
    if (to) q = q.lte(dateCol, to);
    q = q.order(dateCol);
    const { data } = await q;
    setBusy(false);
    download(`${type}-${new Date().toISOString().slice(0, 10)}.csv`, (data as Record<string, unknown>[]) ?? []);
  };

  return (
    <AppShell active="export" title="Export">
      <div className="px-4 md:px-10 py-6 md:py-8 space-y-6 max-w-2xl">
        <header>
          <p className="text-xs uppercase tracking-widest text-muted-foreground">
            <Download size={12} className="inline mr-1" /> download data
          </p>
          <h1 className="mt-1 font-display text-3xl md:text-4xl text-ink">Export</h1>
        </header>

        <div className="card-warm p-5 space-y-4">
          <div>
            <label className="block text-xs uppercase tracking-wider text-muted-foreground mb-2">Data type</label>
            <div className="flex flex-wrap gap-2">
              {(["inventory", "sales", "expenses", "bills"] as DataType[]).map((t) => (
                <button
                  key={t}
                  onClick={() => setType(t)}
                  className={`rounded-full px-4 py-1.5 text-sm capitalize transition ${
                    type === t ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs uppercase tracking-wider text-muted-foreground mb-2">Shop</label>
            <select value={scope} onChange={(e) => setScope(e.target.value)} className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm">
              <option value="all">All shops</option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>{w.name}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="block text-xs uppercase tracking-wider text-muted-foreground mb-1">From</span>
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm" />
            </label>
            <label className="block">
              <span className="block text-xs uppercase tracking-wider text-muted-foreground mb-1">To</span>
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm" />
            </label>
          </div>

          <button
            onClick={doExport}
            disabled={busy}
            className="w-full rounded-lg bg-primary text-primary-foreground px-4 py-2.5 text-sm disabled:opacity-60"
          >
            {busy ? "Preparing…" : "Download CSV"}
          </button>
        </div>
      </div>
    </AppShell>
  );
}
