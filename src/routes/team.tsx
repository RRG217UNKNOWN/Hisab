import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { z } from "zod";
import { UserPlus, Users, X, Trash2, Loader2, Shield, Store, ChevronDown, Plus } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { useProfile, type Role, TAB_KEYS, type TabKey } from "@/hooks/use-profile";
import { can, ROLE_LABELS, ROLE_DESCRIPTIONS } from "@/lib/permissions";
import { useT } from "@/lib/i18n";

export const Route = createFileRoute("/team")({
  component: TeamPage,
  head: () => ({
    meta: [
      { title: "Team · Hisab" },
      { name: "description", content: "Invite teammates and manage roles for your organization." },
    ],
  }),
});

// Loose escape-hatch for tables not worth fighting the generated generics
// for here (same convention used elsewhere — parties.tsx, requests.tsx…).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sb = { from: (t: string) => any; rpc: (fn: string, args?: unknown) => Promise<{ data: unknown; error: { message: string } | null }> };
const sb = supabase as unknown as Sb;

type Warehouse = { id: string; name: string };
type Member = { id: string; full_name: string | null; phone: string | null; role: Role; role_group_id: string | null };
type Invite = { id: string; email: string; role: Role; status: string; created_at: string; warehouse_ids: string[] };
type RoleGroupRow = { id: string; name: string; base_role: Role };
type RoleGroupPerm = { role_group_id: string; tab_key: TabKey; can_view: boolean };

const inviteSchema = z.object({
  email: z.string().trim().email("Enter a valid email").max(255),
  role: z.enum(["owner", "manager", "staff", "accountant"]),
});

// nav.* already has a translated label for every one of the 15 tab keys
// (dashboard/createBill/inventory/expenses/reports/parties/vendors/team/
// activity/connections/requests/import/export/settings/account) — reuse
// those instead of inventing a parallel set of labels.
const TAB_I18N_KEY: Record<TabKey, string> = {
  dashboard: "nav.dashboard",
  create_bill: "nav.createBill",
  inventory: "nav.inventory",
  expenses: "nav.expenses",
  reports: "nav.reports",
  parties: "nav.parties",
  vendors: "nav.vendors",
  team: "nav.team",
  activity: "nav.activity",
  connections: "nav.connections",
  requests: "nav.requests",
  import: "nav.import",
  export: "nav.export",
  settings: "nav.settings",
  account: "nav.account",
};

