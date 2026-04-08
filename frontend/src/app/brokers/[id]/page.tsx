"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import type { Broker, Transaction, DebtInfo } from "@/types";
import {
  getBrokers,
  getTransactions,
  getDebt,
  deleteTransaction,
  getExportUrl,
} from "@/lib/api";
import TransactionList from "@/components/TransactionList";
import DebtSummary from "@/components/DebtSummary";
import AddAccrualModal from "@/components/AddAccrualModal";
import AddCashModal from "@/components/AddCashModal";
import UploadReceiptModal from "@/components/UploadReceiptModal";

export default function BrokerDetailPage() {
  const params = useParams();
  const brokerId = params.id as string;

  const [broker, setBroker] = useState<Broker | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [debtInfo, setDebtInfo] = useState<DebtInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Modal states
  const [showAccrual, setShowAccrual] = useState(false);
  const [showCash, setShowCash] = useState(false);
  const [showReceipt, setShowReceipt] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const [brokers, txs, debt] = await Promise.all([
        getBrokers(),
        getTransactions(brokerId),
        getDebt(brokerId),
      ]);
      const found = brokers.find((b) => b.id === brokerId);
      setBroker(found || null);
      setTransactions(txs);
      setDebtInfo(debt);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load data");
    } finally {
      setLoading(false);
    }
  }, [brokerId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleDeleteTx = async (id: string) => {
    if (!confirm("Удалить операцию?")) return;
    try {
      await deleteTransaction(id);
      await fetchData();
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "Failed to delete transaction"
      );
    }
  };

  const handleSuccess = () => {
    setShowAccrual(false);
    setShowCash(false);
    setShowReceipt(false);
    fetchData();
  };

  if (loading) {
    return (
      <div className="container">
        <div className="loading-screen">
          <span className="spinner" />
          <span>Загрузка...</span>
        </div>
      </div>
    );
  }

  if (!broker) {
    return (
      <div className="container">
        <div className="empty-state">
          <div className="empty-state__icon">❌</div>
          <p className="empty-state__text">Декларант не найден</p>
          <Link href="/" className="btn btn--ghost">
            ← На главную
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="container">
      {/* Header */}
      <header className="header">
        <div className="header__inner">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" }}>
            <div>
              <Link href="/" className="back-link">
                ← Все декларанты
              </Link>
              <h1>{broker.name}</h1>
            </div>
            <button 
              className="btn btn--ghost btn--sm" 
              onClick={() => window.location.reload()} 
              title="Обновить страницу"
              style={{ padding: '8px', minWidth: 'auto', borderRadius: '50%', color: 'var(--accent)' }}
            >
              🔄
            </button>
          </div>
        </div>
      </header>

      {/* Error toast */}
      {error && (
        <div className="toast toast--error" onClick={() => setError(null)}>
          {error}
        </div>
      )}

      {/* Debt Summary */}
      {debtInfo && <DebtSummary debt={debtInfo} transactions={transactions} />}

      {/* Action Buttons */}
      <div className="action-grid">
        <button
          className="action-btn action-btn--accrual"
          onClick={() => setShowAccrual(true)}
          id="add-accrual-btn"
        >
          <span className="action-btn__icon">📝</span>
          <span className="action-btn__label">Начисление</span>
        </button>

        <button
          className="action-btn action-btn--receipt"
          onClick={() => setShowReceipt(true)}
          id="upload-receipt-btn"
        >
          <span className="action-btn__icon">📄</span>
          <span className="action-btn__label">Загрузить чек</span>
        </button>

        <button
          className="action-btn action-btn--cash"
          onClick={() => setShowCash(true)}
          id="add-cash-btn"
        >
          <span className="action-btn__icon">💵</span>
          <span className="action-btn__label">Наличные</span>
        </button>
      </div>

      {/* Transaction List */}
      <div className="section-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <h2>Операции</h2>
          <span style={{ color: "var(--text-muted)", fontSize: "0.875rem" }}>
            {transactions.length} шт.
          </span>
        </div>
        <a 
          href={getExportUrl(brokerId)} 
          className="btn btn--ghost" 
          style={{ fontSize: '0.875rem', display: 'flex', alignItems: 'center', gap: '6px' }}
          download
        >
          📊 Выгрузить в Excel
        </a>
      </div>

      <TransactionList
        transactions={transactions}
        onDelete={handleDeleteTx}
      />

      {/* Modals */}
      {showAccrual && (
        <AddAccrualModal
          brokerId={brokerId}
          onClose={() => setShowAccrual(false)}
          onSuccess={handleSuccess}
        />
      )}

      {showCash && (
        <AddCashModal
          brokerId={brokerId}
          onClose={() => setShowCash(false)}
          onSuccess={handleSuccess}
        />
      )}

      {showReceipt && (
        <UploadReceiptModal
          brokerId={brokerId}
          onClose={() => setShowReceipt(false)}
          onSuccess={handleSuccess}
        />
      )}
    </div>
  );
}
