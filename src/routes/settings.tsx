import { createFileRoute, Link } from "@tanstack/react-router";
import { Languages, Check, Activity as ActivityIcon, ChevronRight } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { useProfile } from "@/hooks/use-profile";
import { can } from "@/lib/permissions";
import { LANG_LABELS, useT, type Lang } from "@/lib/i18n";

export const Route = createFileRoute("/settings")({
  component: SettingsPage,
  head: () => ({
    meta: [
      { title: "Settings · Hisab" },
      { name: "description", content: "Preferences and language for your Hisab shop app." },
    ],
  }),
});

const LANGS: { code: Lang; hint: string }[] = [
  { code: "en", hint: "Default" },
  { code: "hi", hint: "हिंदी" },
  { code: "mr", hint: "मराठी" },
];

function SettingsPage() {
  const { t, lang, setLang } = useT();
  const { profile } = useProfile();

  return (
    <AppShell active="settings" title={t("set.title")}>
      <div className="px-4 md:px-10 py-6 md:py-8 max-w-2xl space-y-6">
        <header>
          <p className="text-xs uppercase tracking-widest text-muted-foreground">
            सेटिंग्स · preferences
          </p>
          <h1 className="mt-1 font-display text-3xl md:text-4xl text-ink">{t("set.title")}</h1>
        </header>

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
                    active
                      ? "border-primary bg-primary/5"
                      : "border-border bg-card hover:bg-muted"
                  }`}
                >
                  <div>
                    <div className="text-sm font-medium text-ink">
                      {LANG_LABELS[l.code]}
                    </div>
                    <div className="text-xs text-muted-foreground">{l.hint}</div>
                  </div>
                  {active && <Check size={16} className="text-primary" />}
                </button>
              );
            })}
          </div>
        </section>

        {can.viewActivity(profile?.role) && (
          <section className="card-warm p-5 md:p-6">
            <Link to="/activity" className="flex items-center justify-between group">
              <div className="flex items-center gap-2 text-sm text-ink">
                <ActivityIcon size={16} className="text-primary" />
                <div>
                  <div className="font-medium">Activity log</div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Every add, edit and delete across your shop, who did it and when.
                  </p>
                </div>
              </div>
              <ChevronRight size={16} className="text-muted-foreground group-hover:text-foreground transition shrink-0" />
            </Link>
          </section>
        )}
      </div>
    </AppShell>
  );
}
