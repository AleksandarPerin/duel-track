import { createContext, useContext } from 'react';
import type { LoginResponse } from '../api/auth';

export interface AuthContextValue {
  user: LoginResponse | null;
  setUser: (user: LoginResponse | null) => void;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthContext.Provider');
  return ctx;
}
