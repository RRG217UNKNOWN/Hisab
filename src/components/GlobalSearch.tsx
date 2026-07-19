import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Search, Package, Users, Wallet, Loader2, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useT } from "@/lib/i18n";

type ProductHit = { id: string; name: string; category: string; stock: number };
type PartyHit = { id: string; name: string; type: string; phone: string | null };
type ExpenseHit = { id: string; label: string; amount: number };

export function GlobalSearch({ className }: { className?: string }) {
  const navigate = useNavigate();
  const { t, tf } = useT();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [products, setProducts] = useState<ProductHit[]>([]);
  const [parties, setParties] = useState<PartyHit[]>([]);
  const [expenses, setExpenses] = useState<ExpenseHit[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestId = useRef(0);

  // Close the results panel on outside click.
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  // Debounced search across products, vendors/customers and expenses.
  useEffect(() => {
    const q = query.trim();
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (!q) {
      setProducts([]);
      setParties([]);
      setExpenses([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const myId = ++requestId.current;
    debounceRef.current = setTimeout(async () => {
      const like = `%${q}%`;
      const [productsRes, partiesRes, expensesRes] = await Promise.all([
        supabase.from("inventory_items").select("id, name, category, stock").ilike("name", like).limit(6),
        supabase.from("parties").select("id, name, type, phone").ilike("name", like).limit(6),
        supabase.from("expenses").select("id, label, amount").ilike("label", like).limit(6),
      ]);

      if (myId !== requestId.current) return; // a newer search superseded this one

      setProducts(productsRes.data ?? []);
      setParties(partiesRes.data ?? []);
      setExpenses(expensesRes.data ?? []);
      setLoading(false);
    }, 250);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  const hasResults = products.length + parties.length + expenses.length > 0;
  const showPanel = open && query.trim().length > 0;

  function reset() {
    setOpen(false);
    setQuery("");
  }

  function goToProduct(p: ProductHit) {
    reset();
    navigate({ to: "/inventory", search: { q: p.name } });
  }

  function goToParty(p: PartyHit) {
    reset();
    navigate({ to: "/parties/$id", params: { id: p.id } });
  }

  function goToExpense() {
    reset();
    navigate({ to: "/expenses" });
  }

  return (
    <div ref={containerRef} className={"relative " + (className ?? "")}>
      <Search
        size={16}
        className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
      />
      <input
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder={t("common.search")}
        className="w-full rounded-lg border border-border bg-card pl-9 pr-8 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/40"
      />
      {query && (
        <button
          onClick={reset}
          aria-label={t("common.close")}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
        >
          <X size={14} />
        </button>
      )}

      {showPanel && (
        <div className="absolute left-0 right-0 z-40 mt-2 max-h-[70vh] overflow-y-auto rounded-lg border border-border bg-popover shadow-lg">
          {loading ? (
            <div className="flex items-center gap-2 px-4 py-4 text-sm text-muted-foreground">
              <Loader2 size={14} className="animate-spin" /> {t("common.loading")}
            </div>
          ) : !hasResults ? (
            <div className="px-4 py-4 text-sm text-muted-foreground">{t("search.noResults")}</div>
          ) : (
            <div className="py-2">
              {products.length > 0 && (
                <ResultGroup label={t("search.products")}>
                  {products.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => goToProduct(p)}
                      className="w-full flex items-center gap-3 px-4 py-2 text-left hover:bg-muted"
                    >
                      <Package size={15} className="text-muted-foreground shrink-0" />
                      <span className="flex-1 min-w-0 truncate text-sm text-ink">{p.name}</span>
                      <span className="text-xs text-muted-foreground shrink-0">
                        {tf("search.inStock", { n: p.stock })}
                      </span>
                    </button>
                  ))}
                </ResultGroup>
              )}
              {parties.length > 0 && (
                <ResultGroup label={t("search.parties")}>
                  {parties.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => goToParty(p)}
                      className="w-full flex items-center gap-3 px-4 py-2 text-left hover:bg-muted"
                    >
                      <Users size={15} className="text-muted-foreground shrink-0" />
                      <span className="flex-1 min-w-0 truncate text-sm text-ink">{p.name}</span>
                      <span className="text-xs text-muted-foreground shrink-0 capitalize">{p.type}</span>
                    </button>
                  ))}
                </ResultGroup>
              )}
              {expenses.length > 0 && (
                <ResultGroup label={t("search.expenses")}>
                  {expenses.map((e) => (
                    <button
                      key={e.id}
                      onClick={goToExpense}
                      className="w-full flex items-center gap-3 px-4 py-2 text-left hover:bg-muted"
                    >
                      <Wallet size={15} className="text-muted-foreground shrink-0" />
                      <span className="flex-1 min-w-0 truncate text-sm text-ink">{e.label}</span>
                    </button>
                  ))}
                </ResultGroup>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ResultGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-border/60 last:border-b-0 pb-1 last:pb-0">
      <div className="px-4 pt-2 pb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      {children}
    </div>
  );
}
