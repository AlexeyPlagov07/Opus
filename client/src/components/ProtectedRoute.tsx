/**
 * Protected route wrapper.
 *
 * Blocks navigation for unauthenticated users and renders a loading screen
 * while auth state is still resolving.
 */
import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

/**
 * Renders route guard behavior for authenticated pages.
 *
 * @returns Outlet for authenticated sessions, otherwise loading/redirect UI.
 */
export default function ProtectedRoute(): JSX.Element {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100">
        <p className="text-sm text-slate-600">Loading session...</p>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return <Outlet />;
}
