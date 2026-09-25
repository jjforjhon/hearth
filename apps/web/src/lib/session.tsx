import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api } from "./api";
import type { SelfProfile } from "@hearth/shared";

interface SessionCtx {
  user: SelfProfile | null;
  loading: boolean;
  refresh: () => Promise<void>;
  setUser: (u: SelfProfile | null) => void;
  logout: () => Promise<void>;
}

const Ctx = createContext<SessionCtx>({
  user: null,
  loading: true,
  refresh: async () => {},
  setUser: () => {},
  logout: async () => {},
});

export function SessionProvider({ children }: { children: ReactNode }): ReactNode {
  const [user, setUser] = useState<SelfProfile | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const me = await api.get<SelfProfile>("/api/auth/me");
      setUser(me);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const logout = useCallback(async () => {
    try {
      await api.post("/api/auth/logout");
    } finally {
      setUser(null);
    }
  }, []);

  return <Ctx.Provider value={{ user, loading, refresh, setUser, logout }}>{children}</Ctx.Provider>;
}

export function useSession(): SessionCtx {
  return useContext(Ctx);
}
