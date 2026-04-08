"use client";

import { useEffect, useState } from "react";
import type { Broker } from "@/types";
import { getBrokers, createBroker, deleteBroker } from "@/lib/api";
import BrokerCard from "@/components/BrokerCard";

export default function HomePage() {
  const [brokers, setBrokers] = useState<Broker[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchBrokers = async () => {
    try {
      setLoading(true);
      const data = await getBrokers();
      setBrokers(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load brokers");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBrokers();
  }, []);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    try {
      setCreating(true);
      await createBroker(newName.trim());
      setNewName("");
      setShowAdd(false);
      await fetchBrokers();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to create broker");
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Удалить декларанта и все его операции?")) return;
    try {
      await deleteBroker(id);
      await fetchBrokers();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to delete broker");
    }
  };

  return (
    <div className="container">
      {/* Header */}
      <header className="header">
        <div className="header__inner">
          <div className="header__logo">
            <div className="header__logo-icon">📊</div>
            <div>
              <div className="header__title">FinLog</div>
              <div className="header__subtitle">Учёт задолженностей</div>
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
          <button
            className="btn btn--primary"
            onClick={() => setShowAdd(true)}
            id="add-broker-btn"
          >
            + Декларант
          </button>
        </div>
      </header>

      {/* Error toast */}
      {error && (
        <div className="toast toast--error" onClick={() => setError(null)}>
          {error}
        </div>
      )}

      {/* Add Broker Modal */}
      {showAdd && (
        <div className="modal-overlay" onClick={() => setShowAdd(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal__header">
              <h2 className="modal__title">Новый декларант</h2>
              <button
                className="modal__close"
                onClick={() => setShowAdd(false)}
              >
                ×
              </button>
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="broker-name-input">
                Имя
              </label>
              <input
                id="broker-name-input"
                className="form-input"
                type="text"
                placeholder="Введите имя декларанта"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                autoFocus
              />
            </div>
            <div className="modal__actions">
              <button
                className="btn btn--ghost"
                onClick={() => setShowAdd(false)}
              >
                Отмена
              </button>
              <button
                className="btn btn--primary"
                onClick={handleCreate}
                disabled={creating || !newName.trim()}
                id="confirm-add-broker-btn"
              >
                {creating ? <span className="spinner" /> : "Создать"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div className="loading-screen">
          <span className="spinner" />
          <span>Загрузка...</span>
        </div>
      ) : brokers.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state__icon">📋</div>
          <p className="empty-state__text">
            Нет декларантов. Нажмите «+ Декларант» чтобы добавить.
          </p>
        </div>
      ) : (
        <div className="broker-grid">
          {brokers.map((broker, i) => (
            <BrokerCard
              key={broker.id}
              broker={broker}
              index={i}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}
    </div>
  );
}
