// ---------------------------------------------------------------------------
// Simplified, single-period accounting aggregation.
//
// This intentionally is NOT a general ledger with opening/closing balances —
// the app doesn't keep one. Instead every figure here is derived from the
// same three sources Reports already reads (sales, purchases/expenses, and
// the Section 2 party ledger) for the selected shop + date range, so the
// four aggregate statements always agree with each other and with the P&L
// tab's revenue/COGS/expense numbers.
//
// Cash is a *plug*: since there's no real cash account in the schema, it's
// derived from the standard accounting identity (Assets = Liabilities +
// Equity) rather than tracked transaction-by-transaction. That keeps the
// Trial Balance and Balance Sheet balanced by construction, which is the
// most a "simplified, not a certified accounting document" statement can
// honestly claim — hence the disclaimer banner shown alongside all four.
// ---------------------------------------------------------------------------

export type AccountingInputs = {
  revenue: number; // from `sales` — same figure P&L calls "revenue"
  cogs: number; // from `sales` — same figure P&L calls "cogs"
  purchasesTotal: number; // from `bills` where bill_type = 'purchase'
  expensesTotal: number; // from `expenses`, actual amounts in the selected range
  receivable: number; // net outstanding from party_ledger, direction = 'receivable'
  payable: number; // net outstanding from party_ledger, direction = 'payable'
};

export type LedgerLine = { account: string; debit: number; credit: number };

export type AccountingSummary = {
  revenue: number;
  cogs: number;
  purchasesTotal: number;
  expensesTotal: number;
  grossProfit: number;
  netProfit: number;
  receivable: number;
  payable: number;
  /** Plugged cash position — see module note above. */
  cash: number;
  trialBalance: LedgerLine[];
  trialBalanceTotals: { debit: number; credit: number };
  balanceSheet: {
    assets: { cash: number; receivable: number; total: number };
    liabilities: { payable: number; overdraft: number; total: number };
    equity: { netProfit: number; total: number };
  };
  cashFlow: {
    netProfit: number;
    payableIncrease: number;
    receivableIncrease: number;
    netCash: number;
  };
};

export function computeAccounting(inputs: AccountingInputs): AccountingSummary {
  const { revenue, cogs, purchasesTotal, expensesTotal, receivable, payable } = inputs;

  const grossProfit = revenue - cogs;
  // Purchases are treated as a period cost here (not carried as inventory
  // asset value) — a deliberate simplification, called out in the banner.
  const netProfit = grossProfit - expensesTotal - purchasesTotal;

  // Assets = Liabilities + Equity  =>  Cash = Payable + NetProfit - Receivable
  const cash = payable + netProfit - receivable;
  const overdraft = cash < 0 ? -cash : 0;
  const cashAsset = cash > 0 ? cash : 0;

  const trialBalance: LedgerLine[] = [
    { account: "Cash", debit: cashAsset, credit: 0 },
    { account: "Accounts receivable", debit: receivable, credit: 0 },
    { account: "Cost of goods sold", debit: cogs, credit: 0 },
    { account: "Purchases", debit: purchasesTotal, credit: 0 },
    { account: "Operating expenses", debit: expensesTotal, credit: 0 },
    { account: "Bank overdraft", debit: 0, credit: overdraft },
    { account: "Accounts payable", debit: 0, credit: payable },
    { account: "Sales revenue", debit: 0, credit: revenue },
  ].filter((l) => l.debit !== 0 || l.credit !== 0);

  const trialBalanceTotals = trialBalance.reduce(
    (acc, l) => ({ debit: acc.debit + l.debit, credit: acc.credit + l.credit }),
    { debit: 0, credit: 0 },
  );

  const balanceSheet = {
    assets: { cash: cashAsset, receivable, total: cashAsset + receivable },
    liabilities: { payable, overdraft, total: payable + overdraft },
    equity: { netProfit, total: netProfit },
  };

  const cashFlow = {
    netProfit,
    payableIncrease: payable,
    receivableIncrease: receivable,
    netCash: cash,
  };

  return {
    revenue,
    cogs,
    purchasesTotal,
    expensesTotal,
    grossProfit,
    netProfit,
    receivable,
    payable,
    cash,
    trialBalance,
    trialBalanceTotals,
    balanceSheet,
    cashFlow,
  };
}
