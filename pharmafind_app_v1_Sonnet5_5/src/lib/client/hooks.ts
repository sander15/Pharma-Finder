"use client";
import { useCallback, useEffect, useState } from "react";
import type { SessionAccount } from "../types";
import { api } from "./api";

/** Current logged-in account (from the HttpOnly session cookie), or null. `loading` is true until the first answer. */
export function useSession() {
  const [account, setAccount] = useState<SessionAccount | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const r = await api<{ account: SessionAccount }>("GET", "/api/auth/me");
      setAccount(r.data.account);
    } catch {
      setAccount(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const logout = useCallback(async () => {
    try {
      await api("POST", "/api/auth/logout");
    } finally {
      setAccount(null);
    }
  }, []);

  return { account, loading, refresh, logout };
}
