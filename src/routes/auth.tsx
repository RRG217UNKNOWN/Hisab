import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { ShieldCheck, Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { useT } from "@/lib/i18n";

export const Route = createFileRoute("/auth")({
  component: AuthPage,
  head: () => ({
    meta: [
      { title: "Sign in · Hisab" },
      { name: "description", content: "Sign in to your Hisab shop account." },
    ],
  }),
});

// Note: these validation messages stay in English — zod schemas are built
// once at module scope, outside any component, so they can't reactively
// read the current language the way the rest of the page's copy does.
const orgCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9]{10}$/, "Org code must be 10 letters/digits")
  .optional()
  .or(z.literal(""));

const signUpSchema = z.object({
  full_name: z.string().trim().min(2, "Enter your full name").max(80),
  email: z.string().trim().email("Enter a valid email").max(255),
  phone: z
    .string()
    .trim()
    .max(20)
    .regex(/^[+0-9 \-()]*$/, "Digits only")
    .optional()
    .or(z.literal("")),
  password: z.string().min(8, "Min 8 characters").max(72),
});

const signInSchema = z.object({
  email: z.string().trim().email("Enter a valid email").max(255),
  password: z.string().min(1, "Password required").max(72),
  org_code: orgCodeSchema,
});

type OrgMode = "solo" | "create" | "join";

