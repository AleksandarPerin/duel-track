import { useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AuthContext } from './hooks/useAuth';
import type { LoginResponse } from './api/auth';
import { LoginPage } from './pages/LoginPage';
import { RoundPage } from './pages/RoundPage';

export function App() {
  const [user, setUser] = useState<LoginResponse | null>(null);

  return (
    <AuthContext.Provider value={{ user, setUser }}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/t/:tournamentId/r/:roundNumber" element={<RoundPage />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </AuthContext.Provider>
  );
}
