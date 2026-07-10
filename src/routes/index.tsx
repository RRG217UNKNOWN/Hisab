import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { transcribeAndParseEntry, type ParsedItem } from "@/lib/voice-entry.functions";
import { X, Loader2, Check } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import {
  Mic,
  AlertTriangle,
  Clock,
  TrendingUp,
  TrendingDown,
  Search,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { useT } from "@/lib/i18n";

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
  const [entries, setEntries] = useState<ParsedItem[]>([]);

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

  const greeting = name ? `${t("dash.goodMorning")}, ${name}` : t("dash.goodMorning");

  return (
    <AppShell active="dashboard" title="Hisab">
      <header className="hidden md:flex items-center gap-3 border-b border-border px-6 md:px-10 py-4">
        <div className="relative flex-1 max-w-md">
          <Search
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <input
            placeholder={t("common.search")}
            className="w-full rounded-lg border border-border bg-card pl-9 pr-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/40"
          />
        </div>
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
                    <th className="py-2 font-medium text-right">Qty</th>
                    <th className="py-2 font-medium text-right">Expiry</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {entries.map((e, i) => (
                    <tr key={i}>
                      <td className="py-3 text-ink">{e.product}</td>
                      <td className="py-3 text-right tabular-nums">{e.quantity}</td>
                      <td className="py-3 text-right text-muted-foreground">{e.expiry ?? "—"}</td>
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

        <footer className="pt-4 pb-8 text-center text-xs text-muted-foreground">
          Hisab · made for kirana, general store & small retail
        </footer>
      </div>

      {voiceOpen && (
        <VoiceEntryModal
          onClose={() => setVoiceOpen(false)}
          onSave={(items) => {
            setEntries((prev) => [...items, ...prev]);
            setVoiceOpen(false);
          }}
        />
      )}
    </AppShell>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="font-display text-xl text-ink">{children}</h2>;
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
  const transcribe = useServerFn(transcribeAndParseEntry);
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
          const result = await transcribe({ data: { audioBase64, mimeType } });
          setTranscript(result.transcript);
          setItems(result.items);
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
          Say the product, quantity and expiry.
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
              <div className="space-y-2">
                {items.map((it, i) => (
                  <div key={i} className="grid grid-cols-[1fr_80px_120px] gap-2">
                    <input
                      value={it.product}
                      onChange={(e) =>
                        setItems((prev) =>
                          prev.map((p, idx) => (idx === i ? { ...p, product: e.target.value } : p)),
                        )
                      }
                      className="rounded-lg border border-border bg-card px-3 py-2 text-sm"
                    />
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
                    />
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
