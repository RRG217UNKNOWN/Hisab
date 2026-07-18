import { ReceiptText } from "lucide-react";
import { useT } from "@/lib/i18n";

// ---------------------------------------------------------------------------
// Printable invoice — used by Create Bill right after saving a bill, and by
// the Reports → Bills repository (read-only) when opening a past bill.
// Kept as the single invoice renderer per the Section 4 spec.
// ---------------------------------------------------------------------------
export const inr = (n: number) => "₹" + (Math.round(n * 100) / 100).toLocaleString("en-IN");

export type CompletedBill = {
  invoiceNumber: string;
  billType: "sale" | "purchase";
  invoiceDate: string;
  shopName: string;
  partyName: string;
  partyAddress: string;
  partyGstin: string;
  placeOfSupply: string;
  paymentMethod: "cash" | "credit";
  rows: {
    name: string;
    qty: number;
    amt: number;
    disc: number;
    lineTotal: number;
    hsn: string;
    gstRate: number;
    cgst: number;
    sgst: number;
    igst: number;
  }[];
  subtotal: number;
  discountAmount: number;
  totalCgst: number;
  totalSgst: number;
  totalIgst: number;
  grandTotal: number;
};

export function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className={`flex justify-between ${bold ? "font-display text-lg text-ink pt-1" : "text-muted-foreground"}`}>
      <span>{label}</span>
      <span className={`tabular-nums ${bold ? "text-ink" : ""}`}>{value}</span>
    </div>
  );
}

export function InvoiceView({
  bill,
  seller,
}: {
  bill: CompletedBill;
  seller: { name: string; address: string; gstin: string; state: string };
}) {
  const hasGst = !!seller.gstin;
  const { t } = useT();
  return (
    <div className="card-warm p-6 md:p-8 print:shadow-none print:border-none">
      <div className="flex items-start justify-between gap-4 border-b border-border pb-4">
        <div>
          <div className="flex items-center gap-1.5 text-ink font-display text-xl">
            <ReceiptText size={18} className="text-primary" /> {seller.name}
          </div>
          {seller.address && <p className="text-xs text-muted-foreground mt-1">{seller.address}</p>}
          {hasGst && <p className="text-xs text-muted-foreground">{t("inv2.gstin")}: {seller.gstin}</p>}
        </div>
        <div className="text-right text-sm">
          <div className="font-medium text-ink">{bill.invoiceNumber}</div>
          <div className="text-xs text-muted-foreground">
            {new Date(bill.invoiceDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
          </div>
          <div className="text-xs text-muted-foreground capitalize">
            {bill.billType} bill · {bill.paymentMethod}
          </div>
        </div>
      </div>

      <div className="grid sm:grid-cols-2 gap-4 py-4 text-sm">
        <div>
          <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1">
            {bill.billType === "sale" ? t("inv2.billTo") : t("inv2.billFrom")}
          </p>
          <p className="text-ink">{bill.partyName || t("inv2.walkIn")}</p>
          {bill.partyAddress && <p className="text-xs text-muted-foreground">{bill.partyAddress}</p>}
          {hasGst && bill.partyGstin && <p className="text-xs text-muted-foreground">{t("inv2.gstin")}: {bill.partyGstin}</p>}
        </div>
        <div className="sm:text-right">
          <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1">{t("inv2.shop")}</p>
          <p className="text-ink">{bill.shopName}</p>
          {hasGst && bill.placeOfSupply && <p className="text-xs text-muted-foreground">{t("inv2.placeOfSupply")}: {bill.placeOfSupply}</p>}
        </div>
      </div>

      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground border-y border-border">
            <th className="py-2">{t("inv2.item")}</th>
            {hasGst && <th className="py-2">{t("inv2.hsnSac")}</th>}
            <th className="py-2 text-right">{t("inv2.qty")}</th>
            <th className="py-2 text-right">{t("inv2.rate")}</th>
            {hasGst && <th className="py-2 text-right">{t("inv2.gst")}</th>}
            <th className="py-2 text-right">{t("inv2.amount")}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {bill.rows.map((r, i) => (
            <tr key={i}>
              <td className="py-2 text-ink">{r.name}</td>
              {hasGst && <td className="py-2 text-xs text-muted-foreground">{r.hsn || "—"}</td>}
              <td className="py-2 text-right tabular-nums">{r.qty}</td>
              <td className="py-2 text-right tabular-nums">{inr(r.amt)}</td>
              {hasGst && <td className="py-2 text-right tabular-nums">{r.gstRate}%</td>}
              <td className="py-2 text-right tabular-nums">{inr(r.lineTotal)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="pt-4 flex justify-end">
        <div className="w-full max-w-xs space-y-1 text-sm">
          <Row label={t("inv2.subtotal")} value={inr(bill.subtotal)} />
          <Row label={t("inv2.discount")} value={"−" + inr(bill.discountAmount)} />
          {hasGst && bill.totalCgst + bill.totalSgst > 0 && <Row label={t("inv2.cgstSgst")} value={inr(bill.totalCgst + bill.totalSgst)} />}
          {hasGst && bill.totalIgst > 0 && <Row label={t("inv2.igst")} value={inr(bill.totalIgst)} />}
          <Row label={t("inv2.grandTotal")} value={inr(bill.grandTotal)} bold />
        </div>
      </div>

      <div className="mt-10 flex justify-end">
        <div className="text-center text-xs text-muted-foreground">
          <div className="w-40 border-t border-border pt-1">{t("inv2.authorisedSignature")}</div>
        </div>
      </div>
    </div>
  );
}
