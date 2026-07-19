import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { X, Loader2, Check } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { GlobalSearch } from "@/components/GlobalSearch";
import {
  Mic,
  AlertTriangle,
  Clock,
  TrendingUp,
  TrendingDown,
  Bell,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { useT } from "@/lib/i18n";

// Shape returned by the `voice-entry` Supabase Edge Function (transcript +
// parsed entries — each one either stock coming in, or a sale going out).
export type ParsedItem = {
  product: string;
  quantity: number;
  expiry: string | null;
  action: "restock" | "sale";
  unitPrice: number | null;
};

type Warehouse = { id: string; name: string };
type CommittedEntry = ParsedItem & { status: "ok" | "error"; detail?: string };

export const Route = createFileRoute("/")({
  component: Dashboard,
});

const inr = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");

type Sale = {
  item_id: string | null;
  item_name: string;
  quantity: number;
  total: number;
  created_at: string;
};
type Item = {
  id: string;
  name: string;
  stock: number;
  min_stock: number;
  expiry: string | null;
};

function daysUntil(dateStr: string) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((new Date(dateStr).getTime() - today.getTime()) / 86400000);
}

function Dashboard() {
  const { user } = useAuth();
  const { t } = useT();

  const [today, setToday] = useState("");
  useEffect(() => {
    setToday(
      new Date().toLocaleDateString("en-IN", {
        weekday: "long",
        day: "numeric",
        month: "long",
      }),
    );
  }, []);

  const [voiceOpen, setVoiceOpen] = useState(false);
  const [entries, setEntries] = useState<CommittedEntry[]>([]);
  const [committing, setCommitting] = useState(false);

  const [sales, setSales] = useState<Sale[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [name, setName] = useState<string>("");

  const load = useCallback(async () => {
    if (!user) return;
    const [pr, sl, it] = await Promise.all([
      supabase.from("profiles").select("full_name").eq("id", user.id).maybeSingle(),
      supabase
        .from("sales")
        .select("item_id, item_name, quantity, total, created_at")
        .order("created_at", { ascending: false })
        .limit(500),
      supabase
        .from("inventory_items")
        .select("id, name, stock, min_stock, expiry"),
    ]);
    if (pr.data?.full_name) setName(pr.data.full_name);
    setSales(
      (sl.data ?? []).map((s) => ({
        item_id: s.item_id,
        item_name: s.item_name,
        quantity: s.quantity,
        total: Number(s.total),
        created_at: s.created_at,
      })),
    );
    setItems(
      (it.data ?? []).map((r) => ({
        id: r.id,
        name: r.name,
        stock: r.stock,
        min_stock: r.min_stock,
        expiry: r.expiry,
      })),
    );
  }, [user]);

  useEffect(() => {
    if (user) void load();
  }, [user, load]);

  // Actually persist what the voice modal parsed: a "restock" entry adds to
  // inventory (creating the item if it's new, logging a stock adjustment if
  // it already exists), a "sale" entry decrements stock and records a real
  // sales row — the same two tables the rest of the app writes to, so these
  // show up everywhere (Reports, Activity Log, dashboard stats) exactly like
  // a manually-entered one would.
  const commitVoiceEntries = useCallback(
    async (parsed: ParsedItem[]) => {
      if (!user) return;
      setCommitting(true);
      const [whRes, invRes] = await Promise.all([
        supabase.from("warehouses").select("id, name").order("created_at"),
        supabase.from("inventory_items").select("id, name, stock, price, cost_price, warehouse_id"),
      ]);
      const warehouses = (whRes.data as Warehouse[] | null) ?? [];
      const defaultWarehouse = warehouses[0]?.id;
      const inv = ((invRes.data as { id: string; name: string; stock: number; price: number; cost_price: number; warehouse_id: string | null }[] | null) ?? []).map((r) => ({
        ...r,
        price: Number(r.price),
        cost_price: Number(r.cost_price),
      }));

      if (!defaultWarehouse) {
        setCommitting(false);
        return parsed.map((it) => ({ ...it, status: "error" as const, detail: "Create a shop in Inventory first." }));
      }

      const results: CommittedEntry[] = [];
      for (const it of parsed) {
        const match = inv.find((r) => r.name.trim().toLowerCase() === it.product.trim().toLowerCase());
        try {
          if (it.action === "sale") {
            if (!match) {
              results.push({ ...it, status: "error", detail: "No matching item in stock." });
              continue;
            }
            if (match.stock <= 0) {
              results.push({ ...it, status: "error", detail: `"${match.name}" is out of stock.` });
              continue;
            }
            const qty = Math.min(Math.max(1, Math.round(it.quantity) || 1), match.stock);
            const unitPrice = it.unitPrice ?? match.price;
            const total = qty * unitPrice;
            const saleIns = await supabase.from("sales").insert({
              user_id: user.id,
              item_id: match.id,
              warehouse_id: match.warehouse_id,
              item_name: match.name,
              quantity: qty,
              unit_price: unitPrice,
              unit_cost: match.cost_price,
              total,
            });
            if (saleIns.error) {
              results.push({ ...it, status: "error", detail: saleIns.error.message });
              continue;
            }
            const newStock = match.stock - qty;
            await supabase.from("inventory_items").update({ stock: newStock }).eq("id", match.id);
            match.stock = newStock;
            results.push({ ...it, quantity: qty, status: "ok" });
          } else {
            // restock
            if (match) {
              const newStock = match.stock + (Math.round(it.quantity) || 0);
              const adj = await supabase.from("stock_adjustments").insert({
                user_id: user.id,
                item_id: match.id,
                new_stock: newStock,
                reason: "Voice entry — restock",
              });
              if (adj.error) {
                results.push({ ...it, status: "error", detail: adj.error.message });
                continue;
              }
              await supabase
                .from("inventory_items")
                .update({ stock: newStock, ...(it.expiry ? { expiry: it.expiry } : {}) })
                .eq("id", match.id);
              match.stock = newStock;
              results.push({ ...it, status: "ok" });
            } else {
              const ins = await supabase
                .from("inventory_items")
                .insert({
                  user_id: user.id,
                  warehouse_id: defaultWarehouse,
                  name: it.product,
                  category: "Uncategorized",
                  stock: Math.round(it.quantity) || 0,
                  min_stock: 0,
                  price: 0,
                  cost_price: 0,
                  expiry: it.expiry,
                })
                .select("id, name, stock, price, cost_price, warehouse_id")
                .single();
              if (ins.error) {
                results.push({ ...it, status: "error", detail: ins.error.message });
                continue;
              }
              inv.push({ ...(ins.data as { id: string; name: string; stock: number; price: number; cost_price: number; warehouse_id: string | null }) });
              results.push({ ...it, status: "ok" });
            }
          }
        } catch (e) {
          results.push({ ...it, status: "error", detail: e instanceof Error ? e.message : "Something went wrong." });
        }
      }
      setCommitting(false);
      return results;
    },
    [user],
  );

  const now = new Date();
  const startOfDay = new Date(now); startOfDay.setHours(0, 0, 0, 0);
  const weekAgo = new Date(now.getTime() - 7 * 86400000);
  const thirtyAgo = new Date(now.getTime() - 30 * 86400000);

  const todaysSales = sales.filter((s) => new Date(s.created_at) >= startOfDay);
  const todayRevenue = todaysSales.reduce((s, x) => s + x.total, 0);
  const cashInHand = sales.reduce((s, x) => s + x.total, 0);

  const bestSellers = useMemo(() => {
    const map = new Map<string, { name: string; qty: number }>();
    for (const s of sales) {
      if (new Date(s.created_at) < weekAgo) continue;
      const k = s.item_id ?? s.item_name;
      const cur = map.get(k) ?? { name: s.item_name, qty: 0 };
      cur.qty += s.quantity;
      map.set(k, cur);
    }
    return Array.from(map.values()).sort((a, b) => b.qty - a.qty).slice(0, 5);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sales]);

  const lastSoldAt = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of sales) {
      if (!s.item_id) continue;
      const t = new Date(s.created_at).getTime();
      if (!m.has(s.item_id) || m.get(s.item_id)! < t) m.set(s.item_id, t);
    }
    return m;
  }, [sales]);

  const deadStock = items
    .map((i) => {
      const last = lastSoldAt.get(i.id);
      const days = last ? Math.round((now.getTime() - last) / 86400000) : 999;
      return { id: i.id, name: i.name, days };
    })
    .filter((d) => d.days > 30)
    .sort((a, b) => b.days - a.days)
    .slice(0, 5);

  const alerts = useMemo(() => {
    const list: { name: string; kind: string; detail: string; tone: string }[] = [];
    for (const i of items) {
      if (i.stock <= i.min_stock) {
        list.push({ name: i.name, kind: t("dash.lowStock"), detail: `${i.stock} left`, tone: "warn" });
      }
      if (i.expiry) {
        const d = daysUntil(i.expiry);
        if (d >= 0 && d <= 7) {
          list.push({ name: i.name, kind: t("dash.expires"), detail: d === 0 ? "today" : d === 1 ? "tomorrow" : `in ${d} days`, tone: "danger" });
        }
      }
    }
    return list.slice(0, 4);
  }, [items, t]);

  const lowStockItems = useMemo(() => items.filter((i) => i.stock <= i.min_stock), [items]);

  const greeting = name ? `${t("dash.goodMorning")}, ${name}` : t("dash.goodMorning");

  return (
    <AppShell active="dashboard" title="Hisab" headerRight={<NotificationsBell items={lowStockItems} />}>
      <header className="hidden md:flex items-center gap-3 border-b border-border px-6 md:px-10 py-4">
        <GlobalSearch className="flex-1 max-w-md" />
        <NotificationsBell items={lowStockItems} />
      </header>

      <div className="px-4 md:px-10 py-6 md:py-8 space-y-6 md:space-y-8">
        <section className="grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2 card-warm p-7">
            <p className="text-xs uppercase tracking-widest text-muted-foreground">{today}</p>
            <h1 className="mt-2 font-display text-4xl md:text-5xl text-ink">{greeting}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{t("dash.todayShop")}</p>

            <div className="mt-8 grid grid-cols-3 gap-6">
              <Stat label={t("dash.todaysSales")} value={inr(todayRevenue)} />
              <Stat label={t("dash.bills")} value={String(todaysSales.length)} />
              <Stat label={t("dash.cashInHand")} value={inr(cashInHand)} />
            </div>
          </div>

          <div className="card-warm p-7 flex flex-col items-center justify-center text-center">
            <button
              onClick={() => setVoiceOpen(true)}
              className="pulse-mic h-20 w-20 rounded-full bg-primary text-primary-foreground grid place-items-center transition hover:scale-105"
              aria-label="Voice entry"
            >
              <Mic size={30} />
            </button>
            <div className="mt-5 font-display text-xl text-ink">{t("dash.voicePrompt")}</div>
            <p className="mt-1 text-xs text-muted-foreground">{t("dash.voiceHint")}</p>
          </div>
        </section>

        {committing && (
          <section className="card-warm p-4 flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 size={15} className="animate-spin" /> {t("dash.savingVoiceEntries")}
          </section>
        )}

        {entries.length > 0 && (
          <section className="card-warm p-6">
            <div className="flex items-baseline justify-between">
              <SectionTitle>{t("dash.addedByVoice")}</SectionTitle>
              <button
                onClick={() => setEntries([])}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                {t("dash.clear")}
              </button>
            </div>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground">
                    <th className="py-2 font-medium">Product</th>
                    <th className="py-2 font-medium">Type</th>
                    <th className="py-2 font-medium text-right">Qty</th>
                    <th className="py-2 font-medium text-right">Expiry</th>
                    <th className="py-2 font-medium text-right">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {entries.map((e, i) => (
                    <tr key={i}>
                      <td className="py-3 text-ink">{e.product}</td>
                      <td className="py-3">
                        <span
                          className={`text-[10px] px-2 py-0.5 rounded-full capitalize ${
                            e.action === "sale" ? "bg-success/15 text-success" : "bg-warning/15 text-warning"
                          }`}
                        >
                          {e.action === "sale" ? t("dash.sale") : t("dash.restock")}
                        </span>
                      </td>
                      <td className="py-3 text-right tabular-nums">{e.quantity}</td>
                      <td className="py-3 text-right text-muted-foreground">{e.expiry ?? "—"}</td>
                      <td className="py-3 text-right">
                        {e.status === "ok" ? (
                          <span className="text-xs text-success inline-flex items-center gap-1">
                            <Check size={12} /> {t("dash.saved")}
                          </span>
                        ) : (
                          <span className="text-xs text-destructive" title={e.detail}>
                            {t("dash.failed")}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        <section>
          <SectionTitle>{t("dash.needsAttention")}</SectionTitle>
          {alerts.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">{t("common.noDataYet")}</p>
          ) : (
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {alerts.map((a, i) => (
                <div key={i} className="card-warm p-4">
                  <div className="flex items-center gap-2 text-xs">
                    {a.tone === "danger" ? (
                      <Clock size={14} className="text-destructive" />
                    ) : (
                      <AlertTriangle size={14} className="text-warning" />
                    )}
                    <span
                      className={
                        a.tone === "danger"
                          ? "text-destructive font-medium"
                          : "text-warning font-medium"
                      }
                    >
                      {a.kind}
                    </span>
                  </div>
                  <div className="mt-2 text-sm font-medium text-ink">{a.name}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">{a.detail}</div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="grid gap-6 lg:grid-cols-2">
          <div className="card-warm p-6">
            <div className="flex items-baseline justify-between">
              <SectionTitle>{t("dash.bestSellers")}</SectionTitle>
              <span className="text-xs text-muted-foreground">Top 5</span>
            </div>
            {bestSellers.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">{t("common.noDataYet")}</p>
            ) : (
              <ul className="mt-4 divide-y divide-border">
                {bestSellers.map((p, i) => (
                  <li key={p.name} className="flex items-center justify-between py-3">
                    <div className="flex items-center gap-3">
                      <span className="font-display text-lg text-sand-500 w-6 text-right">{i + 1}</span>
                      <span className="text-sm text-ink">{p.name}</span>
                    </div>
                    <div className="flex items-center gap-3 text-sm">
                      <span className="tabular-nums text-muted-foreground">{p.qty} sold</span>
                      <TrendingUp size={12} className="text-success" />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="card-warm p-6">
            <div className="flex items-baseline justify-between">
              <SectionTitle>{t("dash.deadStock")}</SectionTitle>
              <span className="text-xs text-muted-foreground">{t("dash.deadStockHint")}</span>
            </div>
            {deadStock.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">{t("common.noDataYet")}</p>
            ) : (
              <ul className="mt-4 space-y-3">
                {deadStock.map((d) => (
                  <li key={d.id} className="flex items-center justify-between rounded-lg bg-muted/60 px-4 py-3">
                    <span className="text-sm text-ink">{d.name}</span>
                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                      <TrendingDown size={12} />
                      {d.days === 999 ? "no sale yet" : `${d.days} days idle`}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

      </div>

      {voiceOpen && (
        <VoiceEntryModal
          onClose={() => setVoiceOpen(false)}
          onSave={(items) => {
            setVoiceOpen(false);
            void (async () => {
              const results = await commitVoiceEntries(items);
              if (results) setEntries((prev) => [...results, ...prev]);
              void load();
            })();
          }}
        />
      )}
    </AppShell>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="font-display text-xl text-ink">{children}</h2>;
}

function NotificationsBell({ items }: { items: Item[] }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label={t("dash.notifications")}
        className="relative h-9 w-9 grid place-items-center rounded-full hover:bg-muted"
      >
        <Bell size={18} />
        {items.length > 0 && (
          <span className="absolute top-1 right-1 min-w-[16px] h-4 px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] leading-4 text-center">
            {items.length > 9 ? "9+" : items.length}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-72 max-h-80 overflow-y-auto rounded-xl border border-border bg-popover text-popover-foreground shadow-lg z-30 p-2">
          <div className="px-2 py-1.5 text-xs uppercase tracking-wider text-muted-foreground">
            {t("dash.lowStockAlerts")}
          </div>
          {items.length === 0 ? (
            <p className="px-2 py-4 text-sm text-muted-foreground text-center">{t("dash.noLowStock")}</p>
          ) : (
            <ul className="divide-y divide-border">
              {items.map((i) => (
                <li key={i.id} className="flex items-center justify-between gap-3 px-2 py-2 text-sm">
                  <span className="text-ink truncate">{i.name}</span>
                  <span className="text-xs text-destructive tabular-nums shrink-0">{i.stock} left</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-2 font-display text-2xl md:text-3xl text-ink tabular-nums">{value}</div>
    </div>
  );
}

function VoiceEntryModal({
  onClose,
  onSave,
}: {
  onClose: () => void;
  onSave: (items: ParsedItem[]) => void;
}) {
  const [status, setStatus] = useState<"idle" | "recording" | "processing" | "review" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [transcript, setTranscript] = useState("");
  const [items, setItems] = useState<ParsedItem[]>([]);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  const cleanupStream = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  };

  useEffect(() => () => cleanupStream(), []);

  const startRecording = async () => {
    setErrorMsg("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mimeType = MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "audio/mp4";
      const rec = new MediaRecorder(stream, { mimeType });
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = async () => {
        cleanupStream();
        const blob = new Blob(chunksRef.current, { type: mimeType });
        if (blob.size < 1024) {
          setStatus("error");
          setErrorMsg("Recording was too short. Please try again.");
          return;
        }
        setStatus("processing");
        try {
          const buf = await blob.arrayBuffer();
          const bytes = new Uint8Array(buf);
          let binary = "";
          for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
          const audioBase64 = btoa(binary);
          const { data, error } = await supabase.functions.invoke("voice-entry", {
            body: { audioBase64, mimeType },
          });
          if (error) {
            // supabase-js's FunctionsHttpError.message is a generic
            // "non-2xx status code" string — the function's own { error }
            // message lives in the response body via `.context`.
            let message = error.message ?? "Something went wrong";
            const ctx = (error as { context?: Response }).context;
            if (ctx && typeof ctx.json === "function") {
              try {
                const body = await ctx.clone().json();
                if (body?.error) message = body.error;
              } catch {
                // ignore — fall back to error.message
              }
            }
            throw new Error(message);
          }
          const result = data as {
            transcript: string;
            items: { product: string; quantity: number; expiry: string | null; action: "restock" | "sale"; unit_price: number | null }[];
          };
          setTranscript(result.transcript);
          setItems(
            result.items.map((it) => ({
              product: it.product,
              quantity: it.quantity,
              expiry: it.expiry,
              action: it.action,
              unitPrice: it.unit_price,
            })),
          );
          setStatus("review");
        } catch (e) {
          setStatus("error");
          setErrorMsg(e instanceof Error ? e.message : "Something went wrong");
        }
      };
      recorderRef.current = rec;
      rec.start();
      setStatus("recording");
    } catch {
      setStatus("error");
      setErrorMsg("Microphone permission is required.");
    }
  };

  const stopRecording = () => {
    recorderRef.current?.stop();
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-ink/40 backdrop-blur-sm grid place-items-center p-4"
      onClick={onClose}
    >
      <div className="w-full max-w-lg card-warm p-6 relative" onClick={(e) => e.stopPropagation()}>
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute right-3 top-3 h-8 w-8 grid place-items-center rounded-full hover:bg-muted"
        >
          <X size={16} />
        </button>
        <h2 className="font-display text-2xl text-ink">Voice entry</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Say what you added to stock, or what you sold — product, quantity, and price if it's a sale.
        </p>

        <div className="mt-6 flex flex-col items-center gap-4">
          {status === "idle" && (
            <button
              onClick={startRecording}
              className="h-24 w-24 rounded-full bg-primary text-primary-foreground grid place-items-center hover:scale-105 transition"
            >
              <Mic size={36} />
            </button>
          )}
          {status === "recording" && (
            <>
              <button
                onClick={stopRecording}
                className="pulse-mic h-24 w-24 rounded-full bg-destructive text-white grid place-items-center"
              >
                <Mic size={36} />
              </button>
              <p className="text-sm text-muted-foreground">Recording… tap to stop</p>
            </>
          )}
          {status === "processing" && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-8">
              <Loader2 size={18} className="animate-spin" />
              Transcribing and parsing…
            </div>
          )}
          {status === "error" && (
            <>
              <p className="text-sm text-destructive text-center">{errorMsg}</p>
              <button
                onClick={() => setStatus("idle")}
                className="rounded-full border border-border bg-card px-4 py-2 text-sm hover:bg-muted"
              >
                Try again
              </button>
            </>
          )}
        </div>

        {status === "review" && (
          <div className="mt-6 space-y-4">
            <div>
              <div className="text-xs uppercase tracking-wider text-muted-foreground">Heard</div>
              <p className="mt-1 text-sm text-ink italic">"{transcript || "—"}"</p>
            </div>
            {items.length === 0 ? (
              <p className="text-sm text-muted-foreground">Couldn't detect any products.</p>
            ) : (
              <div className="space-y-3">
                {items.map((it, i) => (
                  <div key={i} className="rounded-lg border border-border p-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <input
                        value={it.product}
                        onChange={(e) =>
                          setItems((prev) =>
                            prev.map((p, idx) => (idx === i ? { ...p, product: e.target.value } : p)),
                          )
                        }
                        className="flex-1 min-w-0 rounded-lg border border-border bg-card px-3 py-2 text-sm"
                        placeholder="Product"
                      />
                      <div className="inline-flex items-center rounded-full bg-muted p-0.5 text-xs shrink-0">
                        <button
                          type="button"
                          onClick={() =>
                            setItems((prev) => prev.map((p, idx) => (idx === i ? { ...p, action: "restock" } : p)))
                          }
                          className={`px-2.5 py-1 rounded-full transition ${
                            it.action === "restock" ? "bg-card shadow-sm text-ink" : "text-muted-foreground"
                          }`}
                        >
                          Restock
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setItems((prev) => prev.map((p, idx) => (idx === i ? { ...p, action: "sale" } : p)))
                          }
                          className={`px-2.5 py-1 rounded-full transition ${
                            it.action === "sale" ? "bg-card shadow-sm text-ink" : "text-muted-foreground"
                          }`}
                        >
                          Sale
                        </button>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        type="number"
                        value={it.quantity}
                        onChange={(e) =>
                          setItems((prev) =>
                            prev.map((p, idx) =>
                              idx === i ? { ...p, quantity: Number(e.target.value) || 0 } : p,
                            ),
                          )
                        }
                        className="rounded-lg border border-border bg-card px-3 py-2 text-sm tabular-nums"
                        placeholder="Qty"
                      />
                      {it.action === "sale" ? (
                        <input
                          type="number"
                          value={it.unitPrice ?? ""}
                          onChange={(e) =>
                            setItems((prev) =>
                              prev.map((p, idx) =>
                                idx === i ? { ...p, unitPrice: e.target.value === "" ? null : Number(e.target.value) } : p,
                              ),
                            )
                          }
                          className="rounded-lg border border-border bg-card px-3 py-2 text-sm tabular-nums"
                          placeholder="Price/unit (optional)"
                        />
                      ) : (
                        <input
                          type="date"
                          value={it.expiry ?? ""}
                          onChange={(e) =>
                            setItems((prev) =>
                              prev.map((p, idx) =>
                                idx === i ? { ...p, expiry: e.target.value || null } : p,
                              ),
                            )
                          }
                          className="rounded-lg border border-border bg-card px-3 py-2 text-sm"
                        />
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => {
                  setItems([]);
                  setTranscript("");
                  setStatus("idle");
                }}
                className="rounded-full border border-border bg-card px-4 py-2 text-sm hover:bg-muted"
              >
                Record again
              </button>
              <button
                disabled={items.length === 0}
                onClick={() => onSave(items)}
                className="inline-flex items-center gap-1.5 rounded-full bg-primary text-primary-foreground px-4 py-2 text-sm disabled:opacity-40"
              >
                <Check size={14} />
                Save
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
