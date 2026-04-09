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
  const [isDeactivated, setIsDeactivated] = useState(false);

  const fetchProfile = useCallback(async () => {
    try {
      const p = await getMyProfile();
      setProfile(p);
      setIsDeactivated(false);
    } catch (err: any) {
      console.error("Failed to fetch profile:", err);
      if (err.message && err.message.includes("Account is deactivated")) {
        setIsDeactivated(true);
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
      }
    });

    return () => subscription.unsubscribe();
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
    setIsDeactivated(false);
  };

  const refreshProfile = async () => {
    await fetchProfile();
  };

  return (
    <AuthContext.Provider
      value={{ user, session, profile, loading, signIn, signOut, refreshProfile }}
    >
      {isDeactivated ? (
        <div 
          className="container" 
          style={{ 
            display: "flex", 
            flexDirection: "column", 
            alignItems: "center", 
            justifyContent: "center", 
            height: "100vh", 
            textAlign: "center" 
          }}
        >
          <div 
            className="card" 
            style={{ 
              maxWidth: "400px", 
              padding: "var(--space-2xl)", 
              border: "2px solid var(--border-active)",
              boxShadow: "0 20px 40px rgba(0,0,0,0.3)"
            }}
          >
            <div 
              style={{ 
                fontSize: "4rem", 
                marginBottom: "var(--space-md)",
                filter: "drop-shadow(0 0 10px rgba(239, 68, 68, 0.4))"
              }}
            >
              🔒
            </div>
            <h1 className="header__title" style={{ fontSize: "1.5rem", marginBottom: "var(--space-sm)" }}>
              Доступ заблокирован
            </h1>
            <p className="header__subtitle" style={{ marginBottom: "var(--space-xl)", color: "var(--text-muted)" }}>
              Ваш аккаунт деактивирован администратором. Пожалуйста, свяжитесь с поддержкой для восстановления доступа.
            </p>
            <button className="btn btn--primary btn--lg" style={{ width: "100%" }} onClick={signOut}>
              Выйти из системы
            </button>
          </div>
        </div>
      ) : (
        children
      )}
    </AuthContext.Provider>
  );
}
