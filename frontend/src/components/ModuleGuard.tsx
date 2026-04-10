"use client";

import { useAuth } from "@/components/AuthProvider";
import { useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";

interface ModuleGuardProps {
  moduleId: string;
  children: ReactNode;
}

/**
 * Protects content behind module access check.
 * Redirects to home if user doesn't have access.
 */
export default function ModuleGuard({ moduleId, children }: ModuleGuardProps) {
  const { profile, user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    
    if (!user) {
      router.replace("/login?error=Пожалуйста, войдите в систему");
    } else if (profile) {
      const hasAccess =
        profile.role === "admin" ||
        profile.modules.some((m) => m.id === moduleId);
      if (!hasAccess) {
        router.replace("/");
      }
    }
  }, [user, profile, loading, moduleId, router]);

  if (loading) {
    return (
      <div className="loading-screen">
        <span className="spinner" />
        <span>Загрузка...</span>
      </div>
    );
  }

  if (!profile) return null;

  const hasAccess =
    profile.role === "admin" ||
    profile.modules.some((m) => m.id === moduleId);

  if (!hasAccess) return null;

  return <>{children}</>;
}