type Rpc = {
  rpc: (
    fn: string,
    args?: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
};
const sbRpc = supabase as unknown as Rpc;

function AuthPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const { t } = useT();

  useEffect(() => {
    if (!loading && user) navigate({ to: "/" });
  }, [user, loading, navigate]);

  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [form, setForm] = useState({ full_name: "", email: "", phone: "", password: "" });
  const [orgMode, setOrgMode] = useState<OrgMode>("solo");
  const [orgName, setOrgName] = useState("");
  const [signupOrgCode, setSignupOrgCode] = useState("");
  const [signinOrgCode, setSigninOrgCode] = useState("");

  const attachOrg = async (): Promise<{ error?: string }> => {
    if (orgMode === "create") {
      const name = orgName.trim();
      if (name.length < 2) return { error: "Enter your organization name" };
      const { error } = await sbRpc.rpc("create_organization", { _name: name });
      if (error) return { error: error.message };
    } else if (orgMode === "join") {
      const code = signupOrgCode.trim().toUpperCase();
      if (!/^[A-Z0-9]{10}$/.test(code)) return { error: "Org code must be 10 letters/digits" };
      const { error } = await sbRpc.rpc("join_organization", { _code: code });
      if (error) return { error: error.message };
    }
    return {};
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setMsg(null);
    setBusy(true);
    try {
      if (mode === "signup") {
        const parsed = signUpSchema.safeParse(form);
        if (!parsed.success) {
          setErr(parsed.error.issues[0]?.message ?? "Invalid input");
          return;
        }
        // A stale session from a previous account must never bleed into a
        // fresh signup — without this, if email confirmation is required
        // (signUp returns no session), the app would keep showing the OLD
        // account's dashboard, which looks exactly like "new account, same
        // old entries" even though nothing was actually shared.
        await supabase.auth.signOut();
        const { data: signUpData, error } = await supabase.auth.signUp({
          email: parsed.data.email,
          password: parsed.data.password,
          options: {
            emailRedirectTo: window.location.origin + "/",
            data: { full_name: parsed.data.full_name, phone: parsed.data.phone ?? "" },
          },
        });
        if (error) throw error;
        if (signUpData.session) {
          // Real session for the brand-new user — safe to attach an org and
          // let the redirect effect below take over once `user` updates.
          const res = await attachOrg();
          if (res.error) {
            setErr(res.error);
            return;
          }
          setMsg("Account created. Redirecting…");
        } else {
          // No session yet — email confirmation is required on this
          // project. Nothing to redirect to; say so plainly instead of
          // claiming a redirect that won't happen.
          setMsg("Account created. Check your email to confirm it, then sign in.");
        }
      } else {
        const parsed = signInSchema.safeParse({ ...form, org_code: signinOrgCode });
        if (!parsed.success) {
          setErr(parsed.error.issues[0]?.message ?? "Invalid input");
          return;
        }
        const { data: signInData, error } = await supabase.auth.signInWithPassword({
          email: parsed.data.email,
          password: parsed.data.password,
        });
        if (error) throw error;
        // Validate org code matches profile.org_id
        const code = parsed.data.org_code?.trim().toUpperCase();
        if (code && signInData.user) {
          const { data: profile } = await supabase
            .from("profiles")
            .select("org_id")
            .eq("id", signInData.user.id)
            .maybeSingle();
          const orgId = (profile as { org_id?: string | null } | null)?.org_id;
          const { data: org } = await sbRpc.rpc("verify_org_code", { _code: code });
          const orgRow = Array.isArray(org) ? (org[0] as { id?: string } | undefined) : null;
          if (!orgRow?.id) {
            await supabase.auth.signOut();
            setErr("That organization code doesn't exist.");
            return;
          }
          if (orgId !== orgRow.id) {
            await supabase.auth.signOut();
            setErr("Your account doesn't belong to that organization.");
            return;
          }
        }
      }
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  };

  if (loading || user) {
    return (
      <div className="min-h-screen grid place-items-center bg-background text-muted-foreground">
        <Loader2 size={20} className="animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <div className="font-display text-4xl text-ink leading-none">Hisab</div>
          <div className="mt-1 text-xs text-muted-foreground tracking-wide">{t("auth.tagline")}</div>
        </div>

        <div className="card-warm p-6 space-y-5">
          <div className="flex items-center gap-1 rounded-full border border-border bg-card p-0.5 text-xs w-fit mx-auto">
            {(["signin", "signup"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => {
                  setMode(m);
                  setErr(null);
                  setMsg(null);
                }}
                className={`px-4 py-1.5 rounded-full transition ${
                  mode === m
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {m === "signin" ? t("auth.login") : t("auth.signup")}
              </button>
            ))}
          </div>

          <form onSubmit={onSubmit} className="space-y-3">
            {mode === "signup" && (
              <>
                <Field
                  label={t("auth.businessOwnerName")}
                  value={form.full_name}
                  onChange={(v) => setForm({ ...form, full_name: v })}
                  placeholder="Ramesh Kumar"
                  autoComplete="name"
                />
                <Field
                  label={t("auth.phoneOptional")}
                  value={form.phone}
                  onChange={(v) => setForm({ ...form, phone: v })}
                  placeholder="+91 98xxxxxxxx"
                  type="tel"
                  autoComplete="tel"
                />
              </>
            )}
            <Field
              label={t("auth.email")}
              value={form.email}
              onChange={(v) => setForm({ ...form, email: v })}
              placeholder="you@shop.in"
              type="email"
              autoComplete="email"
            />
            <Field
              label={t("auth.password")}
              value={form.password}
              onChange={(v) => setForm({ ...form, password: v })}
              placeholder={mode === "signup" ? t("auth.minChars") : ""}
              type="password"
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
            />

            {mode === "signup" && (
              <div className="rounded-lg border border-border bg-muted/40 p-3 space-y-3">
                <div className="text-xs font-medium text-ink">{t("auth.organization")}</div>
                <div className="flex flex-wrap gap-2 text-xs">
                  {(
                    [
                      ["solo", t("auth.justMe")],
                      ["create", t("auth.createNew")],
                      ["join", t("auth.joinExisting")],
                    ] as [OrgMode, string][]
                  ).map(([k, label]) => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => setOrgMode(k)}
                      className={`rounded-full px-3 py-1 border transition ${
                        orgMode === k
                          ? "border-primary bg-primary/10 text-ink"
                          : "border-border bg-card text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {orgMode === "create" && (
                  <Field
                    label={t("auth.organizationName")}
                    value={orgName}
                    onChange={setOrgName}
                    placeholder="Kumar Kirana Stores"
                  />
                )}
                {orgMode === "join" && (
                  <Field
                    label={t("auth.organizationCode")}
                    value={signupOrgCode}
                    onChange={(v) => setSignupOrgCode(v.toUpperCase())}
                    placeholder="10-character code"
                  />
                )}
                {orgMode === "solo" && <p className="text-xs text-muted-foreground">{t("auth.soloHint")}</p>}
              </div>
            )}

            {mode === "signin" && (
              <Field
                label={t("auth.organizationCodeOptional")}
                value={signinOrgCode}
                onChange={(v) => setSigninOrgCode(v.toUpperCase())}
                placeholder={t("auth.leaveBlankIfUnsure")}
              />
            )}

            {err && (
              <div className="text-sm text-destructive bg-destructive/10 rounded-lg px-3 py-2">{err}</div>
            )}
            {msg && (
              <div className="text-sm text-success bg-success/10 rounded-lg px-3 py-2">{msg}</div>
            )}

            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-lg bg-primary text-primary-foreground py-2.5 text-sm font-medium disabled:opacity-60"
            >
              {busy ? t("auth.pleaseWait") : mode === "signin" ? t("auth.login") : t("auth.createAccount")}
            </button>
          </form>

          <div className="flex items-start gap-2 text-xs text-muted-foreground">
            <ShieldCheck size={14} className="mt-0.5 shrink-0" />
            <span>{t("auth.isolationNote")}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  autoComplete,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  autoComplete?: string;
}) {
  return (
    <label className="block">
      <span className="block text-xs text-muted-foreground mb-1">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        type={type}
        placeholder={placeholder}
        autoComplete={autoComplete}
        className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/40"
      />
    </label>
  );
}
