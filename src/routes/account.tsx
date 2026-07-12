import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { LogOut, User as UserIcon, Copy, Check, Building2, Receipt } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { useProfile, type Profile } from "@/hooks/use-profile";
import { ROLE_LABELS } from "@/lib/permissions";

export const Route = createFileRoute("/account")({
  component: AccountPage,
  head: () => ({
    meta: [
      { title: "Account · Hisab" },
      { name: "description", content: "Manage your Hisab shop profile." },
    ],
  }),
});

function AccountPage() {
  const { user } = useAuth();

  return (
    <AppShell active="account" title="Account">
      <div className="px-4 md:px-10 py-6 md:py-8 max-w-2xl">
        <header className="mb-6">
          <p className="text-xs uppercase tracking-widest text-muted-foreground">
            खाता · your account
          </p>
          <h1 className="mt-1 font-display text-3xl md:text-4xl text-ink">Account</h1>
        </header>

        {user && <SignedInView userId={user.id} email={user.email ?? ""} />}
      </div>
    </AppShell>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  readOnly,
}: {
  label: string;
  value: string;
  onChange?: (v: string) => void;
  type?: string;
  readOnly?: boolean;
}) {
  return (
    <label className="block">
      <span className="block text-xs text-muted-foreground mb-1">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        type={type}
        readOnly={readOnly}
        className={`w-full rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/40 ${
          readOnly ? "text-muted-foreground" : ""
        }`}
      />
    </label>
  );
}

const gstinSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[0-9A-Z]{15}$/, "GSTIN must be 15 alphanumeric characters")
  .optional()
  .or(z.literal(""));

// Business/GST identity used as the "seller" details on printed bills
// (Section 3). Stored on organizations for org accounts, falling back to
// profiles for legacy org_id-less accounts. Optional throughout — Create
// Bill degrades gracefully with no GSTIN saved.
function SellerIdentityCard({ profile, onSaved }: { profile: Profile; onSaved: () => void }) {
  const isOrgAccount = !!profile.org_id;
  const canEdit = !isOrgAccount || profile.role === "owner";
  const source = profile.org ?? profile;

  const [businessAddress, setBusinessAddress] = useState(source.business_address ?? "");
  const [gstin, setGstin] = useState(source.gstin ?? "");
  const [state, setState] = useState(source.state ?? "");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setBusinessAddress(source.business_address ?? "");
    setGstin(source.gstin ?? "");
    setState(source.state ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile.org_id, source.business_address, source.gstin, source.state]);

  const save = async () => {
    setErr(null);
    setMsg(null);
    const parsed = gstinSchema.safeParse(gstin);
    if (!parsed.success) {
      setErr(parsed.error.issues[0]?.message ?? "Invalid GSTIN");
      return;
    }
    setSaving(true);
    const payload = {
      business_address: businessAddress.trim() || null,
      gstin: parsed.data ? parsed.data : null,
      state: state.trim() || null,
    };
    const { error } = profile.org_id
      ? await supabase.from("organizations").update(payload).eq("id", profile.org_id)
      : await supabase.from("profiles").update(payload).eq("id", profile.id);
    setSaving(false);
    if (error) setErr(error.message);
    else {
      setMsg("Saved");
      onSaved();
    }
  };

  return (
    <div className="card-warm p-5 md:p-6 space-y-4">
      <div className="flex items-center gap-2 text-sm text-ink">
        <Receipt size={16} className="text-primary" />
        <span className="font-medium">Business & GST details</span>
      </div>
      <p className="text-xs text-muted-foreground -mt-2">
        Used as the seller details on printed bills. GSTIN is optional — leave it blank if you're
        not GST-registered, and GST fields on bills will stay hidden.
      </p>

      {!canEdit && (
        <p className="text-xs text-muted-foreground bg-muted rounded-lg px-3 py-2">
          Only the org owner can edit these — you can still see them here.
        </p>
      )}

      <div className="space-y-3">
        <Field
          label="Business address"
          value={businessAddress}
          onChange={canEdit ? setBusinessAddress : undefined}
          readOnly={!canEdit}
        />
        <div className="grid grid-cols-2 gap-3">
          <Field
            label="State"
            value={state}
            onChange={canEdit ? setState : undefined}
            readOnly={!canEdit}
          />
          <Field
            label="GSTIN (optional)"
            value={gstin}
            onChange={canEdit ? (v) => setGstin(v.toUpperCase()) : undefined}
            readOnly={!canEdit}
          />
        </div>
      </div>

      {err && <div className="text-sm text-destructive bg-destructive/10 rounded-lg px-3 py-2">{err}</div>}
      {msg && <div className="text-sm text-success bg-success/10 rounded-lg px-3 py-2">{msg}</div>}

      {canEdit && (
        <button
          onClick={save}
          disabled={saving}
          className="rounded-lg bg-primary text-primary-foreground px-4 py-2 text-sm disabled:opacity-60"
        >
          {saving ? "Saving…" : "Save business details"}
        </button>
      )}
    </div>
  );
}

