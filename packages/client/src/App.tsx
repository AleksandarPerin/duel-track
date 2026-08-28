import { useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AuthContext } from './hooks/useAuth';
import type { LoginResponse } from './api/auth';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { RoundPage } from './pages/RoundPage';
import { RegisterPage } from './pages/RegisterPage';
import { TournamentRegistrationsPage } from './pages/TournamentRegistrationsPage';
import { PublicTournamentPage } from './pages/PublicTournamentPage';

export function App() {
  const [user, setUser] = useState<LoginResponse | null>(null);

  return (
    <AuthContext.Provider value={{ user, setUser }}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/t/:tournamentId/r/:roundNumber" element={<RoundPage />} />
        <Route path="/t/:tournamentId/registrations" element={<TournamentRegistrationsPage />} />
        {/* Public — no auth required, reached via the organizer's shareable link,
            or a player's own confirmation screen after registering. */}
        <Route path="/register/:token" element={<RegisterPage />} />
        <Route path="/t/:tournamentId" element={<PublicTournamentPage />} />
        {/* Not logged in: DashboardPage's fetch 401s and apiRequest bounces to
            /login itself. Logged in: lands on the dashboard, same as any
            other unrecognized path. */}
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </AuthContext.Provider>
  );
}
