"use client";

import { useAuth } from "@/components/AuthProvider";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import Link from "next/link";

/** Route map for each module */
const MODULE_ROUTES: Record<string, string> = {
  debt_management: "/modules/debt-management",
  excel_converter: "/modules/excel-converter",
};

export default function HomePage() {
  const { profile, loading, signOut, user } = useAuth();
  const router = useRouter();

  // Redirect to login if not authenticated
  useEffect(() => {
    if (!loading && !user) {
      router.replace("/login");
    }
  }, [loading, user, router]);

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

  if (!profile) return null;

  const userModules = profile.modules || [];

  return (
    <div className="container">
      {/* Header */}
      <header className="header">
        <div className="header__inner">
          <div className="header__logo">
            <img src="/logo.png" alt="Logo" style={{ width: 32, height: 32, borderRadius: 6, marginRight: 12 }} />
            <div>
              <div className="header__title">KedenFlow</div>
              <div className="header__subtitle">Финансовая платформа</div>
            </div>
          </div>
          <div className="header__actions">
            <div className="header__user">
              <span className="header__user-name">
                {profile.display_name}
              </span>
              <span className="header__user-role">
                {profile.role === "admin" ? "Админ" : "Пользователь"}
              </span>
            </div>
            <button
              className="btn btn--ghost btn--sm"
              onClick={signOut}
              id="logout-btn"
            >
              Выйти
            </button>
          </div>
        </div>
      </header>

      {/* Module Grid */}
      <section>
        <h2 style={{ marginBottom: "var(--space-lg)" }}>Ваши модули</h2>

        {userModules.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state__icon">🔒</div>
            <p className="empty-state__text">
              Нет доступных модулей. Обратитесь к администратору.
            </p>
          </div>
        ) : (
          <div className="module-grid">
            {userModules.map((mod) => (
              <Link
                key={mod.id}
                href={MODULE_ROUTES[mod.id] || "#"}
                className="module-card"
                id={`module-${mod.id}`}
              >
                <div className="module-card__icon">
                  {mod.icon || "📦"}
                </div>
                <div className="module-card__info">
                  <div className="module-card__name">{mod.name}</div>
                  <div className="module-card__desc">
                    {mod.description || ""}
                  </div>
                </div>
                <div className="module-card__arrow">→</div>
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* Admin link */}
      {profile.role === "admin" && (
        <section style={{ marginTop: "var(--space-2xl)" }}>
          <Link href="/admin" className="module-card module-card--admin" id="admin-panel-link">
            <div className="module-card__icon">⚙️</div>
            <div className="module-card__info">
              <div className="module-card__name">Админ-панель</div>
              <div className="module-card__desc">
                Управление пользователями и модулями
              </div>
            </div>
            <div className="module-card__arrow">→</div>
          </Link>
        </section>
      )}
    </div>
  );
}
