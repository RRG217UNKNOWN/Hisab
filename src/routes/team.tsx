import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { z } from "zod";
import { UserPlus, Users, X, Trash2, Loader2 } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { useProfile, type Role } from "@/hooks/use-profile";
import { can, ROLE_LABELS, ROLE_DESCRIPTIONS } from "@/lib/permissions";

export const Route = createFileRoute("/team")({
  component: TeamPage,
  head: () => ({
    meta: [
      { title: "Team · Hisab" },
      { name: "description", content: "Invite teammates and manage roles for your organization." },
    ],
  }),
});

type Sb = {
  from: (t: string) => {
    select: (s: string) => {
      order: (c: string, o?: unknown) => Promise<{ data: unknown[] | null; error: { message: string } | null }>;
    };
    insert: (row: unknown) => Promise<{ error: { message: string } | null }>;
    update: (row: unknown) => { eq: (c: string, v: string) => Promise<{ error: { message: string } | null }> };
    delete: () => { eq: (c: string, v: string) => Promise<{ error: { message: string } | null }> };
  };
};
const sb = supabase as unknown as Sb;

type Member = { id: string; full_name: string | null; phone: string | null; role: Role };
type Invite = { id: string; email: string; role: Role; status: string; created_at: string };

const inviteSchema = z.object({
  email: z.string().trim().email("Enter a valid email").max(255),
  role: z.enum(["owner", "manager", "staff", "accountant"]),
});

