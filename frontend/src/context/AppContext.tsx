import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { api, getToken, setToken } from "../lib/api";
import type { Preferences, User } from "../lib/types";

type Theme = "dark" | "light";
type Direction = "ltr" | "rtl";

interface Toast {
  id: number;
  message: string;
  tone: "success" | "error" | "info";
}

interface AppContextValue {
  user: User | null;
  preferences: Preferences | null;
  loading: boolean;
  theme: Theme;
  direction: Direction;
  toasts: Toast[];
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<void>;
  logout: () => void;
  setTheme: (theme: Theme) => void;
  setDirection: (direction: Direction) => void;
  updatePreferences: (patch: Partial<Preferences>) => Promise<void>;
  updateProfile: (patch: { name?: string; email?: string }) => Promise<void>;
  notify: (message: string, tone?: Toast["tone"]) => void;
  dismissToast: (id: number) => void;
}

const AppContext = createContext<AppContextValue | null>(null);

const THEME_KEY = "devintel_theme";
const DIR_KEY = "devintel_dir";

function readStored<T extends string>(key: string, fallback: T): T {
  try {
    return (localStorage.getItem(key) as T) || fallback;
  } catch {
    return fallback;
  }
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [preferences, setPreferences] = useState<Preferences | null>(null);
  const [loading, setLoading] = useState(true);
  const [theme, setThemeState] = useState<Theme>(() => readStored<Theme>(THEME_KEY, "dark"));
  const [direction, setDirectionState] = useState<Direction>(() =>
    readStored<Direction>(DIR_KEY, "ltr")
  );
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastId = useRef(0);

  // Apply theme + direction to the document.
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* ignore */
    }
  }, [theme]);

  useEffect(() => {
    document.documentElement.setAttribute("dir", direction);
    try {
      localStorage.setItem(DIR_KEY, direction);
    } catch {
      /* ignore */
    }
  }, [direction]);

  const notify = useCallback((message: string, tone: Toast["tone"] = "info") => {
    const id = ++toastId.current;
    setToasts((current) => [...current, { id, message, tone }]);
    setTimeout(() => {
      setToasts((current) => current.filter((t) => t.id !== id));
    }, 4200);
  }, []);

  const dismissToast = useCallback((id: number) => {
    setToasts((current) => current.filter((t) => t.id !== id));
  }, []);

  const applySession = useCallback(
    (nextUser: User, nextPreferences: Preferences | null) => {
      setUser(nextUser);
      if (nextPreferences) {
        setPreferences(nextPreferences);
        if (nextPreferences.theme) setThemeState(nextPreferences.theme);
        if (nextPreferences.direction) setDirectionState(nextPreferences.direction);
      }
    },
    []
  );

  // Restore an existing session on first load.
  useEffect(() => {
    let cancelled = false;

    async function restore() {
      if (!getToken()) {
        setLoading(false);
        return;
      }
      try {
        const data = await api.get<{ user: User; preferences: Preferences }>("/api/auth/me");
        if (!cancelled) applySession(data.user, data.preferences);
      } catch {
        setToken(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    restore();
    return () => {
      cancelled = true;
    };
  }, [applySession]);

  const login = useCallback(
    async (email: string, password: string) => {
      const data = await api.post<{ token: string; user: User; preferences: Preferences }>(
        "/api/auth/login",
        { email, password }
      );
      setToken(data.token);
      applySession(data.user, data.preferences);
    },
    [applySession]
  );

  const register = useCallback(
    async (name: string, email: string, password: string) => {
      const data = await api.post<{ token: string; user: User; preferences: Preferences }>(
        "/api/auth/register",
        { name, email, password }
      );
      setToken(data.token);
      applySession(data.user, data.preferences);
    },
    [applySession]
  );

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
    setPreferences(null);
  }, []);

  const persistPreferences = useCallback(
    async (patch: Partial<Preferences>) => {
      if (!user) return;
      try {
        const data = await api.patch<{ preferences: Preferences }>("/api/settings", patch);
        setPreferences(data.preferences);
      } catch {
        /* preference persistence is best-effort; local state already applied */
      }
    },
    [user]
  );

  const setTheme = useCallback(
    (next: Theme) => {
      setThemeState(next);
      setPreferences((current) => (current ? { ...current, theme: next } : current));
      void persistPreferences({ theme: next });
    },
    [persistPreferences]
  );

  const setDirection = useCallback(
    (next: Direction) => {
      setDirectionState(next);
      setPreferences((current) => (current ? { ...current, direction: next } : current));
      void persistPreferences({ direction: next });
    },
    [persistPreferences]
  );

  const updatePreferences = useCallback(
    async (patch: Partial<Preferences>) => {
      const data = await api.patch<{ preferences: Preferences }>("/api/settings", patch);
      setPreferences(data.preferences);
      if (patch.theme) setThemeState(patch.theme);
      if (patch.direction) setDirectionState(patch.direction);
    },
    []
  );

  const updateProfile = useCallback(async (patch: { name?: string; email?: string }) => {
    const data = await api.patch<{ user: User }>("/api/auth/me", patch);
    setUser(data.user);
  }, []);

  const value = useMemo(
    () => ({
      user,
      preferences,
      loading,
      theme,
      direction,
      toasts,
      login,
      register,
      logout,
      setTheme,
      setDirection,
      updatePreferences,
      updateProfile,
      notify,
      dismissToast,
    }),
    [
      user,
      preferences,
      loading,
      theme,
      direction,
      toasts,
      login,
      register,
      logout,
      setTheme,
      setDirection,
      updatePreferences,
      updateProfile,
      notify,
      dismissToast,
    ]
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const context = useContext(AppContext);
  if (!context) throw new Error("useApp must be used inside AppProvider");
  return context;
}
