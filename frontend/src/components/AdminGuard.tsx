"use client";

import { useAuth } from "@/components/AuthProvider";
import { useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";

interface AdminGuardProps {
  children: ReactNode;
}

/**
 * Protects content behind admin role check.
 * Redirects to home if user is not admin.
 */
export default function AdminGuard({ children }: AdminGuardProps) {
  const { profile, user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    
    if (!user) {
      router.replace("/login?error=Пожалуйста, войдите в систему");
    } else if (profile && profile.role !== "admin") {
      router.replace("/");
    }
  }, [user, profile, loading, router]);

  if (loading) {
    return (
      <div className="loading-screen">
        <span className="spinner" />
        <span>Загрузка...</span>
      </div>
    );
  }

  if (!profile || profile.role !== "admin") return null;

  return <>{children}</>;
}
