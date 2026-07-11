import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";

export const Route = createFileRoute("/create-bill")({
  component: CreateBillPage,
  head: () => ({ meta: [{ title: "Create Bill · Hisab" }] }),
});

function CreateBillPage() {
  return (
    <AppShell active="createBill" title="Create Bill">
      <div className="px-4 md:px-10 py-6 md:py-8 max-w-3xl space-y-4">
        <header>
          <p className="text-xs uppercase tracking-widest text-muted-foreground">GST-compliant invoicing</p>
          <h1 className="mt-1 font-display text-3xl md:text-4xl text-ink">Create Bill</h1>
        </header>
        <div className="card-warm p-6 text-sm text-muted-foreground">
          The full GST-compliant billing UI (Sale/Supplier toggle, party picker, line-item GST split, printable invoice)
          uses the <code>bills</code>, <code>bill_items</code>, and <code>bill_counters</code> tables that were just created.
          This shell is here so the route resolves — the interactive builder lands in the next iteration.
        </div>
      </div>
    </AppShell>
  );
}
