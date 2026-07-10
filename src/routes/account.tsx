import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { LogOut, User as UserIcon, Copy, Check, Building2 } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { useProfile } from "@/hooks/use-profile";
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

function SignedInView({ userId, email }: { userId: string; email: string }) {
  const { profile } = useProfile();
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

      <button
        onClick={signOut}
        className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm hover:bg-muted"
      >
        <LogOut size={15} /> Log out
      </button>
    </div>
  );
}
