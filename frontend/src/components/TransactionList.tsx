"use client";

import { useState } from "react";
import type { Transaction } from "@/types";

interface Props {
  transactions: Transaction[];
  onDelete: (id: string) => void;
}

const TYPE_LABELS: Record<string, string> = {
  accrual: "Начисление",
  payment: "Оплата",
  transfer: "Перевод",
  cash: "Наличные",
};

const TYPE_ICONS: Record<string, string> = {
  accrual: "📝",
  payment: "💳",
  transfer: "🔄",
  cash: "💵",
};

function formatAmount(amount: number): string {
  return new Intl.NumberFormat("ru-RU", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export default function TransactionList({ transactions, onDelete }: Props) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (transactions.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-state__icon">📋</div>
        <p className="empty-state__text">Нет операций</p>
      </div>
    );
  }

  const toggleExpand = (id: string) => {
    setExpandedId(expandedId === id ? null : id);
  };

  return (
    <div className="tx-list">
      {transactions.map((tx, i) => {
        const isAccrual = tx.type === "accrual";
        const isExpanded = expandedId === tx.id;
        
        // Short subtitle for collapsed view
        const subtitle = [
          tx.receipt_number && `№ ${tx.receipt_number}`,
          tx.party_from && `от: ${tx.party_from}`,
        ].filter(Boolean).join(" · ");

        return (
          <div
            key={tx.id}
            className="card animate-in"
            style={{ animationDelay: `${i * 0.03}s`, marginBottom: '12px', padding: 0, overflow: 'hidden' }}
            id={`tx-item-${tx.id}`}
          >
            {/* Clickable Header */}
            <div 
              className="tx-item" 
              onClick={() => toggleExpand(tx.id)} 
              style={{ padding: '16px', background: 'transparent', margin: 0, cursor: 'pointer', border: 'none' }}
            >
              <div className={`tx-item__type tx-item__type--${tx.type}`}>
                {TYPE_ICONS[tx.type]}
              </div>

              <div className="tx-item__info">
                <div className="tx-item__title" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  {TYPE_LABELS[tx.type]}
                  {tx.source === "receipt" && <span title="Из чека">📄</span>}
                </div>
                <div className="tx-item__subtitle">
                  {formatDate(tx.datetime)}
                  {subtitle ? ` · ${subtitle}` : ""}
                </div>
              </div>

              <div
                className={`tx-item__amount ${
                  isAccrual ? "tx-item__amount--positive" : "tx-item__amount--negative"
                }`}
              >
                {isAccrual ? "+" : "−"}{formatAmount(tx.amount)} ₸
              </div>

              <button
                className="btn btn--danger btn--sm"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(tx.id);
                }}
                title="Удалить"
                id={`delete-tx-${tx.id}`}
                style={{ marginLeft: '12px' }}
              >
                ✕
              </button>
            </div>

            {/* Expanded Details */}
            {isExpanded && (
              <div 
                className="tx-details animate-in" 
                style={{ padding: '0 16px 16px 64px', fontSize: '0.875rem', color: 'var(--text-secondary)' }}
              >
                {tx.party_from && <div style={{ marginBottom: '4px' }}><strong>Отправитель:</strong> {tx.party_from}</div>}
                {tx.party_to && <div style={{ marginBottom: '4px' }}><strong>Получатель:</strong> {tx.party_to}</div>}
                {tx.party_identifier && <div style={{ marginBottom: '4px' }}><strong>ИИН/БИН:</strong> {tx.party_identifier}</div>}
                {tx.kbk && <div style={{ marginBottom: '4px' }}><strong>КБК:</strong> {tx.kbk}</div>}
                {tx.knp && <div style={{ marginBottom: '4px' }}><strong>КНП:</strong> {tx.knp}</div>}
                {tx.receipt_number && <div style={{ marginBottom: '4px' }}><strong>№ Документа:</strong> {tx.receipt_number}</div>}
                {tx.comment && <div style={{ marginBottom: '4px' }}><strong>Комментарий:</strong> {tx.comment}</div>}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
