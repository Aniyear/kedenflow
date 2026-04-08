"use client";

import type { Transaction, DebtInfo } from "@/types";

interface Props {
  debt: DebtInfo;
  transactions: Transaction[];
}

function formatAmount(amount: number): string {
  return new Intl.NumberFormat("ru-RU", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Math.abs(amount));
}

export default function DebtSummary({ debt, transactions }: Props) {
  const totalAccrual = transactions
    .filter((t) => t.type === "accrual")
    .reduce((sum, t) => sum + t.amount, 0);

  const totalPayments = transactions
    .filter((t) => t.type !== "accrual")
    .reduce((sum, t) => sum + t.amount, 0);

  const debtClass =
    debt.debt === 0
      ? "debt-card__value--zero"
      : debt.is_overpayment
      ? "debt-card__value--negative"
      : "debt-card__value--positive";

  return (
    <div className="debt-summary">
      <div className="debt-card">
        <div className="debt-card__label">
          {debt.is_overpayment ? "Переплата" : "Текущий долг"}
        </div>
        <div className={`debt-card__value ${debtClass}`}>
          {formatAmount(debt.debt)} ₸
        </div>
      </div>


      <div className="debt-card">
        <div className="debt-card__label">Всего оплачено</div>
        <div className="debt-card__value" style={{ color: "var(--success)" }}>
          {formatAmount(totalPayments)} ₸
        </div>
      </div>

      <div className="debt-card">
        <div className="debt-card__label">Операций</div>
        <div className="debt-card__value" style={{ color: "var(--info)" }}>
          {transactions.length}
        </div>
      </div>
    </div>
  );
}
