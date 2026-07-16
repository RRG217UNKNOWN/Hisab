import { useEffect, useRef, useState } from "react";
import { Share2, MessageCircle, Phone, Mail } from "lucide-react";
import { useT } from "@/lib/i18n";
import { inr, type CompletedBill } from "@/components/InvoiceView";

// ---------------------------------------------------------------------------
// Share menu for a completed invoice — used right after saving a bill (Create
// Bill) and when opening a past bill (Reports → Bills). Renders as a button
// matching the neighbouring "New bill" / "Close" buttons, with a small popover
// offering WhatsApp, phone (SMS) and Gmail sharing.
// ---------------------------------------------------------------------------

function buildShareText(bill: CompletedBill, sellerName: string) {
  const lines = [
    sellerName,
    `Invoice: ${bill.invoiceNumber}`,
    `Date: ${new Date(bill.invoiceDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}`,
    bill.partyName ? `${bill.billType === "sale" ? "Bill to" : "Bill from"}: ${bill.partyName}` : "",
    "",
    ...bill.rows.map((r) => `${r.name} x${r.qty} - ${inr(r.lineTotal)}`),
    "",
    `Total: ${inr(bill.grandTotal)}`,
  ].filter(Boolean);
  return lines.join("\n");
}

export function ShareBillMenu({
  bill,
  seller,
  className,
  align = "left",
}: {
  bill: CompletedBill;
  seller: { name: string };
  className?: string;
  align?: "left" | "right";
}) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<null | "sms">(null);
  const [phone, setPhone] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
        setMode(null);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  const closeMenu = () => {
    setOpen(false);
    setMode(null);
    setPhone("");
  };

  const shareWhatsapp = () => {
    const text = buildShareText(bill, seller.name);
    window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`, "_blank", "noopener,noreferrer");
    closeMenu();
  };

  const shareGmail = () => {
    const text = buildShareText(bill, seller.name);
    const subject = `Invoice ${bill.invoiceNumber} — ${seller.name}`;
    window.open(
      `https://mail.google.com/mail/?view=cm&fs=1&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}`,
      "_blank",
      "noopener,noreferrer",
    );
    closeMenu();
  };

  const sendSms = () => {
    if (!phone.trim()) return;
    const text = buildShareText(bill, seller.name);
    window.location.href = `sms:${phone.trim()}?&body=${encodeURIComponent(text)}`;
    closeMenu();
  };

  return (
    <div className="relative print:hidden" ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={className ?? "inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-4 py-2 text-sm"}
      >
        <Share2 size={14} /> {t("inv2.share")}
      </button>

      {open && (
        <div
          className={`absolute z-20 bottom-full mb-2 w-60 rounded-xl border border-border bg-popover text-popover-foreground shadow-lg p-1.5 ${
            align === "right" ? "right-0" : "left-0"
          }`}
        >
          {mode === "sms" ? (
            <div className="p-1.5 space-y-2">
              <label className="block text-xs text-muted-foreground px-0.5">{t("inv2.enterPhone")}</label>
              <input
                autoFocus
                type="tel"
                inputMode="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="98765 43210"
                className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus:ring-1 focus:ring-primary"
                onKeyDown={(e) => e.key === "Enter" && sendSms()}
              />
              <div className="flex gap-1.5">
                <button
                  type="button"
                  onClick={sendSms}
                  disabled={!phone.trim()}
                  className="flex-1 rounded-full bg-primary text-primary-foreground px-3 py-1.5 text-xs disabled:opacity-50"
                >
                  {t("inv2.sendSms")}
                </button>
                <button
                  type="button"
                  onClick={() => setMode(null)}
                  className="rounded-full border border-border px-3 py-1.5 text-xs"
                >
                  {t("common.cancel")}
                </button>
              </div>
            </div>
          ) : (
            <>
              <button
                type="button"
                onClick={shareWhatsapp}
                className="w-full flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-left hover:bg-accent"
              >
                <MessageCircle size={16} className="text-primary" /> {t("inv2.shareWhatsapp")}
              </button>
              <button
                type="button"
                onClick={() => setMode("sms")}
                className="w-full flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-left hover:bg-accent"
              >
                <Phone size={16} className="text-primary" /> {t("inv2.sharePhone")}
              </button>
              <button
                type="button"
                onClick={shareGmail}
                className="w-full flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-left hover:bg-accent"
              >
                <Mail size={16} className="text-primary" /> {t("inv2.shareGmail")}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
