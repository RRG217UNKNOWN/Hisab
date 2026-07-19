import { useMemo, useState } from "react";
import { X, Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useT } from "@/lib/i18n";

export type ClassificationType = "Sales" | "Purchase" | "Expense" | "Payment" | "Receipt" | "Custom";

export type ClassificationRow = {
  id: string;
  reference_label: string;
  source_type: "bill" | "expense" | "manual";
  source_id: string | null;
  classification: string;
  notes: string | null;
  created_at: string;
};

export type TxnCandidate = {
  label: string;
  source_type: "bill" | "expense";
  source_id: string;
};

// Loose escape-hatch for the newer table, matching the convention already
// used in reports.tsx / vendors.tsx / create-bill.tsx.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sb = { from: (t: string) => any };
const sb = supabase as unknown as Sb;

const TYPE_OPTIONS: ClassificationType[] = ["Sales", "Purchase", "Expense", "Payment", "Receipt", "Custom"];

/**
 * Same shell, sizing, and interaction pattern as PartyForm's "Add Party"
 * modal — backdrop, top-right close button, card-warm panel, bottom-right
 * Cancel/Save pair — so it feels like the same product, not a bolt-on.
 */
export function ClassifyTransactionModal({
  userId,
  candidates,
  onClose,
  onSaved,
}: {
  userId: string;
  candidates: TxnCandidate[];
  onClose: () => void;
  onSaved: (row: ClassificationRow) => void;
}) {
  const { t } = useT();
  const [refQuery, setRefQuery] = useState("");
  const [showPicker, setShowPicker] = useState(false);
  const [picked, setPicked] = useState<TxnCandidate | null>(null);
  const [classification, setClassification] = useState<ClassificationType>("Sales");
  const [customLabel, setCustomLabel] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const matches = useMemo(() => {
    const q = refQuery.trim().toLowerCase();
    if (!q) return candidates.slice(0, 8);
    return candidates.filter((c) => c.label.toLowerCase().includes(q)).slice(0, 8);
  }, [candidates, refQuery]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    const referenceLabel = picked ? picked.label : refQuery.trim();
    if (!referenceLabel) {
      setErr(t("rep.classifyPickReference"));
      return;
    }
    const finalType = classification === "Custom" ? customLabel.trim() : classification;
    if (!finalType) {
      setErr(t("rep.classifyEnterCustom"));
      return;
    }
    setBusy(true);
    const payload = {
      user_id: userId,
      reference_label: referenceLabel,
      source_type: picked ? picked.source_type : "manual",
      source_id: picked ? picked.source_id : null,
      classification: finalType,
      notes: notes.trim() || null,
    };
    const { data, error } = await sb.from("transaction_classifications").insert(payload).select("*").single();
    setBusy(false);
    if (error) return setErr(error.message);
    onSaved(data as ClassificationRow);
  };

  return (
    <div className="fixed inset-0 z-50 bg-ink/40 backdrop-blur-sm grid place-items-center p-4" onClick={onClose}>
      <div className="w-full max-w-md card-warm p-6 relative" onClick={(e) => e.stopPropagation()}>
        <button
          onClick={onClose}
          aria-label={t("common.close")}
          className="absolute right-3 top-3 h-8 w-8 grid place-items-center rounded-full hover:bg-muted"
        >
          <X size={16} />
        </button>
        <h2 className="font-display text-2xl text-ink">{t("rep.classifyTransaction")}</h2>

        <form onSubmit={submit} className="mt-5 space-y-3">
          <div>
            <label className="text-xs uppercase tracking-wider text-muted-foreground">{t("rep.classifyReference")}</label>
            <div className="relative mt-1">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                autoFocus
                value={refQuery}
                onChange={(e) => {
                  setRefQuery(e.target.value);
                  setPicked(null);
                  setShowPicker(true);
                }}
                onFocus={() => setShowPicker(true)}
                onBlur={() => setTimeout(() => setShowPicker(false), 150)}
                placeholder={t("rep.classifyReferencePlaceholder")}
                className="w-full rounded-lg border border-border bg-card pl-9 pr-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/40"
              />
              {showPicker && matches.length > 0 && (
                <div className="absolute z-10 mt-1 w-full rounded-lg border border-border bg-card shadow-lg overflow-hidden">
                  {matches.map((c) => (
                    <button
                      key={`${c.source_type}-${c.source_id}`}
                      type="button"
                      onClick={() => {
                        setPicked(c);
                        setRefQuery(c.label);
                        setShowPicker(false);
                      }}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-muted flex items-center justify-between gap-2"
                    >
                      <span>{c.label}</span>
                      <span className="text-[10px] text-muted-foreground capitalize shrink-0">{c.source_type}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{t("rep.classifyReferenceHint")}</p>
          </div>

          <div>
            <label className="text-xs uppercase tracking-wider text-muted-foreground">{t("rep.classifyType")}</label>
            <select
              value={classification}
              onChange={(e) => setClassification(e.target.value as ClassificationType)}
              className="mt-1 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/40"
            >
              {TYPE_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
            {classification === "Custom" && (
              <input
                value={customLabel}
                onChange={(e) => setCustomLabel(e.target.value)}
                placeholder={t("rep.classifyCustomPlaceholder")}
                className="mt-2 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/40"
              />
            )}
          </div>

          <div>
            <label className="text-xs uppercase tracking-wider text-muted-foreground">{t("rep.classifyNotesOptional")}</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="mt-1 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/40 min-h-[60px]"
            />
          </div>

          {err && <div className="text-sm text-destructive">{err}</div>}

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="rounded-lg border border-border bg-card px-4 py-2 text-sm">
              {t("common.cancel")}
            </button>
            <button
              type="submit"
              disabled={busy}
              className="rounded-lg bg-primary text-primary-foreground px-4 py-2 text-sm disabled:opacity-60"
            >
              {busy ? t("party.saving") : t("rep.classifyTransaction")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
