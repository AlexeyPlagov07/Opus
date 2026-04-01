import { Navigate } from 'react-router-dom';
import AuthForm from '../components/AuthForm';
import { useAuth } from '../contexts/AuthContext';

export default function LoginPage(): JSX.Element {
  const { user, loading } = useAuth();

  if (!loading && user) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-slate-100 to-slate-200 px-4">
      <AuthForm />
    </div>
  );
}