function TeamPage() {
  const { user, loading: authLoading } = useAuth();
  const { profile, loading: profileLoading, reload: reloadProfile } = useProfile();
  const navigate = useNavigate();

  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [showInvite, setShowInvite] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!profile?.org_id) return;
    setLoading(true);
    setError(null);
    const [m, i] = await Promise.all([
      supabase
        .from("profiles")
        .select("id, full_name, phone, role")
        .eq("org_id", profile.org_id)
        .order("created_at", { ascending: true }),
      sb.from("invites").select("id, email, role, status, created_at").order("created_at", { ascending: false }),
    ]);
    if (m.error) setError(m.error.message);
    if (i.error) setError(i.error.message);
    setMembers((m.data as Member[] | null) ?? []);
    setInvites((i.data as Invite[] | null) ?? []);
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
      <AppShell active="team" title="Team">
        <div className="p-10 text-muted-foreground">
          <Loader2 size={16} className="animate-spin" />
        </div>
      </AppShell>
    );
  }

  const isCreator = profile?.org?.created_by === profile?.id;
  const orgId = profile?.org_id;

  return (
    <AppShell active="team" title="Team">
      <div className="px-4 md:px-10 py-6 md:py-8 max-w-3xl space-y-6">
        <header className="flex items-end justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-widest text-muted-foreground">
              टीम · organization members
            </p>
            <h1 className="mt-1 font-display text-3xl md:text-4xl text-ink">Team</h1>
          </div>
          {can.manageTeam(profile?.role) && orgId && (
            <button
              onClick={() => setShowInvite(true)}
              className="inline-flex items-center gap-1.5 rounded-full bg-primary text-primary-foreground px-4 py-2 text-sm"
            >
              <UserPlus size={14} /> Invite teammate
            </button>
          )}
        </header>

        {!orgId && (
          <div className="card-warm p-6 text-sm text-muted-foreground">
            You aren't part of an organization yet. Create or join one from your account settings to invite teammates.
          </div>
        )}

        {error && (
          <div className="rounded-lg bg-destructive/10 text-destructive text-sm px-3 py-2">{error}</div>
        )}

        {orgId && (
          <>
            <section className="card-warm p-4 md:p-6">
              <div className="flex items-center gap-2 mb-3 text-sm text-ink">
                <Users size={16} className="text-primary" />
                <span className="font-medium">Members ({members.length})</span>
              </div>
              <div className="divide-y divide-border">
                {members.length === 0 && (
                  <div className="py-6 text-sm text-muted-foreground text-center">
                    {loading ? "Loading…" : "No members yet."}
                  </div>
                )}
                {members.map((m) => (
                  <MemberRow
                    key={m.id}
                    member={m}
                    isSelf={m.id === profile?.id}
                    canEdit={
                      can.manageTeam(profile?.role) &&
                      m.id !== profile?.org?.created_by
                    }
                    isOrgCreator={m.id === profile?.org?.created_by}
                    onChanged={load}
                  />
                ))}
              </div>
              {isCreator && (
                <p className="mt-4 text-[11px] text-muted-foreground">
                  You created this organization. Your role can only be changed by you.
                </p>
              )}
            </section>

            <section className="card-warm p-4 md:p-6">
              <div className="text-sm font-medium text-ink mb-3">Invites</div>
              <div className="divide-y divide-border">
                {invites.length === 0 && (
                  <div className="py-6 text-sm text-muted-foreground text-center">
                    No invites sent yet.
                  </div>
                )}
                {invites.map((inv) => (
                  <div key={inv.id} className="py-3 flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm text-ink truncate">{inv.email}</div>
                      <div className="text-xs text-muted-foreground">
                        {ROLE_LABELS[inv.role]} · {new Date(inv.created_at).toLocaleDateString()}
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
                    {can.manageTeam(profile?.role) && inv.status === "pending" && (
                      <button
                        onClick={async () => {
                          if (!confirm("Revoke this invite?")) return;
                          const { error } = await sb.from("invites").delete().eq("id", inv.id);
                          if (error) alert(error.message);
                          else void load();
                        }}
                        className="h-7 w-7 grid place-items-center rounded hover:bg-muted text-destructive"
                        aria-label="Revoke"
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
          onClose={() => setShowInvite(false)}
          onSent={() => {
            setShowInvite(false);
            void load();
            void reloadProfile();
          }}
        />
      )}
    </AppShell>
  );
}

function MemberRow({
  member,
  isSelf,
  canEdit,
  isOrgCreator,
  onChanged,
}: {
  member: Member;
  isSelf: boolean;
  canEdit: boolean;
  isOrgCreator: boolean;
  onChanged: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const updateRole = async (role: Role) => {
    setSaving(true);
    const { error } = await supabase
      .from("profiles")
      .update({ role })
      .eq("id", member.id);
    if (error) alert(error.message);
    else onChanged();
    setSaving(false);
  };

  return (
    <div className="py-3 flex items-center gap-3">
      <div className="min-w-0 flex-1">
        <div className="text-sm text-ink truncate">
          {member.full_name || "Unnamed"}
          {isSelf && <span className="ml-2 text-xs text-muted-foreground">(you)</span>}
          {isOrgCreator && <span className="ml-2 text-xs text-primary">· creator</span>}
        </div>
        {member.phone && (
          <div className="text-xs text-muted-foreground truncate">{member.phone}</div>
        )}
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
        <span className="text-xs rounded-full bg-muted px-2.5 py-1 text-ink">
          {ROLE_LABELS[member.role]}
        </span>
      )}
    </div>
  );
}

function InviteDialog({
  orgId,
  inviterId,
  onClose,
  onSent,
}: {
  orgId: string;
  inviterId: string;
  onClose: () => void;
  onSent: () => void;
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("staff");
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
    const sbInsert = supabase as unknown as {
      from: (t: string) => {
        insert: (row: unknown) => Promise<{ error: { message: string } | null }>;
      };
    };
    const { error } = await sbInsert.from("invites").insert({
      email: parsed.data.email,
      role: parsed.data.role,
      org_id: orgId,
      invited_by: inviterId,
    });
    if (error) setErr(error.message);
    else onSent();
    setBusy(false);
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/40 backdrop-blur-sm px-4">
      <div className="w-full max-w-md rounded-xl bg-card p-5 shadow-xl">
        <div className="flex items-center justify-between mb-4">
          <div className="font-display text-lg text-ink">Invite teammate</div>
          <button onClick={onClose} aria-label="Close" className="h-8 w-8 grid place-items-center rounded hover:bg-muted">
            <X size={16} />
          </button>
        </div>
        <div className="space-y-3">
          <label className="block">
            <span className="block text-xs text-muted-foreground mb-1">Email</span>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              placeholder="teammate@shop.in"
              className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/40"
            />
          </label>
          <label className="block">
            <span className="block text-xs text-muted-foreground mb-1">Role</span>
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
          <p className="text-xs text-muted-foreground">
            When they sign up with this email, they'll automatically join your organization with this role.
          </p>
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
              {busy ? "Sending…" : "Send invite"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