function TeamPage() {
  const { user, loading: authLoading } = useAuth();
  const { profile, loading: profileLoading, reload: reloadProfile } = useProfile();
  const navigate = useNavigate();
  const { t } = useT();

  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [memberShops, setMemberShops] = useState<Map<string, Set<string>>>(new Map());
  const [roleGroups, setRoleGroups] = useState<RoleGroupRow[]>([]);
  const [showInvite, setShowInvite] = useState(false);
  const [showManageRoles, setShowManageRoles] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!profile?.org_id) return;
    setLoading(true);
    setError(null);
    const [m, i, wh, ms, rg] = await Promise.all([
      supabase
        .from("profiles")
        .select("id, full_name, phone, role, role_group_id")
        .eq("org_id", profile.org_id)
        .order("created_at", { ascending: true }),
      sb.from("invites").select("id, email, role, status, created_at, warehouse_ids").order("created_at", { ascending: false }),
      supabase.from("warehouses").select("id, name").order("created_at"),
      sb.from("member_shops").select("profile_id, warehouse_id"),
      sb.from("role_groups").select("id, name, base_role").order("name"),
    ]);
    if (m.error) setError(m.error.message);
    if (i.error) setError(i.error.message);
    setMembers((m.data as Member[] | null) ?? []);
    setInvites((i.data as Invite[] | null) ?? []);
    setWarehouses((wh.data as Warehouse[] | null) ?? []);
    const map = new Map<string, Set<string>>();
    for (const row of (ms.data as { profile_id: string; warehouse_id: string }[] | null) ?? []) {
      const cur = map.get(row.profile_id) ?? new Set<string>();
      cur.add(row.warehouse_id);
      map.set(row.profile_id, cur);
    }
    setMemberShops(map);
    setRoleGroups((rg.data as RoleGroupRow[] | null) ?? []);
    setLoading(false);
  }, [profile?.org_id]);

  useEffect(() => {
    if (!authLoading && !user) navigate({ to: "/auth" });
  }, [authLoading, user, navigate]);

  useEffect(() => {
    void load();
  }, [load]);

  if (profileLoading) {
    return (
      <AppShell active="team" title={t("team.title")}>
        <div className="p-10 text-muted-foreground">
          <Loader2 size={16} className="animate-spin" />
        </div>
      </AppShell>
    );
  }

  const isCreator = profile?.org?.created_by === profile?.id;
  const orgId = profile?.org_id;
  const isOwner = can.manageTeam(profile?.role);

  return (
    <AppShell active="team" title={t("team.title")}>
      <div className="px-4 md:px-10 py-6 md:py-8 max-w-3xl space-y-6">
        <header className="flex items-end justify-between gap-4 flex-wrap">
          <div>
            <h1 className="mt-1 font-display text-3xl md:text-4xl text-ink">{t("team.title")}</h1>
          </div>
          {isOwner && orgId && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowManageRoles(true)}
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-4 py-2 text-sm hover:bg-muted"
              >
                <Shield size={14} /> {t("team.manageRoles")}
              </button>
              <button
                onClick={() => setShowInvite(true)}
                className="inline-flex items-center gap-1.5 rounded-full bg-primary text-primary-foreground px-4 py-2 text-sm"
              >
                <UserPlus size={14} /> {t("team.inviteTeammate")}
              </button>
            </div>
          )}
        </header>

        {!orgId && (
          <div className="card-warm p-6 text-sm text-muted-foreground">{t("team.notInOrg")}</div>
        )}

        {error && (
          <div className="rounded-lg bg-destructive/10 text-destructive text-sm px-3 py-2">{error}</div>
        )}

        {orgId && (
          <>
            <section className="card-warm p-4 md:p-6">
              <div className="flex items-center gap-2 mb-3 text-sm text-ink">
                <Users size={16} className="text-primary" />
                <span className="font-medium">
                  {t("team.members")} ({members.length})
                </span>
              </div>
              <div className="divide-y divide-border">
                {members.length === 0 && (
                  <div className="py-6 text-sm text-muted-foreground text-center">
                    {loading ? t("common.loading") : t("team.noMembersYet")}
                  </div>
                )}
                {members.map((m) => (
                  <MemberRow
                    key={m.id}
                    member={m}
                    isSelf={m.id === profile?.id}
                    canEdit={isOwner && m.id !== profile?.org?.created_by}
                    isOrgCreator={m.id === profile?.org?.created_by}
                    warehouses={warehouses}
                    roleGroups={roleGroups}
                    currentShops={memberShops.get(m.id) ?? new Set()}
                    onChanged={load}
                    t={t}
                  />
                ))}
              </div>
              {isCreator && <p className="mt-4 text-[11px] text-muted-foreground">{t("team.creatorNote")}</p>}
            </section>

            <section className="card-warm p-4 md:p-6">
              <div className="text-sm font-medium text-ink mb-3">{t("team.invites")}</div>
              <div className="divide-y divide-border">
                {invites.length === 0 && (
                  <div className="py-6 text-sm text-muted-foreground text-center">{t("team.noInvitesYet")}</div>
                )}
                {invites.map((inv) => (
                  <div key={inv.id} className="py-3 flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm text-ink truncate">{inv.email}</div>
                      <div className="text-xs text-muted-foreground">
                        {ROLE_LABELS[inv.role]} · {new Date(inv.created_at).toLocaleDateString()}
                        {" · "}
                        {inv.warehouse_ids?.length ? `${inv.warehouse_ids.length} ${t("team.shopsLabel").toLowerCase()}` : t("team.allShops")}
                      </div>
                    </div>
                    <span
                      className={`text-xs rounded-full px-2 py-0.5 ${
                        inv.status === "pending"
                          ? "bg-warning/15 text-warning"
                          : inv.status === "accepted"
                          ? "bg-success/15 text-success"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {inv.status}
                    </span>
                    {isOwner && inv.status === "pending" && (
                      <button
                        onClick={async () => {
                          if (!confirm(t("team.confirmRevoke"))) return;
                          const { error } = await sb.from("invites").delete().eq("id", inv.id);
                          if (error) alert(error.message);
                          else void load();
                        }}
                        className="h-7 w-7 grid place-items-center rounded hover:bg-muted text-destructive"
                        aria-label={t("team.revoke")}
                      >
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </section>
          </>
        )}
      </div>

      {showInvite && orgId && (
        <InviteDialog
          orgId={orgId}
          inviterId={profile?.id ?? ""}
          warehouses={warehouses}
          onClose={() => setShowInvite(false)}
          onSent={() => {
            setShowInvite(false);
            void load();
            void reloadProfile();
          }}
        />
      )}

      {showManageRoles && orgId && (
        <ManageRolesDialog
          orgId={orgId}
          roleGroups={roleGroups}
          members={members}
          onClose={() => setShowManageRoles(false)}
          onChanged={load}
        />
      )}
    </AppShell>
  );
}

// ---------------------------------------------------------------------------
// Shared "All shops / Specific shops" control (invite + existing member)
// ---------------------------------------------------------------------------
function ShopScopeEditor({
  warehouses,
  selected,
  onChange,
  t,
}: {
  warehouses: Warehouse[];
  selected: Set<string> | null; // null = all shops
  onChange: (s: Set<string> | null) => void;
  t: (k: string) => string;
}) {
  const isAll = selected === null;
  return (
    <div>
      <div className="flex items-center gap-1 rounded-full bg-muted p-0.5 text-xs w-fit">
        <button
          type="button"
          onClick={() => onChange(null)}
          className={`px-3 py-1.5 rounded-full transition ${isAll ? "bg-card shadow-sm text-ink" : "text-muted-foreground hover:text-foreground"}`}
        >
          {t("team.allShops")}
        </button>
        <button
          type="button"
          onClick={() => onChange(new Set())}
          className={`px-3 py-1.5 rounded-full transition ${!isAll ? "bg-card shadow-sm text-ink" : "text-muted-foreground hover:text-foreground"}`}
        >
          {t("team.specificShops")}
        </button>
      </div>
      {!isAll && (
        <div className="mt-2 grid grid-cols-2 gap-1.5 max-h-32 overflow-y-auto">
          {warehouses.map((w) => {
            const checked = selected!.has(w.id);
            return (
              <label key={w.id} className="flex items-center gap-1.5 text-xs text-ink">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(e) => {
                    const next = new Set(selected);
                    if (e.target.checked) next.add(w.id);
                    else next.delete(w.id);
                    onChange(next);
                  }}
                />
                {w.name}
              </label>
            );
          })}
          {warehouses.length === 0 && <span className="text-xs text-muted-foreground">—</span>}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Member row — role selector (Part 1, now policy-fixed), role-group
// selector, and per-shop scope editor (Part 2).
// ---------------------------------------------------------------------------
function MemberRow({
  member,
  isSelf,
  canEdit,
  isOrgCreator,
  warehouses,
  roleGroups,
  currentShops,
  onChanged,
  t,
}: {
  member: Member;
  isSelf: boolean;
  canEdit: boolean;
  isOrgCreator: boolean;
  warehouses: Warehouse[];
  roleGroups: RoleGroupRow[];
  currentShops: Set<string>;
  onChanged: () => void;
  t: (k: string) => string;
}) {
  const [saving, setSaving] = useState(false);
  const [shopsOpen, setShopsOpen] = useState(false);
  const [scope, setScope] = useState<Set<string> | null>(currentShops.size ? new Set(currentShops) : new Set());

  useEffect(() => {
    setScope(currentShops.size ? new Set(currentShops) : new Set());
  }, [currentShops]);

  const updateRole = async (role: Role) => {
    setSaving(true);
    const { error } = await supabase.from("profiles").update({ role }).eq("id", member.id);
    if (error) alert(error.message);
    else onChanged();
    setSaving(false);
  };

  const updateGroup = async (roleGroupId: string) => {
    setSaving(true);
    const { error } = await supabase
      .from("profiles")
      .update({ role_group_id: roleGroupId || null })
      .eq("id", member.id);
    if (error) alert(error.message);
    else onChanged();
    setSaving(false);
  };

  const saveShops = async () => {
    setSaving(true);
    const toAdd = scope ? [...scope].filter((id) => !currentShops.has(id)) : [];
    const toRemove = scope ? [...currentShops].filter((id) => !scope.has(id)) : [...currentShops];
    if (toAdd.length) {
      const { error } = await sb.from("member_shops").insert(toAdd.map((warehouse_id) => ({ profile_id: member.id, warehouse_id })));
      if (error) {
        alert(error.message);
        setSaving(false);
        return;
      }
    }
    for (const warehouse_id of toRemove) {
      const { error } = await sb.from("member_shops").delete().eq("profile_id", member.id).eq("warehouse_id", warehouse_id);
      if (error) {
        alert(error.message);
        setSaving(false);
        return;
      }
    }
    setSaving(false);
    setShopsOpen(false);
    onChanged();
  };

  return (
    <div className="py-3 space-y-2">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-sm text-ink truncate">
            {member.full_name || "Unnamed"}
            {isSelf && <span className="ml-2 text-xs text-muted-foreground">({t("team.you")})</span>}
            {isOrgCreator && <span className="ml-2 text-xs text-primary">· {t("team.creator")}</span>}
          </div>
          {member.phone && <div className="text-xs text-muted-foreground truncate">{member.phone}</div>}
        </div>
        {canEdit ? (
          <select
            value={member.role}
            disabled={saving}
            onChange={(e) => void updateRole(e.target.value as Role)}
            className="rounded-lg border border-border bg-card px-2 py-1 text-xs"
          >
            {(["owner", "manager", "staff", "accountant"] as Role[]).map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </select>
        ) : (
          <span className="text-xs rounded-full bg-muted px-2.5 py-1 text-ink">{ROLE_LABELS[member.role]}</span>
        )}
        {canEdit && (
          <button
            onClick={() => setShopsOpen((v) => !v)}
            className="inline-flex items-center gap-1 rounded-lg border border-border bg-card px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <Store size={12} /> {t("team.shopsLabel")} <ChevronDown size={11} className={shopsOpen ? "rotate-180 transition" : "transition"} />
          </button>
        )}
      </div>

      {canEdit && (
        <div className="pl-0">
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <Shield size={12} />
            {t("team.group")}
            <select
              value={member.role_group_id ?? ""}
              disabled={saving}
              onChange={(e) => void updateGroup(e.target.value)}
              className="rounded-lg border border-border bg-card px-2 py-1 text-xs text-ink"
            >
              <option value="">{t("team.noGroup")}</option>
              {roleGroups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      {canEdit && shopsOpen && (
        <div className="rounded-lg border border-border p-3 bg-muted/30 space-y-2">
          <ShopScopeEditor warehouses={warehouses} selected={scope} onChange={setScope} t={t} />
          <button
            onClick={saveShops}
            disabled={saving}
            className="rounded-lg bg-primary text-primary-foreground px-3 py-1.5 text-xs disabled:opacity-60"
          >
            {saving ? t("party.saving") : t("party.saveChanges")}
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Invite dialog — now with per-shop scoping (Part 2)
// ---------------------------------------------------------------------------
function InviteDialog({
  orgId,
  inviterId,
  warehouses,
  onClose,
  onSent,
}: {
  orgId: string;
  inviterId: string;
  warehouses: Warehouse[];
  onClose: () => void;
  onSent: () => void;
}) {
  const { t } = useT();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("staff");
  const [scope, setScope] = useState<Set<string> | null>(null); // null = all shops
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    setErr(null);
    const parsed = inviteSchema.safeParse({ email, role });
    if (!parsed.success) {
      setErr(parsed.error.issues[0]?.message ?? "Invalid input");
      return;
    }
    setBusy(true);
    const { error } = await sb.from("invites").insert({
      email: parsed.data.email,
      role: parsed.data.role,
      org_id: orgId,
      invited_by: inviterId,
      warehouse_ids: scope ? [...scope] : [],
    });
    if (error) setErr(error.message);
    else onSent();
    setBusy(false);
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/40 backdrop-blur-sm px-4">
      <div className="w-full max-w-md rounded-xl bg-card p-5 shadow-xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <div className="font-display text-lg text-ink">{t("team.inviteTeammateTitle")}</div>
          <button onClick={onClose} aria-label={t("common.close")} className="h-8 w-8 grid place-items-center rounded hover:bg-muted">
            <X size={16} />
          </button>
        </div>
        <div className="space-y-3">
          <label className="block">
            <span className="block text-xs text-muted-foreground mb-1">{t("auth.email")}</span>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              placeholder="teammate@shop.in"
              className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/40"
            />
          </label>
          <label className="block">
            <span className="block text-xs text-muted-foreground mb-1">{t("team.roleLabel")}</span>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as Role)}
              className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/40"
            >
              {(["owner", "manager", "staff", "accountant"] as Role[]).map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]} — {ROLE_DESCRIPTIONS[r]}
                </option>
              ))}
            </select>
          </label>
          <div>
            <span className="block text-xs text-muted-foreground mb-1">{t("team.shopsLabel")}</span>
            <ShopScopeEditor warehouses={warehouses} selected={scope} onChange={setScope} t={t} />
          </div>
          <p className="text-xs text-muted-foreground">{t("team.inviteHint")}</p>
          {err && <div className="text-sm text-destructive">{err}</div>}
          <div className="flex justify-end gap-2 pt-2">
            <button onClick={onClose} className="rounded-lg border border-border bg-card px-4 py-2 text-sm">
              {t("common.cancel")}
            </button>
            <button
              onClick={submit}
              disabled={busy}
              className="rounded-lg bg-primary text-primary-foreground px-4 py-2 text-sm disabled:opacity-60"
            >
              {busy ? t("team.sending") : t("team.sendInvite")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Manage roles — list/create/edit/delete role groups (Part 3)
// ---------------------------------------------------------------------------
function ManageRolesDialog({
  orgId,
  roleGroups,
  members,
  onClose,
  onChanged,
}: {
  orgId: string;
  roleGroups: RoleGroupRow[];
  members: Member[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const { t } = useT();
  const [editing, setEditing] = useState<RoleGroupRow | "new" | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const membersInGroup = useCallback((groupId: string) => members.filter((m) => m.role_group_id === groupId).length, [members]);

  const deleteGroup = async (g: RoleGroupRow) => {
    if (membersInGroup(g.id) > 0) {
      alert(`${t("team.reassignFirst")}`);
      return;
    }
    if (!confirm(t("team.confirmDeleteGroup"))) return;
    const { error } = await sb.from("role_groups").delete().eq("id", g.id);
    if (error) setErr(error.message);
    else onChanged();
  };

  if (editing) {
    return (
      <RoleGroupEditor
        orgId={orgId}
        group={editing === "new" ? null : editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          onChanged();
        }}
      />
    );
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/40 backdrop-blur-sm px-4">
      <div className="w-full max-w-lg rounded-xl bg-card p-5 shadow-xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <div className="font-display text-lg text-ink">{t("team.roleGroups")}</div>
          <button onClick={onClose} aria-label={t("common.close")} className="h-8 w-8 grid place-items-center rounded hover:bg-muted">
            <X size={16} />
          </button>
        </div>

        {err && <div className="mb-3 text-sm text-destructive bg-destructive/10 rounded-lg px-3 py-2">{err}</div>}

        <div className="space-y-2">
          {roleGroups.map((g) => (
            <div key={g.id} className="flex items-center justify-between rounded-lg border border-border p-3">
              <div>
                <div className="text-sm text-ink">{g.name}</div>
                <div className="text-xs text-muted-foreground">
                  {ROLE_LABELS[g.base_role]} · {membersInGroup(g.id)} member(s)
                </div>
              </div>
              <div className="flex gap-1">
                <button onClick={() => setEditing(g)} className="rounded-lg border border-border bg-card px-3 py-1.5 text-xs hover:bg-muted">
                  {t("common.edit")}
                </button>
                <button
                  onClick={() => deleteGroup(g)}
                  className="h-8 w-8 grid place-items-center rounded hover:bg-muted text-destructive"
                  aria-label={t("team.deleteGroup")}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
          {roleGroups.length === 0 && <p className="text-sm text-muted-foreground py-4 text-center">{t("team.noGroupsYet")}</p>}
        </div>

        <button
          onClick={() => setEditing("new")}
          className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-primary text-primary-foreground px-4 py-2 text-sm"
        >
          <Plus size={14} /> {t("team.newGroup")}
        </button>
      </div>
    </div>
  );
}

function RoleGroupEditor({
  orgId,
  group,
  onClose,
  onSaved,
}: {
  orgId: string;
  group: RoleGroupRow | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useT();
  const [name, setName] = useState(group?.name ?? "");
  const [baseRole, setBaseRole] = useState<Role>(group?.base_role ?? "staff");
  const [tabs, setTabs] = useState<Set<TabKey>>(new Set());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!group) return;
    (async () => {
      const { data } = await sb.from("role_group_permissions").select("tab_key, can_view").eq("role_group_id", group.id);
      const set = new Set<TabKey>();
      for (const row of (data as RoleGroupPerm[] | null) ?? []) {
        if (row.can_view) set.add(row.tab_key);
      }
      setTabs(set);
    })();
  }, [group]);

  const toggleTab = (k: TabKey) => {
    setTabs((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  };

  const save = async () => {
    setErr(null);
    if (!name.trim()) {
      setErr(t("team.groupNameRequired"));
      return;
    }
    setBusy(true);
    let groupId = group?.id ?? null;
    if (groupId) {
      const { error } = await sb.from("role_groups").update({ name: name.trim(), base_role: baseRole }).eq("id", groupId);
      if (error) {
        setErr(error.message);
        setBusy(false);
        return;
      }
    } else {
      const ins = await sb.from("role_groups").insert({ org_id: orgId, name: name.trim(), base_role: baseRole }).select("id").single();
      if (ins.error) {
        setErr(ins.error.message);
        setBusy(false);
        return;
      }
      groupId = (ins.data as { id: string }).id;
    }

    // Simplest correct approach: replace all permission rows for this group.
    const del = await sb.from("role_group_permissions").delete().eq("role_group_id", groupId);
    if (del.error) {
      setErr(del.error.message);
      setBusy(false);
      return;
    }
    const rows = TAB_KEYS.map((k) => ({ role_group_id: groupId, tab_key: k, can_view: tabs.has(k) }));
    const ins2 = await sb.from("role_group_permissions").insert(rows);
    setBusy(false);
    if (ins2.error) setErr(ins2.error.message);
    else onSaved();
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/40 backdrop-blur-sm px-4">
      <div className="w-full max-w-lg rounded-xl bg-card p-5 shadow-xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <div className="font-display text-lg text-ink">{group ? t("team.saveGroup") : t("team.newGroup")}</div>
          <button onClick={onClose} aria-label={t("common.close")} className="h-8 w-8 grid place-items-center rounded hover:bg-muted">
            <X size={16} />
          </button>
        </div>

        <div className="space-y-3">
          <label className="block">
            <span className="block text-xs text-muted-foreground mb-1">{t("team.groupName")}</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Cashier"
              className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/40"
            />
          </label>
          <label className="block">
            <span className="block text-xs text-muted-foreground mb-1">{t("team.baseRole")}</span>
            <select
              value={baseRole}
              onChange={(e) => setBaseRole(e.target.value as Role)}
              className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/40"
            >
              {(["owner", "manager", "staff", "accountant"] as Role[]).map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </select>
            <p className="mt-1 text-[11px] text-muted-foreground">{t("team.baseRoleHint")}</p>
          </label>
          <div>
            <span className="block text-xs text-muted-foreground mb-2">{t("team.tabsVisible")}</span>
            <div className="grid grid-cols-2 gap-1.5">
              {TAB_KEYS.map((k) => (
                <label key={k} className="flex items-center gap-1.5 text-sm text-ink">
                  <input type="checkbox" checked={tabs.has(k)} onChange={() => toggleTab(k)} />
                  {t(TAB_I18N_KEY[k])}
                </label>
              ))}
            </div>
          </div>

          {err && <div className="text-sm text-destructive">{err}</div>}
          <div className="flex justify-end gap-2 pt-2">
            <button onClick={onClose} className="rounded-lg border border-border bg-card px-4 py-2 text-sm">
              {t("common.cancel")}
            </button>
            <button
              onClick={save}
              disabled={busy}
              className="rounded-lg bg-primary text-primary-foreground px-4 py-2 text-sm disabled:opacity-60"
            >
              {busy ? t("party.saving") : t("team.saveGroup")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
