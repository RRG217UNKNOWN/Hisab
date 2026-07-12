import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";

export const Route = createFileRoute("/requests")({
  component: RequestsPage,
  head: () => ({ meta: [{ title: "Requests · Hisab" }] }),
});

function RequestsPage() {
  return (
    <AppShell active="requests" title="Requests">
      <div className="px-4 md:px-10 py-6 md:py-8 max-w-3xl space-y-4">
        <header>
          <p className="text-xs uppercase tracking-widest text-muted-foreground">cross-org purchase requests</p>
          <h1 className="mt-1 font-display text-3xl md:text-4xl text-ink">Requests</h1>
        </header>
        <div className="card-warm p-6 text-sm text-muted-foreground">
          The <code>requests</code> table and its RLS policies are ready. The Sent/Received/Fulfil flow lands next
          iteration once Create Bill is wired up (fulfillment reuses the same invoice builder).
        </div>
      </div>
    </AppShell>
  );
}
