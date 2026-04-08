"use client";

import { useState } from "react";
import type { ReceiptParseResult, TransactionCreate } from "@/types";
import { bulkUploadReceipts, bulkCreateTransactions } from "@/lib/api";

interface Props {
  brokerId: string;
  onClose: () => void;
  onSuccess: () => void;
}

export default function UploadReceiptModal({
  brokerId,
  onClose,
  onSuccess,
}: Props) {
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [previews, setPreviews] = useState<ReceiptParseResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedList = Array.from(e.target.files || []);
    const pdfs = selectedList.filter((f) =>
      f.name.toLowerCase().endsWith(".pdf")
    );
    if (pdfs.length === 0) {
      if (selectedList.length > 0) setError("Только PDF файлы");
      return;
    }
    setFiles(pdfs);
    setPreviews(null);
    setError(null);
  };

  const handleUpload = async () => {
    if (files.length === 0) return;
    try {
      setUploading(true);
      setError(null);
      const results = await bulkUploadReceipts(files);
      setPreviews(results);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Ошибка загрузки чеков");
    } finally {
      setUploading(false);
    }
  };

  const updateField = (
    index: number,
    field: keyof ReceiptParseResult,
    value: unknown
  ) => {
    setPreviews((prev) =>
      prev
        ? prev.map((p, i) => (i === index ? { ...p, [field]: value } : p))
        : null
    );
  };

  const handleSaveAll = async () => {
    if (!previews || previews.length === 0) return;

    // Filter out rows that have critical errors (like empty text)
    const validPreviews = previews.filter(p => !p.errors || p.errors.length === 0);

    if (validPreviews.length === 0) {
      setError("Нет валидных чеков для сохранения. Проверьте ошибки в таблице.");
      return;
    }

    // Validate that all valid ones have a positive amount
    const invalidIdx = validPreviews.findIndex((p) => !p.amount || p.amount <= 0);
    if (invalidIdx !== -1) {
      setError(`Ошибка в строке ${invalidIdx + 1}: Укажите сумму > 0`);
      return;
    }

    try {
      setSaving(true);
      setError(null);

      const bulkData: TransactionCreate[] = validPreviews.map((data) => ({
        broker_id: brokerId,
        type: data.type,
        amount: data.amount as number,
        datetime: data.datetime || new Date().toISOString(),
        receipt_number: data.receipt_number || undefined,
        party_from: data.party_from || undefined,
        party_to: data.party_to || undefined,
        kbk: data.kbk || undefined,
        knp: data.knp || undefined,
        comment: data.comment || undefined,
        source: "receipt",
        raw_text: data.raw_text || undefined,
      }));

      await bulkCreateTransactions(bulkData);
      onSuccess();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Ошибка сохранения");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal"
        style={{ maxWidth: previews ? "95vw" : "600px", width: "100%" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal__header">
          <h2 className="modal__title">
            📄 Загрузить чеки (Выбрано: {files.length})
          </h2>
          <button className="modal__close" onClick={onClose}>
            ×
          </button>
        </div>

        {error && <div className="receipt-preview__errors">{error}</div>}

        {/* File Upload Form */}
        {!previews && (
          <>
            <label className="file-upload" htmlFor="receipt-file-input">
              <div className="file-upload__icon">📁</div>
              <div className="file-upload__text">
                {files.length > 0
                  ? `Выбрано файлов: ${files.length}`
                  : "Выберите один или несколько PDF"}
              </div>
              <div className="file-upload__hint">Можно выделить сразу много</div>
              <input
                id="receipt-file-input"
                type="file"
                multiple
                accept=".pdf,application/pdf"
                onChange={handleFileChange}
                style={{ display: "none" }}
              />
            </label>

            <div className="modal__actions">
              <button className="btn btn--ghost" onClick={onClose}>
                Отмена
              </button>
              <button
                className="btn btn--primary"
                onClick={handleUpload}
                disabled={files.length === 0 || uploading}
              >
                {uploading ? (
                  <span className="spinner" />
                ) : (
                  "Распознать документы"
                )}
              </button>
            </div>
          </>
        )}

        {/* Bulk Table Preview & Edit */}
        {previews && (
          <div className="bulk-preview-wrapper" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ overflowX: "auto", maxHeight: "60vh", border: "1px solid var(--border)", borderRadius: "8px" }}>
              <table style={{ minWidth: "1200px", width: "100%", borderCollapse: "collapse", fontSize: "0.875rem" }}>
                <thead>
                  <tr style={{ background: "var(--bg-secondary)", borderBottom: "1px solid var(--border)", textAlign: "left" }}>
                    <th style={{ padding: "12px", borderRight: "1px solid var(--border)", position: 'sticky', top: 0, background: 'var(--bg-secondary)', zIndex: 1 }}>Тип</th>
                    <th style={{ padding: "12px", borderRight: "1px solid var(--border)", position: 'sticky', top: 0, background: 'var(--bg-secondary)', zIndex: 1, minWidth: "100px" }}>№ чека</th>
                    <th style={{ padding: "12px", borderRight: "1px solid var(--border)", position: 'sticky', top: 0, background: 'var(--bg-secondary)', zIndex: 1, minWidth: "120px" }}>Сумма (₸)</th>
                    <th style={{ padding: "12px", borderRight: "1px solid var(--border)", position: 'sticky', top: 0, background: 'var(--bg-secondary)', zIndex: 1 }}>Дата</th>
                    <th style={{ padding: "12px", borderRight: "1px solid var(--border)", position: 'sticky', top: 0, background: 'var(--bg-secondary)', zIndex: 1, minWidth: "150px" }}>Отправитель</th>
                    <th style={{ padding: "12px", borderRight: "1px solid var(--border)", position: 'sticky', top: 0, background: 'var(--bg-secondary)', zIndex: 1, minWidth: "150px" }}>Получатель</th>
                    <th style={{ padding: "12px", borderRight: "1px solid var(--border)", position: 'sticky', top: 0, background: 'var(--bg-secondary)', zIndex: 1, minWidth: "150px" }}>Комментарий</th>
                    <th style={{ padding: "12px", borderRight: "1px solid var(--border)", position: 'sticky', top: 0, background: 'var(--bg-secondary)', zIndex: 1, minWidth: "180px" }}>КБК / Описание</th>
                    <th style={{ padding: "12px", position: 'sticky', top: 0, background: 'var(--bg-secondary)', zIndex: 1, minWidth: "150px" }}>КНП</th>
                  </tr>
                </thead>
                <tbody>
                  {previews.map((p, i) => (
                    <tr key={i} style={{ borderBottom: "1px solid var(--border)", backgroundColor: p.errors && p.errors.length > 0 ? "rgba(239,68,68,0.1)" : "transparent" }}>
                      <td style={{ padding: "8px", borderRight: "1px solid var(--border)" }}>
                        {p.type === "payment" ? "Оплата" : "Перевод"}
                        {p.errors && p.errors.length > 0 && <div style={{color:'var(--danger)', fontSize:'10px', marginTop:'4px'}}>⚠ Ошибка</div>}
                      </td>
                      <td style={{ padding: "8px", borderRight: "1px solid var(--border)" }}>
                        <input
                          type="text"
                          style={{ width: "100%", padding: "4px 8px", border: "1px solid var(--border)", borderRadius: "4px" }}
                          value={p.receipt_number ?? ""}
                          onChange={(e) => updateField(i, "receipt_number", e.target.value || null)}
                        />
                      </td>
                      <td style={{ padding: "8px", borderRight: "1px solid var(--border)" }}>
                        <input
                          type="number"
                          step="0.01"
                          style={{ width: "100%", padding: "4px 8px", border: "1px solid var(--border)", borderRadius: "4px" }}
                          value={p.amount ?? ""}
                          onChange={(e) => updateField(i, "amount", e.target.value ? parseFloat(e.target.value) : null)}
                        />
                        {p.amount !== null && p.amount !== undefined && (
                          <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px', textAlign: 'right' }}>
                            {p.amount.toLocaleString('ru-RU')} ₸
                          </div>
                        )}
                      </td>
                      <td style={{ padding: "8px", borderRight: "1px solid var(--border)" }}>
                        <input
                          type="datetime-local"
                          style={{ width: "100%", padding: "4px 8px", border: "1px solid var(--border)", borderRadius: "4px" }}
                          value={p.datetime ? p.datetime.slice(0, 16) : ""}
                          onChange={(e) => updateField(i, "datetime", e.target.value ? new Date(e.target.value).toISOString() : null)}
                        />
                      </td>
                      <td style={{ padding: "8px", borderRight: "1px solid var(--border)" }}>
                        <input
                          type="text"
                          style={{ width: "100%", padding: "4px 8px", border: "1px solid var(--border)", borderRadius: "4px" }}
                          value={p.party_from ?? ""}
                          onChange={(e) => updateField(i, "party_from", e.target.value || null)}
                        />
                      </td>
                      <td style={{ padding: "8px", borderRight: "1px solid var(--border)" }}>
                        <input
                          type="text"
                          style={{ width: "100%", padding: "4px 8px", border: "1px solid var(--border)", borderRadius: "4px" }}
                          value={p.party_to ?? ""}
                          onChange={(e) => updateField(i, "party_to", e.target.value || null)}
                        />
                      </td>
                      <td style={{ padding: "8px", borderRight: "1px solid var(--border)" }}>
                        <input
                          type="text"
                          style={{ width: "100%", padding: "4px 8px", border: "1px solid var(--border)", borderRadius: "4px" }}
                          value={p.comment ?? ""}
                          onChange={(e) => updateField(i, "comment", e.target.value || null)}
                        />
                      </td>
                      <td style={{ padding: "8px", borderRight: "1px solid var(--border)" }}>
                        <input
                          type="text"
                          style={{ width: "100%", padding: "4px 8px", border: "1px solid var(--border)", borderRadius: "4px" }}
                          value={p.kbk ?? ""}
                          onChange={(e) => updateField(i, "kbk", e.target.value || null)}
                        />
                      </td>
                      <td style={{ padding: "8px" }}>
                        <input
                          type="text"
                          style={{ width: "100%", padding: "4px 8px", border: "1px solid var(--border)", borderRadius: "4px" }}
                          value={p.knp ?? ""}
                          onChange={(e) => updateField(i, "knp", e.target.value || null)}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="modal__actions">
              <button className="btn btn--ghost" onClick={() => { setPreviews(null); setFiles([]); }}>
                Отмена
              </button>
              <button
                className="btn btn--success"
                onClick={handleSaveAll}
                disabled={saving}
              >
                {saving ? "Сохранение..." : `Сохранить всё (${previews.length})`}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