function SignedInView({ userId, email }: { userId: string; email: string }) {
  const { profile, reload } = useProfile();
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    if (!profile) return;
    setFullName(profile.full_name ?? "");
    setPhone(profile.phone ?? "");
  }, [profile]);

  const save = async () => {
    setSaving(true);
    setErr(null);
    setMsg(null);
    const parsed = z
      .object({
        full_name: z.string().trim().min(1).max(80),
        phone: z
          .string()
          .trim()
          .max(20)
          .regex(/^[+0-9 \-()]*$/, "Digits only")
          .optional()
          .or(z.literal("")),
      })
      .safeParse({ full_name: fullName, phone });
    if (!parsed.success) {
      setErr(parsed.error.issues[0]?.message ?? "Invalid input");
      setSaving(false);
      return;
    }
    const { error } = await supabase
      .from("profiles")
      .upsert({ id: userId, full_name: parsed.data.full_name, phone: parsed.data.phone ?? "" });
    if (error) setErr(error.message);
    else setMsg("Saved");
    setSaving(false);
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/auth" });
  };

  const copyCode = () => {
    if (!profile?.org?.org_code) return;
    navigator.clipboard.writeText(profile.org.org_code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="space-y-5">
      <div className="card-warm p-5 md:p-6 space-y-4">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 grid place-items-center rounded-full bg-primary/10 text-primary">
            <UserIcon size={18} />
          </div>
          <div>
            <div className="font-medium text-ink">{fullName || "Your profile"}</div>
            <div className="text-xs text-muted-foreground">{email}</div>
          </div>
          {profile?.role && (
            <span className="ml-auto rounded-full bg-primary/10 text-ink text-xs px-2.5 py-1">
              {ROLE_LABELS[profile.role]}
            </span>
          )}
        </div>

        <div className="space-y-3">
          <Field label="Full name" value={fullName} onChange={setFullName} />
          <Field label="Phone" value={phone} onChange={setPhone} type="tel" />
          <Field label="Email" value={email} readOnly />
        </div>

        {err && (
          <div className="text-sm text-destructive bg-destructive/10 rounded-lg px-3 py-2">{err}</div>
        )}
        {msg && (
          <div className="text-sm text-success bg-success/10 rounded-lg px-3 py-2">{msg}</div>
        )}

        <button
          onClick={save}
          disabled={saving}
          className="rounded-lg bg-primary text-primary-foreground px-4 py-2 text-sm disabled:opacity-60"
        >
          {saving ? "Saving…" : "Save profile"}
        </button>
      </div>

      {profile?.org && (
        <div className="card-warm p-5 md:p-6 space-y-4">
          <div className="flex items-center gap-2 text-sm text-ink">
            <Building2 size={16} className="text-primary" />
            <span className="font-medium">Organization</span>
          </div>
          <Field label="Company name" value={profile.org.name} readOnly />
          <label className="block">
            <span className="block text-xs text-muted-foreground mb-1">Organization code</span>
            <div className="flex items-center gap-2">
              <input
                value={profile.org.org_code}
                readOnly
                className="flex-1 rounded-lg border border-border bg-card px-3 py-2 text-sm font-mono tracking-widest text-muted-foreground"
              />
              <button
                onClick={copyCode}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-sm hover:bg-muted"
              >
                {copied ? <Check size={14} className="text-success" /> : <Copy size={14} />}
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Share this code with teammates so they can sign in against this organization.
            </p>
          </label>
        </div>
      )}

      {profile && <SellerIdentityCard profile={profile} onSaved={reload} />}

      <button
        onClick={signOut}
        className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm hover:bg-muted"
      >
        <LogOut size={15} /> Log out
      </button>
    </div>
  );
}
