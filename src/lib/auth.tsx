import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

type AuthContextValue = {
  loading: boolean;
  bootError: string | null;
  session: Session | null;
  user: User | null;
  requiresPasswordUpdate: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  sendPasswordReset: (email: string) => Promise<void>;
  updatePassword: (password: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function toErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  return "Falha de autenticacao. Tente novamente.";
}

function recoveryRedirectUrl() {
  if (typeof window === "undefined") return undefined;
  const url = new URL(window.location.origin);
  url.searchParams.set("auth", "recovery");
  return url.toString();
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [bootError, setBootError] = useState<string | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [requiresPasswordUpdate, setRequiresPasswordUpdate] = useState(false);

  useEffect(() => {
    let active = true;

    async function boot() {
      try {
        const { data, error } = await supabase.auth.getSession();
        if (!active) return;
        if (error) throw error;
        setSession(data.session ?? null);
        if (typeof window !== "undefined" && window.location.hash.includes("type=recovery")) {
          setRequiresPasswordUpdate(true);
        }
      } catch (error) {
        if (!active) return;
        setBootError(toErrorMessage(error));
      } finally {
        if (active) setLoading(false);
      }
    }

    void boot();
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (!active) return;
      setSession(nextSession ?? null);
      if (event === "PASSWORD_RECOVERY") setRequiresPasswordUpdate(true);
      if (event === "SIGNED_OUT") setRequiresPasswordUpdate(false);
      if (event === "USER_UPDATED") setRequiresPasswordUpdate(false);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw new Error(error.message);
  }, []);

  const signUp = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: recoveryRedirectUrl(),
      },
    });
    if (error) throw new Error(error.message);
  }, []);

  const sendPasswordReset = useCallback(async (email: string) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: recoveryRedirectUrl(),
    });
    if (error) throw new Error(error.message);
  }, []);

  const updatePassword = useCallback(async (password: string) => {
    const { error } = await supabase.auth.updateUser({ password });
    if (error) throw new Error(error.message);
    setRequiresPasswordUpdate(false);
    if (typeof window !== "undefined" && window.location.hash.includes("type=recovery")) {
      window.history.replaceState({}, "", window.location.pathname + window.location.search);
    }
  }, []);

  const signOut = useCallback(async () => {
    const { error } = await supabase.auth.signOut();
    if (error) throw new Error(error.message);
    setRequiresPasswordUpdate(false);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      loading,
      bootError,
      session,
      user: session?.user ?? null,
      requiresPasswordUpdate,
      signIn,
      signUp,
      sendPasswordReset,
      updatePassword,
      signOut,
    }),
    [
      loading,
      bootError,
      session,
      requiresPasswordUpdate,
      signIn,
      signUp,
      sendPasswordReset,
      updatePassword,
      signOut,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth precisa de AuthProvider.");
  return value;
}
