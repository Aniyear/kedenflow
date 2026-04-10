"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { supabase } from "@/lib/supabaseClient";
import Link from "next/link";
import { useRouter } from "next/navigation";

export default function ProfilePage() {
  const { profile, user, loading, signOut } = useAuth();
  const router = useRouter();

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error", text: string } | null>(null);

  useEffect(() => {
    if (!loading && (!user || !profile)) {
      router.replace("/login");
    }
  }, [user, profile, loading, router]);

  if (loading || !user || !profile) {
    return (
      <div className="container">
        <div className="loading-screen">
          <span className="spinner" />
          <span>Загрузка...</span>
        </div>
      </div>
    );
  }

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);

    if (password && password !== confirmPassword) {
      setMessage({ type: "error", text: "Пароли не совпадают" });
      return;
    }

    try {
      setIsSaving(true);
      const updates: any = {};
      
      if (password) {
        updates.password = password;
      }

      if (Object.keys(updates).length === 0) {
        setMessage({ type: "success", text: "Нет изменений для сохранения" });
        return;
      }

      const { error } = await supabase.auth.updateUser(updates);

      if (error) throw error;
      
      setMessage({ type: "success", text: "Пароль успешно обновлен!" });
      setPassword("");
      setConfirmPassword("");

    } catch (err: any) {
      setMessage({ type: "error", text: err.message || "Ошибка обновления профиля" });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="container" style={{ maxWidth: "600px" }}>
      <header className="header">
        <div className="header__inner">
          <div className="header__logo">
            <Link href="/" className="back-btn">
              ← Назад
            </Link>
          </div>
          <div>
            <div className="header__title">Профиль</div>
            <div className="header__subtitle">Настройки аккаунта</div>
          </div>
        </div>
      </header>

      <div className="card">
        <div style={{ marginBottom: "var(--space-xl)", textAlign: "center" }}>
          <div style={{
            width: "80px", height: "80px", 
            borderRadius: "50%", background: "var(--accent-gradient)", 
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: "2rem", margin: "0 auto var(--space-md)",
            color: "white", fontWeight: "bold"
          }}>
            {profile.display_name.charAt(0).toUpperCase()}
          </div>
          <h2 style={{ marginBottom: "4px" }}>{profile.display_name}</h2>
          <span className="badge badge--success">{profile.role === "admin" ? "Администратор" : "Пользователь"}</span>
        </div>

        {message && (
          <div className={`toast toast--${message.type}`} style={{ position: "relative", marginBottom: "var(--space-lg)", transform: "none", animation: "none", opacity: 1, backgroundColor: "var(--bg-card)", boxShadow: "none" }}>
            {message.text}
          </div>
        )}

        <form onSubmit={handleUpdate}>
          <h3 style={{ marginBottom: "var(--space-md)", marginTop: "var(--space-md)" }}>Сменить пароль</h3>
          
          <div className="form-group">
            <label className="form-label" htmlFor="password">Новый пароль</label>
            <input
              id="password"
              type="password"
              className="form-input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Оставьте пустым, чтобы не менять"
              minLength={6}
            />
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="confirm-password">Подтвердите новый пароль</label>
            <input
              id="confirm-password"
              type="password"
              className="form-input"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Повторите пароль"
              minLength={6}
            />
          </div>

          <button 
            type="submit" 
            className="btn btn--primary" 
            style={{ width: "100%", marginTop: "var(--space-lg)" }}
            disabled={isSaving}
          >
            {isSaving ? <><span className="spinner"/> Сохранение...</> : "Сохранить изменения"}
          </button>
        </form>

        <div style={{ margin: "var(--space-xl) 0" }}><hr style={{ borderColor: "var(--border-color)", borderTop: "none" }}/></div>

        <button 
          className="btn btn--outline" 
          onClick={signOut}
          style={{ width: "100%", color: "var(--danger)", borderColor: "var(--danger)" }}
        >
          🚪 Выйти из аккаунта
        </button>
      </div>
    </div>
  );
}
