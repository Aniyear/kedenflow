"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";

export default function LoginPage() {
  const { signIn, loading: authLoading, user } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);



  // Redirect if already logged in
  useEffect(() => {
    if (user && !authLoading) {
      router.replace("/");
    }
  }, [user, authLoading, router]);

  if (user && !authLoading) {
    return null;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!email.trim() || !password) {
      setError("Введите email и пароль");
      return;
    }

    try {
      setLoading(true);
      await signIn(email.trim(), password);
      router.replace("/");
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Ошибка входа";
      if (message.includes("Invalid login")) {
        setError("Неверный email или пароль");
      } else {
        setError(message);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-logo">
          <img src="/logo.png" alt="KedenFlow Logo" style={{ width: 64, height: 64, borderRadius: 12, marginBottom: 20 }} />
          <h1 className="login-logo__title">KedenFlow</h1>
          <p className="login-logo__subtitle">Финансовая платформа</p>
        </div>

        {/* Error */}
        {error && (
          <div className="login-error">
            {error}
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="login-form">
          <div className="form-group">
            <label className="form-label" htmlFor="login-email">
              Email
            </label>
            <input
              id="login-email"
              className="form-input"
              type="email"
              placeholder="user@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoFocus
              autoComplete="email"
            />
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="login-password">
              Пароль
            </label>
            <input
              id="login-password"
              className="form-input"
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </div>

          <button
            type="submit"
            className="btn btn--primary btn--lg btn--block"
            disabled={loading || authLoading}
            id="login-submit-btn"
          >
            {loading ? <span className="spinner" /> : "Войти"}
          </button>
        </form>

        <p className="login-footer">
          Аккаунт предоставляется администратором
        </p>
      </div>
    </div>
  );
}
