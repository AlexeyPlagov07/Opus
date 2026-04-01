import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

type Mode = 'login' | 'register';

function mapFirebaseError(message: string): string {
  if (message.includes('auth/invalid-credential')) {
    return 'Invalid email or password.';
  }

  if (message.includes('auth/email-already-in-use')) {
    return 'This email is already registered.';
  }

  if (message.includes('auth/weak-password')) {
    return 'Password should be at least 6 characters.';
  }

  if (message.includes('auth/popup-closed-by-user')) {
    return 'Google sign-in was cancelled.';
  }

  return 'Something went wrong. Please try again.';
}

export default function AuthForm(): JSX.Element {
  const navigate = useNavigate();
  const { signInWithEmail, signInWithGoogle, signUpWithEmail } = useAuth();

  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<boolean>(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      if (mode === 'login') {
        await signInWithEmail(email, password);
      } else {
        await signUpWithEmail(email, password);
      }

      navigate('/');
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : 'Unknown error';
      setError(mapFirebaseError(message));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleGoogleSignIn(): Promise<void> {
    setError(null);
    setSubmitting(true);

    try {
      await signInWithGoogle();
      navigate('/');
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : 'Unknown error';
      setError(mapFirebaseError(message));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-xl ring-1 ring-slate-200">
      <h1 className="text-2xl font-semibold text-slate-900">
        {mode === 'login' ? 'Welcome back' : 'Create your account'}
      </h1>
      <p className="mt-2 text-sm text-slate-600">Upload and organize your sheet music PDFs.</p>

      <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
            required
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700" htmlFor="password">
            Password
          </label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
            required
          />
        </div>

        {error ? (
          <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
            {error}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-70"
        >
          {submitting ? 'Please wait...' : mode === 'login' ? 'Sign in' : 'Create account'}
        </button>
      </form>

      <button
        type="button"
        onClick={handleGoogleSignIn}
        disabled={submitting}
        className="mt-3 w-full rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-900 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-70"
      >
        Continue with Google
      </button>

      <p className="mt-6 text-sm text-slate-600">
        {mode === 'login' ? "Don't have an account?" : 'Already have an account?'}{' '}
        <button
          type="button"
          className="font-medium text-slate-900 underline decoration-slate-300 underline-offset-4"
          onClick={() => {
            setMode(mode === 'login' ? 'register' : 'login');
            setError(null);
          }}
        >
          {mode === 'login' ? 'Register' : 'Sign in'}
        </button>
      </p>
    </div>
  );
}
