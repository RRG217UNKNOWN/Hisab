import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity as ActivityIcon, Loader2 } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { useProfile } from "@/hooks/use-profile";
import { can } from "@/lib/permissions";

export const Route = createFileRoute("/activity")({
  component: ActivityPage,
  head: () => ({
    meta: [
      { title: "Activity · Hisab" },
      { name: "description", content: "Audit log of every change across your organization." },
    ],
  }),
});

type LogRow = {
  id: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  changes: Record<string, unknown> | null;
  created_at: string;
  user_id: string | null;
};

type Sb = {
  from: (t: string) => {
    select: (s: string) => {
      order: (c: string, o?: unknown) => {
        limit: (n: number) => Promise<{ data: unknown[] | null; error: { message: string } | null }>;
      };
    };
  };
};
const sb = supabase as unknown as Sb;

const ACTIONS = [
  ["all", "All actions"],
  ["inventory_items.created", "Item created"],
  ["inventory_items.updated", "Item updated"],
  ["inventory_items.deleted", "Item deleted"],
  ["sales.created", "Sale recorded"],
  ["stock_adjustments.created", "Stock adjusted"],
  ["expenses.created", "Expense added"],
] as const;

function ActivityPage() {
  const { user, loading: authLoading } = useAuth();
  const { profile, loading: profileLoading } = useProfile();
  const navigate = useNavigate();
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [users, setUsers] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [actionFilter, setActionFilter] = useState<string>("all");
  const [userFilter, setUserFilter] = useState<string>("all");

  useEffect(() => {
    if (!authLoading && !user) navigate({ to: "/auth" });
  }, [authLoading, user, navigate]);

  const load = useCallback(async () => {
    if (!profile) return;
    if (!can.viewActivity(profile.role)) return;
    setLoading(true);
    const { data } = await sb
      .from("activity_log")
      .select("id, action, entity_type, entity_id, changes, created_at, user_id")
      .order("created_at", { ascending: false })
      .limit(500);
    const rows = (data as LogRow[] | null) ?? [];
    setLogs(rows);

    // Fetch member names in org
    if (profile.org_id) {
      const { data: members } = await supabase
        .from("profiles")
        .select("id, full_name")
        .eq("org_id", profile.org_id);
      const map: Record<string, string> = {};
      for (const m of (members as { id: string; full_name: string | null }[] | null) ?? []) {
        map[m.id] = m.full_name || "Unnamed";
      }
      setUsers(map);
    }
    setLoading(false);
  }, [profile]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    return logs.filter((l) => {
      if (actionFilter !== "all" && l.action !== actionFilter) return false;
      if (userFilter !== "all" && l.user_id !== userFilter) return false;
      return true;
    });
  }, [logs, actionFilter, userFilter]);

  if (profileLoading) {
    return (
      <AppShell active="activity" title="Activity">
        <div className="p-10 text-muted-foreground">
          <Loader2 size={16} className="animate-spin" />
        </div>
      </AppShell>
    );
  }

  if (!can.viewActivity(profile?.role)) {
    return (
      <AppShell active="activity" title="Activity">
        <div className="p-10 text-sm text-muted-foreground">
          You don't have access to the activity log.
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell active="activity" title="Activity">
      <div className="px-4 md:px-10 py-6 md:py-8 max-w-3xl space-y-6">
        <header>
          <p className="text-xs uppercase tracking-widest text-muted-foreground">
            गतिविधि · audit trail
          </p>
          <h1 className="mt-1 font-display text-3xl md:text-4xl text-ink">Activity</h1>
        </header>

        <div className="flex flex-wrap gap-3">
          <select
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
            className="rounded-lg border border-border bg-card px-3 py-2 text-sm"
          >
            {ACTIONS.map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
          <select
            value={userFilter}
            onChange={(e) => setUserFilter(e.target.value)}
            className="rounded-lg border border-border bg-card px-3 py-2 text-sm"
          >
            <option value="all">All users</option>
            {Object.entries(users).map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </div>

        <section className="card-warm p-4 md:p-6">
          <div className="flex items-center gap-2 mb-3 text-sm text-ink">
            <ActivityIcon size={16} className="text-primary" />
            <span className="font-medium">Recent activity ({filtered.length})</span>
          </div>
          <div className="divide-y divide-border">
            {filtered.length === 0 && (
              <div className="py-8 text-sm text-muted-foreground text-center">
                {loading ? "Loading…" : "No activity yet."}
              </div>
            )}
            {filtered.map((log) => (
              <LogEntry key={log.id} log={log} userName={users[log.user_id ?? ""] || "Someone"} />
            ))}
          </div>
        </section>
      </div>
    </AppShell>
  );
}

function LogEntry({ log, userName }: { log: LogRow; userName: string }) {
  const summary = summarize(log);
  const time = new Date(log.created_at);
  return (
    <div className="py-3">
      <div className="text-sm text-ink">
        <span className="font-medium">{userName}</span> {summary}
      </div>
      <div className="text-xs text-muted-foreground mt-0.5">
        {time.toLocaleString("en-IN")}
      </div>
    </div>
  );
}

function summarize(log: LogRow): string {
  const action = log.action;
  const changes = log.changes ?? {};
  const isUpdate = action.endsWith(".updated");
  const isCreate = action.endsWith(".created");
  const isDelete = action.endsWith(".deleted");

  if (action.startsWith("inventory_items")) {
    if (isCreate) return `added item "${getField(changes, "name")}"`;
    if (isDelete) return `deleted item "${getField(changes, "name")}"`;
    if (isUpdate) {
      const diff = describeDiff(changes as { old?: Record<string, unknown>; new?: Record<string, unknown> });
      return `updated item "${getField((changes as { new?: Record<string, unknown> }).new ?? {}, "name")}"${diff ? ` — ${diff}` : ""}`;
    }
  }
  if (action.startsWith("sales")) {
    if (isCreate) return `recorded a sale of ${getField(changes, "quantity")} × ${getField(changes, "item_name")}`;
  }
  if (action.startsWith("stock_adjustments")) {
    if (isCreate) return `adjusted stock (${getField(changes, "reason")}) to ${getField(changes, "new_stock")}`;
  }
  if (action.startsWith("expenses")) {
    if (isCreate) return `added expense "${getField(changes, "label")}" — ₹${getField(changes, "amount")}`;
    if (isDelete) return `deleted expense "${getField(changes, "label")}"`;
  }
  return action;
}

function getField(obj: Record<string, unknown>, key: string): string {
  const v = obj[key];
  return v == null ? "?" : String(v);
}

function describeDiff(changes: { old?: Record<string, unknown>; new?: Record<string, unknown> }): string {
  const oldR = changes.old ?? {};
  const newR = changes.new ?? {};
  const notable = ["stock", "price", "cost_price", "min_stock", "expiry", "name"];
  const parts: string[] = [];
  for (const k of notable) {
    if (oldR[k] !== newR[k]) {
      parts.push(`${k}: ${String(oldR[k])} → ${String(newR[k])}`);
    }
  }
  return parts.slice(0, 2).join(", ");
}
