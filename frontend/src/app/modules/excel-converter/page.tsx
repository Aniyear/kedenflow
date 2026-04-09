"use client";

import { useState, useCallback, useEffect } from "react";
import Link from "next/link";
import type { ConverterPreview, ConverterProcessResult, AggregationRule } from "@/types";
import { converterPreview, converterProcess, converterDownload } from "@/lib/api";
import ModuleGuard from "@/components/ModuleGuard";

type Step = "upload" | "configure" | "result";

const RULE_LABELS: Record<AggregationRule, string> = {
  sum: "Суммировать",
  unique_join: "Уникальные через запятую",
  first: "Первое значение",
  count: "Кол-во строк",
  skip: "Пропустить",
};

function ConverterContent() {
  const [step, setStep] = useState<Step>("upload");
  const [preview, setPreview] = useState<ConverterPreview | null>(null);
  const [result, setResult] = useState<ConverterProcessResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string>("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedSheet, setSelectedSheet] = useState<string>("");
  const [visibleRows, setVisibleRows] = useState(50);
  const [visibleResultRows, setVisibleResultRows] = useState(50);

  // Configuration
  const [groupByColumn, setGroupByColumn] = useState<string>("");
  const [columnRules, setColumnRules] = useState<Record<string, AggregationRule>>({});
  const [isProcessing, setIsProcessing] = useState(false);

  const handleFileUpload = useCallback(async (file: File) => {
    setError(null);
    setLoading(true);
    setFileName(file.name);

    try {
      setSelectedFile(file);
      const data = await converterPreview(file);
      setPreview(data);
      setSelectedSheet(data.current_sheet);
      setVisibleRows(50);

      // Auto-configure rules based on detected types
      const rules: Record<string, AggregationRule> = {};
      data.columns.forEach((col) => {
        const lowerCol = col.toLowerCase();
        if (lowerCol.includes("price") || lowerCol.includes("цена")) {
          rules[col] = "unique_join";
        } else {
          rules[col] = data.column_types[col] === "numeric" ? "sum" : "unique_join";
        }
      });
      setColumnRules(rules);

      // Smart auto-detect HS Code / ТН ВЭД column for grouping
      const defaultGroupCol = data.columns.find(
        (col) => col.toLowerCase().includes("hs code") || col.toLowerCase().includes("тн вэд")
      ) || data.columns[0] || "";
      setGroupByColumn(defaultGroupCol);
      
      setStep("configure");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to parse file");
    } finally {
      setLoading(false);
    }
  }, []);

  const handleSheetChange = async (sheetName: string) => {
    if (!selectedFile) return;
    setSelectedSheet(sheetName);
    setLoading(true);
    setError(null);
    try {
      const data = await converterPreview(selectedFile, sheetName);
      setPreview(data);
      setVisibleRows(50);
      
      const rules: Record<string, AggregationRule> = {};
      data.columns.forEach((col) => {
        const lowerCol = col.toLowerCase();
        if (lowerCol.includes("price") || lowerCol.includes("цена")) {
          rules[col] = "unique_join";
        } else {
          rules[col] = data.column_types[col] === "numeric" ? "sum" : "unique_join";
        }
      });
      setColumnRules(rules);

      const defaultGroupCol = data.columns.find(
        (col) => col.toLowerCase().includes("hs code") || col.toLowerCase().includes("тн вэд")
      ) || data.columns[0] || "";
      setGroupByColumn(defaultGroupCol);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Не удалось загрузить лист");
    } finally {
      setLoading(false);
    }
  };

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (file) handleFileUpload(file);
    },
    [handleFileUpload]
  );

  // Auto-process on configuration change
  useEffect(() => {
    if (step !== "configure" || !groupByColumn) return;

    const timeoutId = setTimeout(async () => {
      if (!selectedFile) return;
      setIsProcessing(true);
      setError(null);
      try {
        const data = await converterProcess(selectedFile, groupByColumn, columnRules, selectedSheet);
        setResult(data);
        setVisibleResultRows(50);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Ошибка автоматической обработки");
      } finally {
        setIsProcessing(false);
      }
    }, 600); // 600ms debounce

    return () => clearTimeout(timeoutId);
  }, [groupByColumn, columnRules, selectedSheet, step, selectedFile]);

  const handleDownload = async () => {
    if (!selectedFile) return;
    setError(null);
    setLoading(true);

    try {
      await converterDownload(selectedFile, groupByColumn, columnRules, selectedSheet);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Download failed");
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    setStep("upload");
    setPreview(null);
    setResult(null);
    setGroupByColumn("");
    setColumnRules({});
    setFileName("");
    setSelectedFile(null);
    setError(null);
  };

  return (
    <div className="container">
      {/* Header */}
      <header className="header">
        <div className="header__inner">
          <div className="header__logo">
            <Link href="/" className="back-link" style={{ marginRight: "var(--space-sm)" }}>
              ←
            </Link>
            <div
              className="header__logo-icon"
              style={{ background: "linear-gradient(135deg, #10b981, #3b82f6)" }}
            >
              📑
            </div>
            <div>
              <div className="header__title">Excel Конвертер</div>
              <div className="header__subtitle">Группировка данных</div>
            </div>
          </div>
          {step !== "upload" && (
            <button className="btn btn--ghost" onClick={handleReset}>
              🔄 Начать заново
            </button>
          )}
        </div>
      </header>

      {/* Error */}
      {error && (
        <div className="toast toast--error" onClick={() => setError(null)}>
          {error}
        </div>
      )}

      {/* Step 1: Upload */}
      {step === "upload" && (
        <div className="converter-step">
          <div
            className="file-upload"
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDrop}
            onClick={() => {
              const input = document.createElement("input");
              input.type = "file";
              input.accept = ".xlsx,.xls";
              input.onchange = (e) => {
                const file = (e.target as HTMLInputElement).files?.[0];
                if (file) handleFileUpload(file);
              };
              input.click();
            }}
            id="file-upload-zone"
          >
            {loading ? (
              <>
                <span className="spinner" />
                <span className="file-upload__text">Обработка...</span>
              </>
            ) : (
              <>
                <div className="file-upload__icon">📁</div>
                <div className="file-upload__text">
                  Перетащите Excel файл сюда или нажмите для выбора
                </div>
                <div className="file-upload__hint">
                  Поддерживается .xlsx, .xls (до 5 МБ)
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Step 2: Configure & Results (Unified) */}
      {step === "configure" && preview && (
        <div className="converter-step">
          {/* Sheet Selection */}
          {preview.sheets && preview.sheets.length > 1 && (
            <div className="converter-section" style={{ marginBottom: "var(--space-md)", paddingBottom: "var(--space-md)", borderBottom: "1px solid var(--border-color)" }}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">📄 Выберите лист Excel для обработки:</label>
                <select
                  className="form-input"
                  value={selectedSheet}
                  onChange={(e) => handleSheetChange(e.target.value)}
                  disabled={loading || isProcessing}
                >
                  {preview.sheets.map((sheet) => (
                    <option key={sheet} value={sheet}>{sheet}</option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {/* Input preview */}
          <div className="converter-section">
            <h3 className="converter-section__title">
              📋 Лист: {selectedSheet || fileName}
              <span className="converter-section__count">{preview.row_count} строк</span>
            </h3>
            <div className="data-table-wrapper">
              <table className="data-table">
                <thead>
                  <tr>
                    {preview.columns.map((col) => (
                      <th key={col}>{col}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.sample_rows.slice(0, visibleRows).map((row, i) => (
                    <tr key={i}>
                      {row.map((cell, j) => (
                        <td key={j}>{cell}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {preview.sample_rows.length > visibleRows ? (
              <div style={{ textAlign: "center", marginTop: "var(--space-md)" }}>
                <button
                  className="btn btn--ghost"
                  onClick={() => setVisibleRows((prev) => prev + 100)}
                >
                  ➕ Показать еще (+100 строк)
                </button>
              </div>
            ) : preview.row_count > preview.sample_rows.length ? (
              <div className="data-table-more">
                ... предпросмотр ограничен первыми {preview.sample_rows.length} строками
              </div>
            ) : null}
          </div>

          {/* Configuration */}
          <div className="converter-section">
            <h3 className="converter-section__title">⚙️ Настройка группировки</h3>

            <div className="form-group">
              <label className="form-label">Колонка для группировки</label>
              <select
                className="form-input"
                value={groupByColumn}
                onChange={(e) => setGroupByColumn(e.target.value)}
                id="group-by-select"
                disabled={loading || isProcessing}
              >
                {preview.columns.map((col) => (
                  <option key={col} value={col}>
                    {col}
                  </option>
                ))}
              </select>
            </div>

            <div className="rules-grid">
              {preview.columns
                .filter((col) => col !== groupByColumn)
                .map((col) => (
                  <div key={col} className="rule-item">
                    <div className="rule-item__name">
                      {col}
                      <span className="rule-item__type">
                        {preview.column_types[col] === "numeric" ? "🔢" : "📝"}
                      </span>
                    </div>
                    <select
                      className="form-input"
                      value={columnRules[col] || "unique_join"}
                      onChange={(e) =>
                        setColumnRules((prev) => ({
                          ...prev,
                          [col]: e.target.value as AggregationRule,
                        }))
                      }
                      disabled={loading || isProcessing}
                    >
                      {Object.entries(RULE_LABELS).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
            </div>
          </div>

          {/* RESULTS SECTION (Below Configuration) */}
          <div className="converter-section" style={{ borderTop: "2px solid var(--border-active)", paddingTop: "var(--space-xl)", marginTop: "var(--space-2xl)" }}>
            <div className="converter-section__title">
              <h3>✅ Предварительный результат</h3>
              {isProcessing && <div className="spinner" style={{ width: 16, height: 16, marginLeft: "var(--space-sm)" }} />}
            </div>

            {result ? (
              <>
                <div className="converter-stats">
                  <div className="converter-stat">
                    <span className="converter-stat__label">Было строк</span>
                    <span className="converter-stat__value">{result.original_count}</span>
                  </div>
                  <div className="converter-stat converter-stat--arrow">→</div>
                  <div className="converter-stat">
                    <span className="converter-stat__label">Стало строк</span>
                    <span className="converter-stat__value converter-stat__value--success">
                      {result.grouped_count}
                    </span>
                  </div>
                  <div className="converter-stat">
                    <span className="converter-stat__label">Сжатие</span>
                    <span className="converter-stat__value converter-stat__value--accent">
                      {Math.round((1 - result.grouped_count / result.original_count) * 100)}%
                    </span>
                  </div>
                </div>

                <div className="data-table-wrapper">
                  <table className="data-table">
                    <thead>
                      <tr>
                        {result.columns.map((col) => (
                          <th key={col}>{col}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody style={{ opacity: isProcessing ? 0.6 : 1, transition: "opacity 0.2s" }}>
                      {result.preview_rows.slice(0, visibleResultRows).map((row, i) => (
                        <tr key={i}>
                          {row.map((cell, j) => (
                            <td key={j}>{String(cell)}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {result.preview_rows.length > visibleResultRows && (
                  <div style={{ textAlign: "center", marginTop: "var(--space-md)" }}>
                    <button
                      className="btn btn--ghost"
                      onClick={() => setVisibleResultRows((prev) => prev + 100)}
                    >
                      ➕ Показать еще (+100 строк)
                    </button>
                  </div>
                )}

                <div className="converter-actions" style={{ justifyContent: "flex-start", marginTop: "var(--space-xl)" }}>
                  <button
                    className="btn btn--primary btn--lg"
                    onClick={handleDownload}
                    disabled={loading || isProcessing}
                    id="download-btn"
                  >
                    {loading ? <span className="spinner" /> : "📥 Скачать готовый Excel"}
                  </button>
                  <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginLeft: "var(--space-md)", fontStyle: "italic" }}>
                    * Файл будет содержать все данные и полное форматирование
                  </p>
                </div>
              </>
            ) : (
              <div className="empty-state">
                <div className="empty-state__icon">⏳</div>
                <div className="empty-state__text">
                  Выберите колонку для группировки, чтобы увидеть результат
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function ExcelConverterPage() {
  return (
    <ModuleGuard moduleId="excel_converter">
      <ConverterContent />
    </ModuleGuard>
  );
}
