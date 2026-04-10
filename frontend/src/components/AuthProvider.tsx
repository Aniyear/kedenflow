"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import type { User, Session } from "@supabase/supabase-js";
import type { UserProfile } from "@/types";
import { supabase } from "@/lib/supabaseClient";
import { getMyProfile } from "@/lib/api";

interface AuthContextType {
  user: User | null;
  session: Session | null;
  profile: UserProfile | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  session: null,
  profile: null,
  loading: true,
  signIn: async () => {},
  signOut: async () => {},
  refreshProfile: async () => {},
});

export function useAuth() {
  return useContext(AuthContext);
}

export default function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [pendingApproval, setPendingApproval] = useState(false);
  const [isDeactivated, setIsDeactivated] = useState(false);

  const fetchProfile = useCallback(async () => {
    try {
      const p = await getMyProfile(true);
      setProfile(p);
      setPendingApproval(false);
      setIsDeactivated(false);
    } catch (err: any) {
      const msg = err?.message || "";
      if (msg.includes("ожидает подтверждения")) {
        setPendingApproval(true);
        setIsDeactivated(false);
      } else if (msg.includes("deactivated") || msg.includes("деактивирован")) {
        setIsDeactivated(true);
        setPendingApproval(false);
      } else {
        // Only log unexpected errors to console
        console.error("Failed to fetch profile:", err);
      }
      setProfile(null);
    }
  }, []);

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s);
      setUser(s?.user ?? null);
      if (s?.user) {
        fetchProfile().finally(() => setLoading(false));
      } else {
        setLoading(false);
      }
    });

    // Listen for auth changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      setUser(s?.user ?? null);
      if (s?.user) {
        fetchProfile();
      } else {
        setProfile(null);
        setPendingApproval(false);
        setIsDeactivated(false);
      }
    });

    // Listen for global API 401/403 errors
    const handleAuthError = async (e: Event) => {
      const customEvent = e as CustomEvent;
      const message = customEvent.detail?.message || "Сессия истекла";

      // If it's a pending approval message, handle gracefully
      if (message.includes("ожидает подтверждения")) {
        setPendingApproval(true);
        return;
      }

      // If explicitly deactivated
      if (message.includes("деактивирован")) {
        setIsDeactivated(true);
        return;
      }

      console.warn("Global auth error caught:", message);

      await supabase.auth.signOut();
      setUser(null);
      setSession(null);
      setProfile(null);

      // Redirect to login with error for any other unexpected auth-errors
      window.location.href = `/login?error=${encodeURIComponent(message)}`;
    };

    window.addEventListener("auth-error", handleAuthError);

    return () => {
      subscription.unsubscribe();
      window.removeEventListener("auth-error", handleAuthError);
    };
  }, [fetchProfile]);

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (error) throw error;
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setSession(null);
    setProfile(null);
    setPendingApproval(false);
    setIsDeactivated(false);
  };

  const refreshProfile = async () => {
    await fetchProfile();
  };

  // --- Pending Approval Screen ---
  if (pendingApproval && user) {
    return (
      <AuthContext.Provider
        value={{ user, session, profile, loading, signIn, signOut, refreshProfile }}
      >
        <div
          className="container"
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            height: "100vh",
            textAlign: "center",
          }}
        >
          <div
            className="card animate-in"
            style={{
              maxWidth: "440px",
              padding: "var(--space-2xl)",
              border: "1px solid var(--border-active)",
              boxShadow: "var(--shadow-glow), var(--shadow-xl)",
            }}
          >
            <div
              style={{
                fontSize: "4rem",
                marginBottom: "var(--space-lg)",
                animation: "pendingPulse 2s ease-in-out infinite",
              }}
            >
              ⏳
            </div>
            <h1
              className="header__title"
              style={{ fontSize: "1.5rem", marginBottom: "var(--space-sm)" }}
            >
              Заявка отправлена!
            </h1>
            <p
              style={{
                margin: "var(--space-md) 0 var(--space-xl)",
                color: "var(--text-secondary)",
                lineHeight: "1.7",
                fontSize: "0.95rem",
              }}
            >
              Ваш аккаунт успешно создан и ожидает подтверждения
              администратором. Вы получите доступ к платформе, как только
              администратор одобрит вашу заявку.
            </p>
            <div
              style={{
                background: "var(--bg-glass)",
                border: "1px solid var(--border-color)",
                borderRadius: "var(--radius-md)",
                padding: "var(--space-md)",
                marginBottom: "var(--space-xl)",
                fontSize: "0.85rem",
                color: "var(--text-muted)",
              }}
            >
              📧 {user.email}
            </div>
            <button
              className="btn btn--ghost btn--lg"
              style={{ width: "100%" }}
              onClick={signOut}
            >
              Выйти
            </button>
          </div>
        </div>
        <style>{`
          @keyframes pendingPulse {
            0%, 100% { transform: scale(1); opacity: 1; }
            50% { transform: scale(1.1); opacity: 0.8; }
          }
        `}</style>
      </AuthContext.Provider>
    );
  }

  // --- Deactivated Account Screen ---
  if (isDeactivated) {
    return (
      <AuthContext.Provider
        value={{ user, session, profile, loading, signIn, signOut, refreshProfile }}
      >
        <div
          className="container"
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            height: "100vh",
            textAlign: "center",
          }}
        >
          <div
            className="card"
            style={{
              maxWidth: "400px",
              padding: "var(--space-2xl)",
              border: "2px solid var(--danger)",
              boxShadow:
                "0 20px 40px rgba(0,0,0,0.3), 0 0 20px rgba(239, 68, 68, 0.1)",
            }}
          >
            <div
              style={{
                fontSize: "4rem",
                marginBottom: "var(--space-md)",
                filter: "drop-shadow(0 0 10px rgba(239, 68, 68, 0.4))",
              }}
            >
              🔒
            </div>
            <h1
              className="header__title"
              style={{ fontSize: "1.5rem", marginBottom: "var(--space-sm)" }}
            >
              Доступ заблокирован
            </h1>
            <p
              className="header__subtitle"
              style={{
                marginBottom: "var(--space-xl)",
                color: "var(--text-muted)",
              }}
            >
              Ваш аккаунт деактивирован администратором. Пожалуйста, свяжитесь
              с поддержкой для восстановления доступа.
            </p>
            <button
              className="btn btn--primary btn--lg"
              style={{ width: "100%" }}
              onClick={signOut}
            >
              Выйти из системы
            </button>
          </div>
        </div>
      </AuthContext.Provider>
    );
  }

  return (
    <AuthContext.Provider
      value={{ user, session, profile, loading, signIn, signOut, refreshProfile }}
    >
      {children}
    </AuthContext.Provider>
  );
}
