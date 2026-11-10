"use client";

import { useCallback, useEffect, useState } from "react";
import type { SessionAccount } from "@/lib/types";
import { api } from "./api";

/** Loads the signed-in account from the session cookie (GET /api/auth/me). */
export function useSession() {
  const [account, setAccount] = useState<SessionAccount | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      setAccount(await api<SessionAccount>("GET", "/api/auth/me"));
    } catch {
      setAccount(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const login = useCallback(async (email: string, password: string) => {
    const r = await api<{ account: SessionAccount }>("POST", "/api/auth/login", { email, password });
    setAccount(r.account);
    return r.account;
  }, []);

  const logout = useCallback(async () => {
    await api("POST", "/api/auth/logout");
    setAccount(null);
  }, []);

  return { account, loading, login, logout, refresh };
}
