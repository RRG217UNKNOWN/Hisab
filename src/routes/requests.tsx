import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, Trash2, Check, X, Store, IndianRupee, Link2 } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/hooks/use-auth";
import { useProfile } from "@/hooks/use-profile";
import { supabase } from "@/integrations/supabase/client";
import { can } from "@/lib/permissions";

export const Route = createFileRoute("/requests")({
  component: RequestsPage,
  head: () => ({ meta: [{ title: "Requests · Hisab" }] }),
});

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type ReqItem = { name: string; quantity: number; target_price: number };
type ReqStatus = "pending" | "accepted" | "declined" | "fulfilled";
type ReqRow = {
  id: string;
  from_org_id: string;
  to_org_id: string;
  items: ReqItem[];
  status: ReqStatus;
  narration: string | null;
  fulfilling_warehouse_id: string | null;
  order_completed_at: string | null;
  bill_id: string | null;
  payment_received: number;
  payment_status: "unpaid" | "partial" | "paid";
  created_at: string;
};
type Warehouse = { id: string; name: string };
type Connection = { partnerOrgId: string; partnerOrgName: string };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sb = { from: (t: string) => any };
const sb = supabase as unknown as Sb;

function RequestsPage() {
  const { user } = useAuth();
  const { profile } = useProfile();
  const navigate = useNavigate();
  const myOrg = profile?.org_id ?? null;
  const role = profile?.role;
  const canSend = can.manageRequests(role);

  const [side, setSide] = useState<"sent" | "received">("received");
  const [statusTab, setStatusTab] = useState<"pending" | "accepted" | "declined">("pending");
  const [showSendForm, setShowSendForm] = useState(false);

  const [requests, setRequests] = useState<ReqRow[]>([]);
  const [orgNames, setOrgNames] = useState<Record<string, string>>({});
  const [connections, setConnections] = useState<Connection[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [memberShopIds, setMemberShopIds] = useState<Set<string>>(new Set());
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user || !myOrg) return;
    const [req, po, wh, ms] = await Promise.all([
      sb.from("requests").select("*").order("created_at", { ascending: false }),
      sb.from("partner_orgs").select("org_id, partner_org_id, status"),
      supabase.from("warehouses").select("id, name").order("created_at"),
      sb.from("member_shops").select("warehouse_id").eq("profile_id", user.id),
    ]);
    if (req.error) setErr(req.error.message);
    const rows = ((req.data as ReqRow[] | null) ?? []).map((r) => ({ ...r, items: r.items ?? [] }));
    setRequests(rows);
    setWarehouses((wh.data as Warehouse[] | null) ?? []);
    setMemberShopIds(new Set(((ms.data as { warehouse_id: string }[] | null) ?? []).map((r) => r.warehouse_id)));

    const connected = ((po.data as { org_id: string; partner_org_id: string; status: string }[] | null) ?? []).filter(
      (c) => c.status === "connected" && (c.org_id === myOrg || c.partner_org_id === myOrg),
    );
    const partnerIds = connected.map((c) => (c.org_id === myOrg ? c.partner_org_id : c.org_id));
    const orgIds = Array.from(new Set([...partnerIds, ...rows.flatMap((r) => [r.from_org_id, r.to_org_id])]));
    let names: Record<string, string> = {};
    if (orgIds.length) {
      const { data: orgs } = await supabase.from("organizations").select("id, name").in("id", orgIds);
      names = Object.fromEntries((orgs ?? []).map((o) => [o.id, o.name]));
    }
    setOrgNames(names);
    setConnections(partnerIds.map((id) => ({ partnerOrgId: id, partnerOrgName: names[id] ?? "—" })));
  }, [user, myOrg]);

  useEffect(() => {
    void load();
  }, [load]);

  const counterpartName = useCallback(
    (r: ReqRow) => orgNames[r.from_org_id === myOrg ? r.to_org_id : r.from_org_id] ?? "—",
    [orgNames, myOrg],
  );

  const canMarkCompleted = useCallback(
    (r: ReqRow) => {
      if (role === "owner") return true;
      if (role !== "manager" || !r.fulfilling_warehouse_id) return false;
      return memberShopIds.size === 0 || memberShopIds.has(r.fulfilling_warehouse_id);
    },
    [role, memberShopIds],
  );

  const sent = useMemo(() => requests.filter((r) => r.from_org_id === myOrg), [requests, myOrg]);
  const received = useMemo(() => requests.filter((r) => r.to_org_id === myOrg), [requests, myOrg]);
  const writableWarehouses = useMemo(
    () => (role === "owner" || memberShopIds.size === 0 ? warehouses : warehouses.filter((w) => memberShopIds.has(w.id))),
    [warehouses, memberShopIds, role],
  );
  const list = side === "sent" ? sent : received;
  const filtered = useMemo(() => {
    if (statusTab === "accepted") return list.filter((r) => r.status === "accepted" || r.status === "fulfilled");
    return list.filter((r) => r.status === statusTab);
  }, [list, statusTab]);

  const counts = {
    pending: list.filter((r) => r.status === "pending").length,
    accepted: list.filter((r) => r.status === "accepted" || r.status === "fulfilled").length,
    declined: list.filter((r) => r.status === "declined").length,
  };

  if (!can.manageConnections(role) && !can.fulfillRequests(role)) {
    return (
      <AppShell active="requests" title="Requests">
        <div className="px-4 md:px-10 py-10 text-sm text-muted-foreground">You don't have permission to view requests.</div>
      </AppShell>
    );
  }

  return (
    <AppShell active="requests" title="Requests">
      <div className="px-4 md:px-10 py-6 md:py-8 max-w-3xl space-y-6">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-widest text-muted-foreground">cross-org purchase requests</p>
            <h1 className="mt-1 font-display text-3xl md:text-4xl text-ink">Requests</h1>
          </div>
          {canSend && side === "sent" && (
            <button
              onClick={() => setShowSendForm(true)}
              className="inline-flex items-center gap-1.5 rounded-full bg-primary text-primary-foreground px-4 py-2 text-sm"
            >
              <Plus size={14} /> New request
            </button>
          )}
        </header>

        {err && <div className="rounded-lg bg-destructive/10 text-destructive text-sm px-3 py-2">{err}</div>}
        {!myOrg && (
          <div className="card-warm p-6 text-sm text-muted-foreground">
            Requests work between organisations — join or create an org first (see Account).
          </div>
        )}

        {myOrg && (
          <>
            <div className="inline-flex items-center gap-1 rounded-full border border-border bg-card p-0.5 text-sm">
              <button
                onClick={() => setSide("received")}
                className={`px-4 py-1.5 rounded-full transition ${side === "received" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
              >
                Received
              </button>
              <button
                onClick={() => setSide("sent")}
                className={`px-4 py-1.5 rounded-full transition ${side === "sent" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
              >
                Sent
              </button>
            </div>

            <div className="flex items-center gap-1 rounded-full bg-muted p-0.5 text-xs w-fit">
              {(["pending", "accepted", "declined"] as const).map((k) => (
                <button
                  key={k}
                  onClick={() => setStatusTab(k)}
                  className={`px-3 py-1.5 rounded-full capitalize transition ${
                    statusTab === k ? "bg-card shadow-sm text-ink" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {k} ({counts[k]})
                </button>
              ))}
            </div>

            <div className="space-y-3">
              {filtered.map((r) =>
                side === "received" ? (
                  <ReceivedCard
                    key={r.id}
                    r={r}
                    counterpartName={counterpartName(r)}
                    warehouses={warehouses}
                    writableWarehouses={writableWarehouses}
                    canRespond={can.manageRequests(role)}
                    canMarkCompleted={canMarkCompleted(r)}
                    onChanged={load}
                    onFulfil={() => navigate({ to: "/create-bill", search: { fulfillRequestId: r.id } })}
                  />
                ) : (
                  <SentCard key={r.id} r={r} counterpartName={counterpartName(r)} />
                ),
              )}
              {filtered.length === 0 && <div className="card-warm p-8 text-center text-sm text-muted-foreground">Nothing here yet.</div>}
            </div>
          </>
        )}
      </div>

      {showSendForm && user && myOrg && (
        <SendRequestForm
          userId={user.id}
          myOrgId={myOrg}
          connections={connections}
          onClose={() => setShowSendForm(false)}
          onSent={() => {
            setShowSendForm(false);
            void load();
          }}
          onConnectionsChanged={load}
        />
      )}

      <style>{`.input { width: 100%; border-radius: 0.5rem; border: 1px solid hsl(var(--border)); background: hsl(var(--card)); padding: 0.5rem 0.75rem; font-size: 0.875rem; outline: none; }
        .input:focus { box-shadow: 0 0 0 2px hsl(var(--ring) / 0.4); }`}</style>
    </AppShell>
  );
}

// ---------------------------------------------------------------------------
// Send form
// ---------------------------------------------------------------------------
function SendRequestForm({
  userId,
  myOrgId,
  connections,
  onClose,
  onSent,
  onConnectionsChanged,
}: {
  userId: string;
  myOrgId: string;
  connections: Connection[];
  onClose: () => void;
  onSent: () => void;
  onConnectionsChanged: () => void;
}) {
  const [partnerOrgId, setPartnerOrgId] = useState(connections[0]?.partnerOrgId ?? "");
  const [items, setItems] = useState<ReqItem[]>([{ name: "", quantity: 1, target_price: 0 }]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [showConnect, setShowConnect] = useState(false);

  useEffect(() => {
    if (!partnerOrgId && connections.length > 0) setPartnerOrgId(connections[0].partnerOrgId);
  }, [connections, partnerOrgId]);

  const updateItem = (i: number, patch: Partial<ReqItem>) =>
    setItems((its) => its.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  const addItem = () => setItems((its) => [...its, { name: "", quantity: 1, target_price: 0 }]);
  const removeItem = (i: number) => setItems((its) => its.filter((_, idx) => idx !== i));

  const submit = async () => {
    setErr(null);
    if (!partnerOrgId) return setErr("Pick a connected partner org first.");
    const cleanItems = items.filter((it) => it.name.trim()).map((it) => ({ ...it, quantity: Number(it.quantity) || 1, target_price: Number(it.target_price) || 0 }));
    if (cleanItems.length === 0) return setErr("Add at least one item.");
    setBusy(true);
    const ins = await sb.from("requests").insert({
      from_org_id: myOrgId,
      to_org_id: partnerOrgId,
      created_by: userId,
      items: cleanItems,
      status: "pending",
    });
    setBusy(false);
    if (ins.error) setErr(ins.error.message);
    else onSent();
  };

  return (
    <div className="fixed inset-0 z-50 bg-ink/40 backdrop-blur-sm grid place-items-center p-4" onClick={onClose}>
      <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto card-warm p-5 md:p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="font-display text-xl text-ink">New request</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X size={18} />
          </button>
        </div>

        <label className="block">
          <span className="block text-xs uppercase tracking-wider text-muted-foreground mb-1">Send to</span>
          {connections.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No connected orgs yet.{" "}
              <button onClick={() => setShowConnect(true)} className="text-primary underline">
                Connect one
              </button>
              .
            </p>
          ) : (
            <select value={partnerOrgId} onChange={(e) => setPartnerOrgId(e.target.value)} className="input">
              {connections.map((c) => (
                <option key={c.partnerOrgId} value={c.partnerOrgId}>
                  {c.partnerOrgName}
                </option>
              ))}
            </select>
          )}
          {connections.length > 0 && (
            <button onClick={() => setShowConnect(true)} className="mt-1 text-xs text-primary inline-flex items-center gap-1">
              <Link2 size={11} /> Add a new connection
            </button>
          )}
        </label>

        <div className="space-y-2">
          <span className="block text-xs uppercase tracking-wider text-muted-foreground">Items</span>
          {items.map((it, i) => (
            <div key={i} className="grid grid-cols-[1fr_70px_90px_28px] gap-2 items-end">
              <MiniField label="Name" value={it.name} onChange={(v) => updateItem(i, { name: v })} />
              <MiniField label="Qty" value={String(it.quantity)} onChange={(v) => updateItem(i, { quantity: Number(v) || 0 })} type="number" />
              <MiniField label="Target ₹" value={String(it.target_price)} onChange={(v) => updateItem(i, { target_price: Number(v) || 0 })} type="number" />
              <button onClick={() => removeItem(i)} className="h-9 grid place-items-center text-muted-foreground hover:text-destructive">
                <Trash2 size={14} />
              </button>
            </div>
          ))}
          <button onClick={addItem} className="text-xs text-primary inline-flex items-center gap-1">
            <Plus size={12} /> Add item
          </button>
        </div>

        {err && <div className="rounded-lg bg-destructive/10 text-destructive text-sm px-3 py-2">{err}</div>}

        <button
          onClick={submit}
          disabled={busy || connections.length === 0}
          className="w-full rounded-lg bg-primary text-primary-foreground px-4 py-2.5 text-sm font-medium disabled:opacity-60"
        >
          {busy ? "Sending…" : "Send request"}
        </button>
      </div>

      {showConnect && (
        <QuickConnect
          myOrgId={myOrgId}
          userId={userId}
          onClose={() => setShowConnect(false)}
          onConnected={() => {
            setShowConnect(false);
            onConnectionsChanged();
          }}
        />
      )}
    </div>
  );
}

function QuickConnect({
  myOrgId,
  userId,
  onClose,
  onConnected,
}: {
  myOrgId: string;
  userId: string;
  onClose: () => void;
  onConnected: () => void;
}) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const connect = async () => {
    if (!code.trim()) return;
    setBusy(true);
    setErr(null);
    const { data, error } = await supabase.rpc("verify_org_code", { _code: code.trim() });
    const target = (data as { id: string; name: string }[] | null)?.[0];
    if (error || !target) {
      setBusy(false);
      setErr(error?.message ?? "Invalid code");
      return;
    }
    if (target.id === myOrgId) {
      setBusy(false);
      setErr("That's your own org code.");
      return;
    }
    const ins = await sb.from("partner_orgs").insert({ org_id: myOrgId, partner_org_id: target.id, added_by: userId, status: "pending" });
    setBusy(false);
    if (ins.error) setErr(ins.error.message);
    else onConnected();
  };

  return (
    <div className="fixed inset-0 z-[60] bg-ink/40 backdrop-blur-sm grid place-items-center p-4" onClick={onClose}>
      <div className="w-full max-w-sm card-warm p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-display text-lg text-ink">Connect a partner org</h3>
        <p className="text-xs text-muted-foreground">
          This sends a connection request — the other org's owner needs to accept it in Connections before you can
          send them requests.
        </p>
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="Org code"
          className="input font-mono tracking-widest"
        />
        {err && <div className="text-sm text-destructive">{err}</div>}
        <div className="flex gap-2">
          <button onClick={connect} disabled={busy} className="flex-1 rounded-lg bg-primary text-primary-foreground px-4 py-2 text-sm disabled:opacity-60">
            {busy ? "Sending…" : "Send request"}
          </button>
          <button onClick={onClose} className="rounded-lg border border-border bg-card px-4 py-2 text-sm">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function MiniField({ label, value, onChange, type = "text" }: { label: string; value: string; onChange: (v: string) => void; type?: string }) {
  return (
    <label className="block">
      <span className="block text-[10px] text-muted-foreground mb-0.5">{label}</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} type={type} className="input text-sm" />
    </label>
  );
}

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------
function StatusBadge({ status }: { status: ReqStatus }) {
  const map: Record<ReqStatus, string> = {
    pending: "bg-warning/15 text-warning",
    accepted: "bg-primary/15 text-ink",
    declined: "bg-destructive/15 text-destructive",
    fulfilled: "bg-success/15 text-success",
  };
  return <span className={`text-[10px] px-2 py-0.5 rounded-full capitalize ${map[status]}`}>{status}</span>;
}

function ItemSummary({ items }: { items: ReqItem[] }) {
  return (
    <ul className="mt-1 space-y-0.5">
      {items.map((it, i) => (
        <li key={i} className="text-xs text-muted-foreground">
          {it.name} × {it.quantity}
          {it.target_price ? ` @ ₹${it.target_price}` : ""}
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Received request card
// ---------------------------------------------------------------------------
function ReceivedCard({
  r,
  counterpartName,
  warehouses,
  writableWarehouses,
  canRespond,
  canMarkCompleted,
  onChanged,
  onFulfil,
}: {
  r: ReqRow;
  counterpartName: string;
  warehouses: Warehouse[];
  writableWarehouses: Warehouse[];
  canRespond: boolean;
  canMarkCompleted: boolean;
  onChanged: () => void;
  onFulfil: () => void;
}) {
  const [responding, setResponding] = useState<"accept" | "decline" | null>(null);
  const [warehouseId, setWarehouseId] = useState(writableWarehouses[0]?.id ?? "");
  const [narration, setNarration] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [showPayment, setShowPayment] = useState(false);

  const respond = async (status: "accepted" | "declined") => {
    if (status === "accepted" && !warehouseId) return setErr("Pick a shop to fulfil this from.");
    setBusy(true);
    setErr(null);
    const upd = await sb
      .from("requests")
      .update({
        status,
        narration: narration.trim() || null,
        fulfilling_warehouse_id: status === "accepted" ? warehouseId : null,
      })
      .eq("id", r.id);
    setBusy(false);
    if (upd.error) setErr(upd.error.message);
    else {
      setResponding(null);
      onChanged();
    }
  };

  const markCompleted = async () => {
    setBusy(true);
    setErr(null);
    const upd = await sb.from("requests").update({ order_completed_at: new Date().toISOString() }).eq("id", r.id);
    setBusy(false);
    if (upd.error) setErr(upd.error.message);
    else onFulfil();
  };

  const shopName = warehouses.find((w) => w.id === r.fulfilling_warehouse_id)?.name;

  return (
    <div className="card-warm p-4 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-sm text-ink font-medium">{counterpartName}</div>
          <ItemSummary items={r.items} />
        </div>
        <StatusBadge status={r.status} />
      </div>
      {r.narration && <p className="text-xs text-muted-foreground italic">"{r.narration}"</p>}
      {shopName && <p className="text-xs text-muted-foreground inline-flex items-center gap-1"><Store size={11} /> {shopName}</p>}
      {err && <div className="text-xs text-destructive">{err}</div>}

      {r.status === "pending" && canRespond && !responding && (
        <div className="flex gap-2 pt-1">
          <button onClick={() => setResponding("accept")} className="inline-flex items-center gap-1 rounded-full bg-primary text-primary-foreground px-3 py-1.5 text-xs">
            <Check size={12} /> Accept
          </button>
          <button onClick={() => setResponding("decline")} className="inline-flex items-center gap-1 rounded-full border border-border px-3 py-1.5 text-xs text-muted-foreground">
            <X size={12} /> Decline
          </button>
        </div>
      )}

      {responding && (
        <div className="space-y-2 pt-1 border-t border-border mt-2">
          {responding === "accept" && (
            <label className="block">
              <span className="block text-[11px] text-muted-foreground mb-0.5">Fulfil from shop</span>
              <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} className="input text-sm">
                {writableWarehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="block">
            <span className="block text-[11px] text-muted-foreground mb-0.5">Note (optional)</span>
            <input value={narration} onChange={(e) => setNarration(e.target.value)} className="input text-sm" />
          </label>
          <div className="flex gap-2">
            <button
              onClick={() => respond(responding === "accept" ? "accepted" : "declined")}
              disabled={busy}
              className="rounded-lg bg-primary text-primary-foreground px-3 py-1.5 text-xs disabled:opacity-60"
            >
              {busy ? "Saving…" : `Confirm ${responding === "accept" ? "accept" : "decline"}`}
            </button>
            <button onClick={() => setResponding(null)} className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground">
              Cancel
            </button>
          </div>
        </div>
      )}

      {r.status === "accepted" && !r.order_completed_at && canMarkCompleted && (
        <button onClick={markCompleted} disabled={busy} className="mt-1 rounded-full bg-primary text-primary-foreground px-3 py-1.5 text-xs disabled:opacity-60">
          {busy ? "Marking…" : "Mark order completed"}
        </button>
      )}
      {r.status === "accepted" && r.order_completed_at && !r.bill_id && (
        <p className="text-xs text-muted-foreground">Marked completed — waiting on the bill to be finished.</p>
      )}
      {r.status === "fulfilled" && (
        <div className="flex items-center gap-3 pt-1">
          <span className="text-xs text-muted-foreground capitalize">Payment: {r.payment_status}</span>
          {r.payment_status !== "paid" && canRespond && (
            <button onClick={() => setShowPayment(true)} className="inline-flex items-center gap-1 text-xs text-primary">
              <IndianRupee size={11} /> Record payment
            </button>
          )}
        </div>
      )}

      {showPayment && <RecordPaymentModal r={r} onClose={() => setShowPayment(false)} onSaved={() => { setShowPayment(false); onChanged(); }} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sent request card
// ---------------------------------------------------------------------------
function SentCard({ r, counterpartName }: { r: ReqRow; counterpartName: string }) {
  return (
    <div className="card-warm p-4 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-sm text-ink font-medium">{counterpartName}</div>
          <ItemSummary items={r.items} />
        </div>
        <StatusBadge status={r.status} />
      </div>
      {r.narration && <p className="text-xs text-muted-foreground italic">"{r.narration}"</p>}
      {r.status === "accepted" && !r.bill_id && <p className="text-xs text-muted-foreground">Pending goods — accepted, not yet fulfilled.</p>}
      {r.status === "fulfilled" && <p className="text-xs text-muted-foreground capitalize">Fulfilled · payment {r.payment_status}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Record payment — routes through party_payments against the bill's party,
// so cross-org money lands in the same ledger as any other party (Section 2).
// ---------------------------------------------------------------------------
function RecordPaymentModal({ r, onClose, onSaved }: { r: ReqRow; onClose: () => void; onSaved: () => void }) {
  const { user } = useAuth();
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [billTotal, setBillTotal] = useState<number | null>(null);
  const [partyId, setPartyId] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      if (!r.bill_id) return;
      const bill = await sb.from("bills").select("total, party_id").eq("id", r.bill_id).single();
      if (bill.data) {
        setBillTotal(Number((bill.data as { total: number }).total));
        setPartyId((bill.data as { party_id: string | null }).party_id);
      }
    })();
  }, [r.bill_id]);

  const submit = async () => {
    setErr(null);
    const amt = Number(amount);
    if (!amt || amt <= 0) return setErr("Enter a valid amount.");
    if (!partyId) return setErr("This bill has no linked party to record payment against.");
    if (!user) return;
    setBusy(true);
    const pay = await sb.from("party_payments").insert({
      user_id: user.id,
      party_id: partyId,
      amount: amt,
      direction: "receivable",
      note: note.trim() || `Payment for request`,
    });
    if (pay.error) {
      setBusy(false);
      return setErr(pay.error.message);
    }
    const newReceived = r.payment_received + amt;
    const newStatus = billTotal !== null && newReceived >= billTotal ? "paid" : "partial";
    const upd = await sb.from("requests").update({ payment_received: newReceived, payment_status: newStatus }).eq("id", r.id);
    setBusy(false);
    if (upd.error) setErr(upd.error.message);
    else onSaved();
  };

  return (
    <div className="fixed inset-0 z-50 bg-ink/40 backdrop-blur-sm grid place-items-center p-4" onClick={onClose}>
      <div className="w-full max-w-sm card-warm p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-display text-lg text-ink">Record payment</h3>
        {billTotal !== null && (
          <p className="text-xs text-muted-foreground">
            Bill total ₹{billTotal.toLocaleString("en-IN")} · received so far ₹{r.payment_received.toLocaleString("en-IN")}
          </p>
        )}
        <MiniField label="Amount (₹)" value={amount} onChange={setAmount} type="number" />
        <MiniField label="Note (optional)" value={note} onChange={setNote} />
        {err && <div className="text-sm text-destructive">{err}</div>}
        <div className="flex gap-2">
          <button onClick={submit} disabled={busy} className="flex-1 rounded-lg bg-primary text-primary-foreground px-4 py-2 text-sm disabled:opacity-60">
            {busy ? "Saving…" : "Save payment"}
          </button>
          <button onClick={onClose} className="rounded-lg border border-border bg-card px-4 py-2 text-sm">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
