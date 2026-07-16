import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import {
  Languages,
  Check,
  Activity as ActivityIcon,
  ChevronRight,
  LogOut,
  User as UserIcon,
  Copy,
  Building2,
  Receipt,
  Type,
  Hash,
  Pencil,
} from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { useProfile, type Profile } from "@/hooks/use-profile";
import { ROLE_LABELS, can } from "@/lib/permissions";
import { LANG_LABELS, useT, type Lang, type ContentMode } from "@/lib/i18n";

export const Route = createFileRoute("/settings")({
  component: SettingsPage,
  head: () => ({
    meta: [
      { title: "Settings · Hisab" },
      { name: "description", content: "Your profile, organization, and preferences for your Hisab shop app." },
    ],
  }),
});

function SettingsPage() {
  const { user } = useAuth();
  const { t, tf, lang, setLang, contentMode, setContentMode } = useT();
  const { profile, reload } = useProfile();

  const LANGS: { code: Lang; hint: string }[] = [
    { code: "en", hint: t("set.default") },
    { code: "hi", hint: "हिंदी" },
    { code: "mr", hint: "मराठी" },
  ];

  const CONTENT_MODES: { code: ContentMode; label: string; hint: string; icon: React.ReactNode }[] = [
    { code: "both", label: t("set.wordsAndNumbers"), hint: t("set.translateEverything"), icon: <Languages size={14} /> },
    { code: "words", label: t("set.wordsOnly"), hint: t("set.numbersStay09"), icon: <Type size={14} /> },
    { code: "numbers", label: t("set.numbersOnly"), hint: t("set.textStaysEnglish"), icon: <Hash size={14} /> },
  ];

  return (
    <AppShell active="settings" title={t("set.title")}>
      <div className="px-4 md:px-10 py-6 md:py-8 max-w-4xl space-y-6">
        <header>
          <h1 className="mt-1 font-display text-3xl md:text-4xl text-ink">{t("set.title")}</h1>
        </header>

        <div className="grid gap-6 md:grid-cols-2 md:items-start">
          {/* ---- Left column: language + translation preferences, and the
               alter-entries shortcut sitting just below it ------------- */}
          <div className="space-y-6">
            <section className="card-warm p-5 md:p-6">
              <div className="flex items-center gap-2 text-sm text-ink">
                <Languages size={16} className="text-primary" />
                <span className="font-medium">{t("set.appLanguage")}</span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{t("set.languageHint")}</p>

              <div className="mt-4 grid gap-2">
                {LANGS.map((l) => {
                  const active = lang === l.code;
                  return (
                    <button
                      key={l.code}
                      onClick={() => setLang(l.code)}
                      className={`flex items-center justify-between rounded-lg border px-4 py-3 text-left transition ${
                        active ? "border-primary bg-primary/5" : "border-border bg-card hover:bg-muted"
                      }`}
                    >
                      <div>
                        <div className="text-sm font-medium text-ink">{LANG_LABELS[l.code]}</div>
                        <div className="text-xs text-muted-foreground">{l.hint}</div>
                      </div>
                      {active && <Check size={16} className="text-primary" />}
                    </button>
                  );
                })}
              </div>

              {lang !== "en" && (
                <div className="mt-5 pt-5 border-t border-border">
                  <div className="text-sm font-medium text-ink">{t("set.translate")}</div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {tf("set.translateHint", { lang: LANG_LABELS[lang] })}
                  </p>
                  <div className="mt-3 grid gap-2 sm:grid-cols-3">
                    {CONTENT_MODES.map((m) => {
                      const active = contentMode === m.code;
                      return (
                        <button
                          key={m.code}
                          onClick={() => setContentMode(m.code)}
                          className={`rounded-lg border px-3 py-2.5 text-left transition ${
                            active ? "border-primary bg-primary/5" : "border-border bg-card hover:bg-muted"
                          }`}
                        >
                          <div className="flex items-center gap-1.5 text-sm text-ink">
                            {m.icon}
                            <span className="font-medium">{m.label}</span>
                            {active && <Check size={13} className="text-primary ml-auto" />}
                          </div>
                          <div className="mt-0.5 text-[11px] text-muted-foreground">{m.hint}</div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </section>

            {/* ---- Alter entries — styled like the Activity Log link ---- */}
            {can.alterEntries(profile?.role) && (
              <div className="card-warm p-5 md:p-6">
                <Link to="/alter-entries" className="flex items-center justify-between group">
                  <div className="flex items-center gap-2 text-sm text-ink">
                    <Pencil size={16} className="text-primary" />
                    <div>
                      <div className="font-medium">{t("set.alterEntriesTitle")}</div>
                      <p className="mt-0.5 text-xs text-muted-foreground">{t("set.alterEntriesHint")}</p>
                    </div>
                  </div>
                  <ChevronRight
                    size={16}
                    className="text-muted-foreground group-hover:text-foreground transition shrink-0"
                  />
                </Link>
              </div>
            )}
          </div>

          {/* ---- Right column: your profile, to the right of language -- */}
          {user && <ProfileCard userId={user.id} email={user.email ?? ""} profile={profile} onProfileSaved={reload} />}
        </div>

        {/* ---- Organization, GST identity, activity log, sign-out ------ */}
        {user && <SignedInSection profile={profile} onProfileSaved={reload} />}
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
  const { t } = useT();
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
      setMsg(t("acc.saved"));
      onSaved();
    }
  };

  return (
    <div className="card-warm p-5 md:p-6 space-y-4">
      <div className="flex items-center gap-2 text-sm text-ink">
        <Receipt size={16} className="text-primary" />
        <span className="font-medium">{t("set.businessGst")}</span>
      </div>
      <p className="text-xs text-muted-foreground -mt-2">{t("set.businessGstHint")}</p>

      {!canEdit && (
        <p className="text-xs text-muted-foreground bg-muted rounded-lg px-3 py-2">{t("set.onlyOwnerEdit")}</p>
      )}

      <div className="space-y-3">
        <Field
          label={t("set.businessAddress")}
          value={businessAddress}
          onChange={canEdit ? setBusinessAddress : undefined}
          readOnly={!canEdit}
        />
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("party.state")} value={state} onChange={canEdit ? setState : undefined} readOnly={!canEdit} />
          <Field
            label={t("set.gstinOptional")}
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
          {saving ? t("party.saving") : t("set.saveBusinessDetails")}
        </button>
      )}
    </div>
  );
}

function ProfileCard({
  userId,
  email,
  profile,
  onProfileSaved,
}: {
  userId: string;
  email: string;
  profile: Profile | null;
  onProfileSaved: () => void;
}) {
  const { t } = useT();
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

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
    else {
      setMsg(t("acc.saved"));
      onProfileSaved();
    }
    setSaving(false);
  };

  return (
    <div className="card-warm p-5 md:p-6 space-y-4">
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 grid place-items-center rounded-full bg-primary/10 text-primary">
          <UserIcon size={18} />
        </div>
        <div>
          <div className="font-medium text-ink">{fullName || t("set.yourProfile")}</div>
          <div className="text-xs text-muted-foreground">{email}</div>
        </div>
        {profile?.role && (
          <span className="ml-auto rounded-full bg-primary/10 text-ink text-xs px-2.5 py-1">
            {ROLE_LABELS[profile.role]}
          </span>
        )}
      </div>

      <div className="space-y-3">
        <Field label={t("acc.fullName")} value={fullName} onChange={setFullName} />
        <Field label={t("acc.phone")} value={phone} onChange={setPhone} type="tel" />
        <Field label={t("auth.email")} value={email} readOnly />
      </div>

      {err && <div className="text-sm text-destructive bg-destructive/10 rounded-lg px-3 py-2">{err}</div>}
      {msg && <div className="text-sm text-success bg-success/10 rounded-lg px-3 py-2">{msg}</div>}

      <button
        onClick={save}
        disabled={saving}
        className="rounded-lg bg-primary text-primary-foreground px-4 py-2 text-sm disabled:opacity-60"
      >
        {saving ? t("party.saving") : t("acc.save")}
      </button>
    </div>
  );
}

function SignedInSection({ profile, onProfileSaved }: { profile: Profile | null; onProfileSaved: () => void }) {
  const { t } = useT();
  const [copied, setCopied] = useState(false);
  const navigate = useNavigate();

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
      {profile?.org && (
        <div className="card-warm p-5 md:p-6 space-y-4">
          <div className="flex items-center gap-2 text-sm text-ink">
            <Building2 size={16} className="text-primary" />
            <span className="font-medium">{t("set.organization")}</span>
          </div>
          <Field label={t("set.companyName")} value={profile.org.name} readOnly />
          <label className="block">
            <span className="block text-xs text-muted-foreground mb-1">{t("set.organizationCode")}</span>
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
                {copied ? t("set.copied") : t("set.copy")}
              </button>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{t("set.shareCodeHint")}</p>
          </label>
        </div>
      )}

      {profile && <SellerIdentityCard profile={profile} onSaved={onProfileSaved} />}

      {can.viewActivity(profile?.role) && (
        <div className="card-warm p-5 md:p-6">
          <Link to="/activity" className="flex items-center justify-between group">
            <div className="flex items-center gap-2 text-sm text-ink">
              <ActivityIcon size={16} className="text-primary" />
              <div>
                <div className="font-medium">{t("set.activityLogTitle")}</div>
                <p className="mt-0.5 text-xs text-muted-foreground">{t("set.activityLogHint")}</p>
              </div>
            </div>
            <ChevronRight size={16} className="text-muted-foreground group-hover:text-foreground transition shrink-0" />
          </Link>
        </div>
      )}

      <button
        onClick={signOut}
        className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm hover:bg-muted"
      >
        <LogOut size={15} /> {t("acc.logout")}
      </button>
    </div>
  );
}
