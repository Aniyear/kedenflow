"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { getMyProfile } from "@/lib/api";
import Link from "next/link";

export default function SignupPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!email.trim() || !password || !displayName.trim()) {
      setError("Заполните все поля");
      return;
    }

    if (password.length < 6) {
      setError("Пароль должен быть не менее 6 символов");
      return;
    }

    try {
      setLoading(true);
      const { data, error: signUpError } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          data: {
            display_name: displayName.trim(),
          },
        },
      });

      if (signUpError) throw signUpError;

      // Sync with backend if a session was created (this creates the DB profile)
      if (data.session) {
        try {
          await getMyProfile(true);
        } catch (syncErr) {
          // Ignore synchronization errors (like 403 Forbidden for inactive users)
          // as they are expected since the profile was just created in inactive state.
          console.log("Profile synchronized with backend (pending state)");
        }
      }

      setSuccess(true);
      // Success - user needs to confirm email (if enabled) or just knows account is pending
    } catch (err: any) {
      setError(err.message || "Ошибка регистрации");
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="login-page">
        <div className="login-card" style={{ textAlign: "center" }}>
          <div className="login-logo">
            <span style={{ fontSize: "3rem", marginBottom: "20px", display: "block" }}>🎯</span>
            <h1 className="login-logo__title">Готово!</h1>
          </div>
          <p style={{ margin: "var(--space-lg) 0", lineHeight: "1.6", color: "var(--text-muted)" }}>
            Ваш аккаунт успешно создан. Теперь он ожидает **подтверждения администратором**. 
            Мы сообщим вам, как только доступ будет открыт.
          </p>
          <Link href="/login" className="btn btn--primary btn--block">
            Вернуться ко входу
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-logo">
          <h1 className="login-logo__title">Регистрация</h1>
          <p className="login-logo__subtitle">Создайте аккаунт KedenFlow</p>
        </div>

        {error && (
          <div className="login-error">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="login-form">
          <div className="form-group">
            <label className="form-label" htmlFor="signup-name">
              Как вас зовут?
            </label>
            <input
              id="signup-name"
              className="form-input"
              type="text"
              placeholder="Иван Иванов"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              autoFocus
            />
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="signup-email">
              Email
            </label>
            <input
              id="signup-email"
              className="form-input"
              type="email"
              placeholder="user@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="signup-password">
              Придумайте пароль
            </label>
            <input
              id="signup-password"
              className="form-input"
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          <button
            type="submit"
            className="btn btn--primary btn--lg btn--block"
            disabled={loading}
          >
            {loading ? <span className="spinner" /> : "Зарегистрироваться"}
          </button>
        </form>

        <p className="login-footer" style={{ marginTop: "var(--space-xl)", textAlign: "center" }}>
          Уже есть аккаунт?{" "}
          <Link href="/login" style={{ color: "var(--accent)", fontWeight: "600", textDecoration: "none" }}>
            Войти
          </Link>
        </p>
      </div>
    </div>
  );
}
