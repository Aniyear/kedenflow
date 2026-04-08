"use client";

import { useState } from "react";
import type { ReceiptParseResult } from "@/types";

interface Props {
  data: ReceiptParseResult;
  onSave: (data: ReceiptParseResult) => void;
  onCancel: () => void;
  saving: boolean;
}

export default function ReceiptPreview({
  data,
  onSave,
  onCancel,
  saving,
}: Props) {
  const [editData, setEditData] = useState<ReceiptParseResult>({ ...data });

  const updateField = (field: keyof ReceiptParseResult, value: unknown) => {
    setEditData((prev) => ({ ...prev, [field]: value }));
  };

  return (
    <div className="receipt-preview">
      <div className="receipt-preview__header">
        <span>Распознанные данные</span>
        <span
          className={`receipt-preview__badge receipt-preview__badge--${editData.type}`}
        >
          {editData.type === "payment" ? "Оплата" : "Перевод"}
        </span>
      </div>

      {data.errors.length > 0 && (
        <div className="receipt-preview__errors">
          ⚠️ {data.errors.join("; ")}
          <br />
          Проверьте и исправьте данные вручную.
        </div>
      )}

      <div className="form-row">
        <div className="form-group">
          <label className="form-label">Сумма (₸)</label>
          <input
            className="form-input"
            type="number"
            step="0.01"
            value={editData.amount ?? ""}
            onChange={(e) =>
              updateField("amount", e.target.value ? parseFloat(e.target.value) : null)
            }
          />
        </div>
        <div className="form-group">
          <label className="form-label">Дата/время</label>
          <input
            className="form-input"
            type="datetime-local"
            value={
              editData.datetime
                ? editData.datetime.slice(0, 16)
                : ""
            }
            onChange={(e) =>
              updateField(
                "datetime",
                e.target.value ? new Date(e.target.value).toISOString() : null
              )
            }
          />
        </div>
      </div>

      <div className="form-group">
        <label className="form-label">№ чека</label>
        <input
          className="form-input"
          type="text"
          value={editData.receipt_number ?? ""}
          onChange={(e) => updateField("receipt_number", e.target.value || null)}
        />
      </div>

      <div className="form-row">
        <div className="form-group">
          <label className="form-label">Отправитель</label>
          <input
            className="form-input"
            type="text"
            value={editData.party_from ?? ""}
            onChange={(e) => updateField("party_from", e.target.value || null)}
          />
        </div>
        <div className="form-group">
          <label className="form-label">Получатель</label>
          <input
            className="form-input"
            type="text"
            value={editData.party_to ?? ""}
            onChange={(e) => updateField("party_to", e.target.value || null)}
          />
        </div>
      </div>

      {editData.type === "payment" && (
        <>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">КБК</label>
              <input
                className="form-input"
                type="text"
                value={editData.kbk ?? ""}
                onChange={(e) => updateField("kbk", e.target.value || null)}
              />
            </div>
            <div className="form-group">
              <label className="form-label">КНП</label>
              <input
                className="form-input"
                type="text"
                value={editData.knp ?? ""}
                onChange={(e) => updateField("knp", e.target.value || null)}
              />
            </div>
          </div>
        </>
      )}

      <div className="modal__actions">
        <button className="btn btn--ghost" onClick={onCancel}>
          ← Назад
        </button>
        <button
          className="btn btn--success"
          onClick={() => onSave(editData)}
          disabled={saving || !editData.amount}
          id="save-receipt-btn"
        >
          {saving ? <span className="spinner" /> : "Сохранить операцию"}
        </button>
      </div>
    </div>
  );
}
