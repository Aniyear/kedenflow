"use client";

import { useState } from "react";
import { createTransaction } from "@/lib/api";

interface Props {
  brokerId: string;
  onClose: () => void;
  onSuccess: () => void;
}

export default function AddCashModal({ brokerId, onClose, onSuccess }: Props) {
  const [amount, setAmount] = useState("");
  const [partyFrom, setPartyFrom] = useState("");
  const [datetimeStr, setDatetimeStr] = useState("");
  const [comment, setComment] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    const numAmount = parseFloat(amount);
    if (isNaN(numAmount) || numAmount <= 0) {
      setError("Введите корректную сумму");
      return;
    }

    try {
      setLoading(true);
      setError(null);
      await createTransaction({
        broker_id: brokerId,
        type: "cash",
        amount: numAmount,
        datetime: datetimeStr ? new Date(datetimeStr).toISOString() : new Date().toISOString(),
        party_from: partyFrom.trim() || undefined,
        comment: comment.trim() || undefined,
        source: "manual",
      });
      onSuccess();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Ошибка");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <h2 className="modal__title">💵 Оплата наличными</h2>
          <button className="modal__close" onClick={onClose}>
            ×
          </button>
        </div>

        {error && (
          <div className="receipt-preview__errors">{error}</div>
        )}

        <div className="form-group">
          <label className="form-label" htmlFor="cash-amount">
            Сумма (₸)
          </label>
          <input
            id="cash-amount"
            className="form-input"
            type="number"
            step="0.01"
            min="0.01"
            placeholder="0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            autoFocus
          />
        </div>

        <div className="form-group">
          <label className="form-label" htmlFor="cash-party">
            Отправитель (ФИО или ИИН)
          </label>
          <input
            id="cash-party"
            className="form-input"
            type="text"
            placeholder="Необязательно"
            value={partyFrom}
            onChange={(e) => setPartyFrom(e.target.value)}
          />
        </div>

        <div className="form-group">
          <label className="form-label" htmlFor="cash-datetime">
            Дата и время
          </label>
          <input
            id="cash-datetime"
            className="form-input"
            type="datetime-local"
            value={datetimeStr}
            onChange={(e) => setDatetimeStr(e.target.value)}
          />
          <div className="file-upload__hint" style={{ marginTop: '4px' }}>
            Если не выбрать, запишется текущее время
          </div>
        </div>

        <div className="form-group">
          <label className="form-label" htmlFor="cash-comment">
            Комментарий
          </label>
          <textarea
            id="cash-comment"
            className="form-input"
            placeholder="Необязательно"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
        </div>

        <div className="modal__actions">
          <button className="btn btn--ghost" onClick={onClose}>
            Отмена
          </button>
          <button
            className="btn btn--success"
            onClick={handleSubmit}
            disabled={loading || !amount}
            id="confirm-cash-btn"
          >
            {loading ? <span className="spinner" /> : "Добавить"}
          </button>
        </div>
      </div>
    </div>
  );
}
