import { useState, useEffect } from "react";
import { X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useT } from "@/lib/i18n";

export type PartyRow = {
  id: string;
  name: string;
  type: "vendor" | "customer" | "both";
  address: string | null;
  state: string | null;
  country: string | null;
  phone: string | null;
  email: string | null;
  gst_no: string | null;
  pan_no: string | null;
  registration_type: string | null;
  bank_account_no: string | null;
  bank_ifsc: string | null;
  bank_name: string | null;
  notes: string | null;
};

type Sb = {
  from: (t: string) => {
    insert: (r: unknown) => { select: (s: string) => { single: () => Promise<{ data: PartyRow | null; error: { message: string } | null }> } };
    update: (r: unknown) => { eq: (c: string, v: string) => Promise<{ error: { message: string } | null }> };
  };
};

export function PartyForm({
  party,
  userId,
  defaultType,
  onClose,
  onSaved,
}: {
  party?: PartyRow | null;
  userId: string;
  defaultType?: "vendor" | "customer" | "both";
  onClose: () => void;
  onSaved: (p: PartyRow) => void;
}) {
  const { t } = useT();
  const [form, setForm] = useState({
    name: party?.name ?? "",
    type: (party?.type ?? defaultType ?? "vendor") as "vendor" | "customer" | "both",
    address: party?.address ?? "",
    state: party?.state ?? "",
    country: party?.country ?? "India",
    phone: party?.phone ?? "",
    email: party?.email ?? "",
    gst_no: party?.gst_no ?? "",
    pan_no: party?.pan_no ?? "",
    registration_type: party?.registration_type ?? "",
    bank_account_no: party?.bank_account_no ?? "",
    bank_ifsc: party?.bank_ifsc ?? "",
    bank_name: party?.bank_name ?? "",
    notes: party?.notes ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (party) {
      setForm({
        name: party.name,
        type: party.type,
        address: party.address ?? "",
        state: party.state ?? "",
        country: party.country ?? "India",
        phone: party.phone ?? "",
        email: party.email ?? "",
        gst_no: party.gst_no ?? "",
        pan_no: party.pan_no ?? "",
        registration_type: party.registration_type ?? "",
        bank_account_no: party.bank_account_no ?? "",
        bank_ifsc: party.bank_ifsc ?? "",
        bank_name: party.bank_name ?? "",
        notes: party.notes ?? "",
      });
    }
  }, [party]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) {
      setErr(t("party.nameRequired"));
      return;
    }
    setBusy(true);
    setErr(null);
    const sb = supabase as unknown as Sb;
    const payload: Record<string, unknown> = {
      name: form.name.trim(),
      type: form.type,
      address: form.address || null,
      state: form.state || null,
      country: form.country || null,
      phone: form.phone || null,
      email: form.email || null,
      gst_no: form.gst_no || null,
      pan_no: form.pan_no || null,
      registration_type: form.registration_type || null,
      bank_account_no: form.bank_account_no || null,
      bank_ifsc: form.bank_ifsc || null,
      bank_name: form.bank_name || null,
      notes: form.notes || null,
    };
    if (party) {
      const { error } = await sb.from("parties").update(payload).eq("id", party.id);
      setBusy(false);
      if (error) return setErr(error.message);
      onSaved({ ...party, ...(payload as Partial<PartyRow>) } as PartyRow);
    } else {
      payload.user_id = userId;
      const { data, error } = await sb.from("parties").insert(payload).select("*").single();
      setBusy(false);
      if (error) return setErr(error.message);
      if (data) onSaved(data);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-ink/40 backdrop-blur-sm grid place-items-center p-4" onClick={onClose}>
      <div
        className="w-full max-w-2xl max-h-[90vh] overflow-y-auto card-warm p-6 relative"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          aria-label={t("common.close")}
          className="absolute right-3 top-3 h-8 w-8 grid place-items-center rounded-full hover:bg-muted"
        >
          <X size={16} />
        </button>
        <h2 className="font-display text-2xl text-ink">{party ? t("party.editParty") : t("party.addParty")}</h2>

        <form onSubmit={submit} className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Row label={`${t("party.name")} *`}>
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="input"
              autoFocus
            />
          </Row>
          <Row label={`${t("party.type")} *`}>
            <select
              value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value as PartyRow["type"] })}
              className="input"
            >
              <option value="vendor">{t("party.vendor")}</option>
              <option value="customer">{t("party.customer")}</option>
              <option value="both">{t("party.both")}</option>
            </select>
          </Row>
          <Row label={t("party.phone")}>
            <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="input" />
          </Row>
          <Row label={t("party.email")}>
            <input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="input" type="email" />
          </Row>
          <Row label={t("party.address")} span2>
            <input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} className="input" />
          </Row>
          <Row label={t("party.state")}>
            <input value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} className="input" />
          </Row>
          <Row label={t("party.country")}>
            <input value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })} className="input" />
          </Row>
          <Row label={t("party.gstNo")}>
            <input value={form.gst_no} onChange={(e) => setForm({ ...form, gst_no: e.target.value.toUpperCase() })} className="input" maxLength={15} />
          </Row>
          <Row label={t("party.panNo")}>
            <input value={form.pan_no} onChange={(e) => setForm({ ...form, pan_no: e.target.value.toUpperCase() })} className="input" maxLength={10} />
          </Row>
          <Row label={t("party.registrationType")}>
            <select
              value={form.registration_type}
              onChange={(e) => setForm({ ...form, registration_type: e.target.value })}
              className="input"
            >
              <option value="">—</option>
              <option value="regular">{t("party.regular")}</option>
              <option value="composition">{t("party.composition")}</option>
              <option value="unregistered">{t("party.unregistered")}</option>
              <option value="consumer">{t("party.consumer")}</option>
            </select>
          </Row>
          <Row label={t("party.bankName")}>
            <input value={form.bank_name} onChange={(e) => setForm({ ...form, bank_name: e.target.value })} className="input" />
          </Row>
          <Row label={t("party.bankAccountShort")}>
            <input value={form.bank_account_no} onChange={(e) => setForm({ ...form, bank_account_no: e.target.value })} className="input" />
          </Row>
          <Row label={t("party.ifsc")}>
            <input value={form.bank_ifsc} onChange={(e) => setForm({ ...form, bank_ifsc: e.target.value.toUpperCase() })} className="input" />
          </Row>
          <Row label={t("party.notes")} span2>
            <textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              className="input min-h-[60px]"
            />
          </Row>

          {err && <div className="sm:col-span-2 text-sm text-destructive">{err}</div>}

          <div className="sm:col-span-2 flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="rounded-lg border border-border bg-card px-4 py-2 text-sm">
              {t("common.cancel")}
            </button>
            <button
              type="submit"
              disabled={busy}
              className="rounded-lg bg-primary text-primary-foreground px-4 py-2 text-sm disabled:opacity-60"
            >
              {busy ? t("party.saving") : party ? t("party.saveChanges") : t("party.addParty")}
            </button>
          </div>
        </form>
        <style>{`.input { width: 100%; border-radius: 0.5rem; border: 1px solid hsl(var(--border)); background: hsl(var(--card)); padding: 0.5rem 0.75rem; font-size: 0.875rem; outline: none; }
          .input:focus { box-shadow: 0 0 0 2px hsl(var(--ring) / 0.4); }`}</style>
      </div>
    </div>
  );
}

function Row({ label, children, span2 }: { label: string; children: React.ReactNode; span2?: boolean }) {
  return (
    <label className={`block ${span2 ? "sm:col-span-2" : ""}`}>
      <span className="block text-xs uppercase tracking-wider text-muted-foreground mb-1">{label}</span>
      {children}
    </label>
  );
}
