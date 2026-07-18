import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { Upload, FileText, Check, AlertCircle } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { PendingBillsPanel } from "@/components/PendingBillsPanel";
import { useAuth } from "@/hooks/use-auth";
import { useProfile } from "@/hooks/use-profile";
import { supabase } from "@/integrations/supabase/client";
import { can } from "@/lib/permissions";
import { useT } from "@/lib/i18n";

export const Route = createFileRoute("/import")({
  component: ImportPage,
  head: () => ({ meta: [{ title: "Import · Hisab" }] }),
});

type Warehouse = { id: string; name: string };
type RowInput = {
  name: string;
  category: string;
  stock: number;
  min_stock: number;
  price: number;
  cost_price: number;
  expiry: string | null;
  errors: string[];
  matchId?: string | null;
};

function parseCsv(text: string): string[][] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  return lines.map((line) => {
    const out: string[] = [];
    let cur = "";
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (inQ) {
        if (c === '"' && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else if (c === '"') inQ = false;
        else cur += c;
      } else if (c === '"') inQ = true;
      else if (c === ",") {
        out.push(cur);
        cur = "";
      } else cur += c;
    }
    out.push(cur);
    return out.map((s) => s.trim());
  });
}

function ImportPage() {
  const { user } = useAuth();
  const { profile } = useProfile();
  const { t, tf, formatNumber } = useT();
  if (!can.writeInventory(profile?.role)) {
    return (
      <AppShell active="import" title={t("impexp.title")}>
        <div className="px-4 md:px-10 py-6"><p className="text-muted-foreground">{t("impexp.notAuthorised")}</p></div>
      </AppShell>
    );
  }

  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [shopId, setShopId] = useState("");
  const [mode, setMode] = useState<"products" | "bills">("products");
  const [rows, setRows] = useState<RowInput[]>([]);
  const [existingByName, setExistingByName] = useState<Map<string, string>>(new Map());
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase.from("warehouses").select("id, name").order("created_at");
    setWarehouses(data ?? []);
    if (data && data.length && !shopId) setShopId(data[0].id);
  }, [shopId]);

  useEffect(() => {
    if (user) void load();
  }, [user, load]);

  useEffect(() => {
    if (!shopId) return;
    supabase
      .from("inventory_items")
      .select("id, name")
      .eq("warehouse_id", shopId)
      .then(({ data }) => {
        const m = new Map<string, string>();
        for (const i of data ?? []) m.set(i.name.trim().toLowerCase(), i.id);
        setExistingByName(m);
      });
  }, [shopId]);

  const handleFile = async (file: File) => {
    const text = await file.text();
    const csv = parseCsv(text);
    if (csv.length < 2) {
      setRows([]);
      return;
    }
    const header = csv[0].map((h) => h.toLowerCase());
    const idx = (name: string) => header.indexOf(name);
    const iName = idx("name");
    const iCat = idx("category");
    const iStock = idx("stock");
    const iMin = idx("min_stock");
    const iPrice = idx("price");
    const iCost = idx("cost_price");
    const iExp = idx("expiry");
    const parsed: RowInput[] = csv.slice(1).map((r) => {
      const name = r[iName] ?? "";
      const stock = Number(r[iStock] ?? 0);
      const min_stock = Number(r[iMin] ?? 0);
      const price = Number(r[iPrice] ?? 0);
      const cost_price = Number(r[iCost] ?? 0);
      const expiry = r[iExp] && /^\d{4}-\d{2}-\d{2}$/.test(r[iExp]) ? r[iExp] : null;
      const errors: string[] = [];
      if (!name.trim()) errors.push(t("impexp.nameRequired"));
      if (!Number.isFinite(stock) || stock < 0) errors.push(t("impexp.badStock"));
      if (!Number.isFinite(price) || price < 0) errors.push(t("impexp.badPrice"));
      return {
        name: name.trim(),
        category: (r[iCat] ?? "").trim(),
        stock,
        min_stock: Number.isFinite(min_stock) ? min_stock : 0,
        price,
        cost_price: Number.isFinite(cost_price) ? cost_price : 0,
        expiry,
        errors,
        matchId: existingByName.get(name.trim().toLowerCase()) ?? null,
      };
    });
    setRows(parsed);
  };

  const importAll = async () => {
    if (!user || !shopId) return;
    setImporting(true);
    setResult(null);
    let added = 0;
    let updated = 0;
    let failed = 0;
    for (const r of rows) {
      if (r.errors.length) {
        failed++;
        continue;
      }
      if (r.matchId) {
        const { data: cur } = await supabase.from("inventory_items").select("stock").eq("id", r.matchId).maybeSingle();
        const newStock = (cur?.stock ?? 0) + r.stock;
        const { error } = await supabase.from("inventory_items").update({ stock: newStock }).eq("id", r.matchId);
        if (error) failed++;
        else updated++;
      } else {
        const { error } = await supabase.from("inventory_items").insert({
          user_id: user.id,
          warehouse_id: shopId,
          name: r.name,
          category: r.category,
          stock: r.stock,
          min_stock: r.min_stock,
          price: r.price,
          cost_price: r.cost_price,
          expiry: r.expiry,
        });
        if (error) failed++;
        else added++;
      }
    }
    setImporting(false);
    setResult(tf("impexp.importedResult", { added, updated, failed }));
    setRows([]);
  };

  const validCount = rows.filter((r) => !r.errors.length).length;

  return (
    <AppShell active="import" title={t("impexp.title")}>
      <div className="px-4 md:px-10 py-6 md:py-8 space-y-6 max-w-4xl">
        <header>
          <p className="text-xs uppercase tracking-widest text-muted-foreground">
            <Upload size={12} className="inline mr-1" /> {t("impexp.bulkImport")}
          </p>
          <h1 className="mt-1 font-display text-3xl md:text-4xl text-ink">
            {mode === "products" ? t("impexp.importInventory") : t("bi.pendingBills")}
          </h1>
          {mode === "products" && (
            <p className="mt-1 text-sm text-muted-foreground">
              {t("impexp.csvColumns")} <code>name, category, stock, min_stock, price, cost_price, expiry</code>
            </p>
          )}
        </header>

        <div className="inline-flex items-center gap-1 rounded-full bg-muted p-0.5 text-sm">
          <button
            onClick={() => setMode("products")}
            className={`px-3 py-1.5 rounded-full transition ${
              mode === "products" ? "bg-card shadow-sm text-ink" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t("bi.tabProducts")}
          </button>
          <button
            onClick={() => setMode("bills")}
            className={`px-3 py-1.5 rounded-full transition ${
              mode === "bills" ? "bg-card shadow-sm text-ink" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t("bi.tabBills")}
          </button>
        </div>

        {mode === "products" ? (
          <>
            <div className="card-warm p-5 space-y-3">
              <label className="block">
                <span className="block text-xs uppercase tracking-wider text-muted-foreground mb-1">{t("impexp.targetShop")}</span>
                <select
                  value={shopId}
                  onChange={(e) => setShopId(e.target.value)}
                  className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm"
                >
                  {warehouses.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block border-2 border-dashed border-border rounded-lg p-8 text-center cursor-pointer hover:bg-muted/30">
                <FileText className="mx-auto text-muted-foreground" size={28} />
                <div className="mt-2 text-sm text-ink">{t("impexp.chooseCsvFile")}</div>
                <input
                  type="file"
                  accept=".csv,text/csv"
                  onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
                  className="hidden"
                />
              </label>
            </div>

            {result && (
              <div className="rounded-lg bg-success/10 text-success text-sm px-3 py-2 flex items-center gap-2">
                <Check size={14} /> {result}
              </div>
            )}

            {rows.length > 0 && (
              <div className="card-warm p-4 md:p-6">
                <div className="flex items-baseline justify-between mb-3">
                  <h2 className="font-display text-xl text-ink">{tf("impexp.previewRows", { count: formatNumber(rows.length) })}</h2>
                  <button
                    onClick={importAll}
                    disabled={importing || validCount === 0}
                    className="rounded-full bg-primary text-primary-foreground px-4 py-2 text-sm disabled:opacity-60"
                  >
                    {importing ? t("impexp.importing") : tf("impexp.importRows", { count: formatNumber(validCount) })}
                  </button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground">
                        <th className="py-2">{t("common.name")}</th>
                        <th className="py-2 text-right">{t("impexp.stock")}</th>
                        <th className="py-2 text-right">{t("impexp.price")}</th>
                        <th className="py-2">{t("impexp.match")}</th>
                        <th className="py-2">{t("impexp.status")}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {rows.map((r, i) => (
                        <tr key={i} className={r.errors.length ? "bg-destructive/5" : ""}>
                          <td className="py-2 text-ink">{r.name}</td>
                          <td className="py-2 text-right tabular-nums">{formatNumber(r.stock)}</td>
                          <td className="py-2 text-right tabular-nums">₹{formatNumber(r.price)}</td>
                          <td className="py-2 text-xs text-muted-foreground">{r.matchId ? t("impexp.addToExisting") : t("impexp.createNewRow")}</td>
                          <td className="py-2 text-xs">
                            {r.errors.length ? (
                              <span className="text-destructive flex items-center gap-1">
                                <AlertCircle size={12} /> {r.errors.join(", ")}
                              </span>
                            ) : (
                              <span className="text-success">{t("impexp.ready")}</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        ) : (
          <>
            <div className="card-warm p-5 max-w-xs">
              <label className="block">
                <span className="block text-xs uppercase tracking-wider text-muted-foreground mb-1">{t("impexp.targetShop")}</span>
                <select
                  value={shopId}
                  onChange={(e) => setShopId(e.target.value)}
                  className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm"
                >
                  {warehouses.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <PendingBillsPanel warehouses={warehouses} defaultShopId={shopId} />
          </>
        )}
      </div>
    </AppShell>
  );
}
