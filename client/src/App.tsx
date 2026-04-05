/**
 * Root route map for the client application.
 *
 * Defines public and protected navigation paths and a catch-all redirect.
 */
import { Navigate, Route, Routes } from 'react-router-dom';
import ProtectedRoute from './components/ProtectedRoute';
import DashboardPage from './pages/DashboardPage';
import LoginPage from './pages/LoginPage';
import ScoreViewerPage from './pages/ScoreViewerPage';

/**
 * Renders the top-level route configuration.
 *
 * @returns Router element tree.
 */
export default function App(): JSX.Element {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<ProtectedRoute />}>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/scores/:scoreId" element={<ScoreViewerPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
