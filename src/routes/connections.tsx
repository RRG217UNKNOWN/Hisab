import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { Network, Plus, Check, X } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/hooks/use-auth";
import { useProfile } from "@/hooks/use-profile";
import { supabase } from "@/integrations/supabase/client";
import { can } from "@/lib/permissions";

export const Route = createFileRoute("/connections")({
  component: ConnectionsPage,
  head: () => ({ meta: [{ title: "Connections · Hisab" }] }),
});

type Conn = { id: string; org_id: string; partner_org_id: string; status: "pending" | "connected"; org_name?: string; partner_name?: string };

function ConnectionsPage() {
  const { user } = useAuth();
  const { profile } = useProfile();
  const canManage = can.manageConnections(profile?.role);
  const [conns, setConns] = useState<Conn[]>([]);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (supabase as any).from("partner_orgs").select("id, org_id, partner_org_id, status");
    const rows = (data as Conn[] | null) ?? [];
    // Fetch org names
    const ids = Array.from(new Set(rows.flatMap((r) => [r.org_id, r.partner_org_id])));
    let names: Record<string, string> = {};
    if (ids.length) {
      const { data: orgs } = await supabase.from("organizations").select("id, name").in("id", ids);
      names = Object.fromEntries((orgs ?? []).map((o) => [o.id, o.name]));
    }
    setConns(rows.map((r) => ({ ...r, org_name: names[r.org_id], partner_name: names[r.partner_org_id] })));
  }, [user]);

  useEffect(() => {
    void load();
  }, [load]);

  const connect = async () => {
    if (!code.trim() || !profile?.org_id) return;
    setBusy(true);
    setErr(null);
    setMsg(null);
    const { data, error } = await supabase.rpc("verify_org_code", { _code: code.trim() });
    const target = (data as { id: string; name: string }[] | null)?.[0];
    if (error || !target) {
      setBusy(false);
      setErr(error?.message ?? "Invalid code");
      return;
    }
    if (target.id === profile.org_id) {
      setBusy(false);
      setErr("Cannot connect to your own organization");
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: ie } = await (supabase as any).from("partner_orgs").insert({
      org_id: profile.org_id,
      partner_org_id: target.id,
      added_by: user?.id,
      status: "pending",
    });
    setBusy(false);
    if (ie) setErr(ie.message);
    else {
      setMsg(`Request sent to ${target.name}`);
      setCode("");
      void load();
    }
  };

  const accept = async (c: Conn) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any).from("partner_orgs").update({ status: "connected" }).eq("id", c.id);
    if (error) alert(error.message);
    else void load();
  };
  const remove = async (c: Conn) => {
    if (!confirm("Remove this connection?")) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any).from("partner_orgs").delete().eq("id", c.id);
    if (error) alert(error.message);
    else void load();
  };

  const myOrg = profile?.org_id;
  const outgoing = conns.filter((c) => c.org_id === myOrg);
  const incoming = conns.filter((c) => c.partner_org_id === myOrg && c.status === "pending");
  const connected = conns.filter((c) => c.status === "connected");

  return (
    <AppShell active="account" title="Connections">
      <div className="px-4 md:px-10 py-6 md:py-8 max-w-3xl space-y-6">
        <header>
          <p className="text-xs uppercase tracking-widest text-muted-foreground">
            <Network size={12} className="inline mr-1" /> partner organisations
          </p>
          <h1 className="mt-1 font-display text-3xl md:text-4xl text-ink">Connections</h1>
        </header>

        {canManage && (
          <div className="card-warm p-5 space-y-3">
            <label className="block">
              <span className="block text-xs uppercase tracking-wider text-muted-foreground mb-1">Partner org code</span>
              <div className="flex gap-2">
                <input
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  className="flex-1 rounded-lg border border-border bg-card px-3 py-2 text-sm font-mono tracking-widest"
                  placeholder="XXXXXXXXXX"
                />
                <button
                  onClick={connect}
                  disabled={busy}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-primary text-primary-foreground px-4 py-2 text-sm"
                >
                  <Plus size={14} /> Connect
                </button>
              </div>
            </label>
            {err && <div className="text-sm text-destructive">{err}</div>}
            {msg && <div className="text-sm text-success">{msg}</div>}
          </div>
        )}

        <Section title={`Connected (${connected.length})`}>
          {connected.map((c) => (
            <ConnRow
              key={c.id}
              name={c.org_id === myOrg ? c.partner_name : c.org_name}
              status="connected"
              onRemove={canManage ? () => remove(c) : undefined}
            />
          ))}
          {connected.length === 0 && <Empty>No connections yet.</Empty>}
        </Section>

        <Section title={`Incoming requests (${incoming.length})`}>
          {incoming.map((c) => (
            <ConnRow
              key={c.id}
              name={c.org_name}
              status="pending"
              onAccept={canManage ? () => accept(c) : undefined}
              onRemove={canManage ? () => remove(c) : undefined}
            />
          ))}
          {incoming.length === 0 && <Empty>None.</Empty>}
        </Section>

        <Section title={`Sent, waiting (${outgoing.filter((c) => c.status === "pending").length})`}>
          {outgoing.filter((c) => c.status === "pending").map((c) => (
            <ConnRow
              key={c.id}
              name={c.partner_name}
              status="pending"
              onRemove={canManage ? () => remove(c) : undefined}
            />
          ))}
          {outgoing.filter((c) => c.status === "pending").length === 0 && <Empty>None.</Empty>}
        </Section>
      </div>
    </AppShell>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="card-warm p-5">
      <h2 className="font-display text-lg text-ink mb-3">{title}</h2>
      <div className="space-y-2">{children}</div>
    </section>
  );
}
function Empty({ children }: { children: React.ReactNode }) {
  return <div className="text-sm text-muted-foreground py-2">{children}</div>;
}
function ConnRow({
  name,
  status,
  onAccept,
  onRemove,
}: {
  name?: string;
  status: "pending" | "connected";
  onAccept?: () => void;
  onRemove?: () => void;
}) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-border p-3">
      <div>
        <div className="text-sm text-ink">{name ?? "—"}</div>
        <div className={`text-xs ${status === "connected" ? "text-success" : "text-warning"}`}>{status}</div>
      </div>
      <div className="flex gap-1">
        {onAccept && (
          <button onClick={onAccept} className="h-8 w-8 grid place-items-center rounded hover:bg-muted text-success" aria-label="Accept">
            <Check size={14} />
          </button>
        )}
        {onRemove && (
          <button onClick={onRemove} className="h-8 w-8 grid place-items-center rounded hover:bg-muted text-destructive" aria-label="Remove">
            <X size={14} />
          </button>
        )}
      </div>
    </div>
  );
}
