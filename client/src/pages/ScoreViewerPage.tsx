/**
 * Score viewer route page.
 *
 * Resolves a score from the live score collection and renders stateful loading,
 * error, not-found, and viewer views.
 */
import { Link, Navigate, useParams } from 'react-router-dom';
import ScoreViewer from '../components/ScoreViewer';
import { useScores } from '../hooks/useScores';

/**
 * Renders score viewer page for the route score id.
 *
 * @returns Score viewer screen or fallback state view.
 */
export default function ScoreViewerPage(): JSX.Element {
  const { scoreId } = useParams<{ scoreId: string }>();
  const { scores, loading, error } = useScores();

  if (!scoreId) {
    return <Navigate to="/" replace />;
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-100 px-4 py-6 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-4xl rounded-xl border border-slate-200 bg-white p-6 text-slate-600 shadow-sm">
          Loading score...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-slate-100 px-4 py-6 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-4xl rounded-xl border border-red-200 bg-white p-6 shadow-sm">
          <p className="text-red-700">Could not load score metadata: {error}</p>
          <Link
            to="/"
            className="mt-4 inline-flex rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
          >
            Back to dashboard
          </Link>
        </div>
      </div>
    );
  }

  const matchedScore = scores.find((candidateScore) => candidateScore.id === scoreId);

  if (!matchedScore) {
    return (
      <div className="min-h-screen bg-slate-100 px-4 py-6 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-4xl rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-slate-700">Score not found.</p>
          <Link
            to="/"
            className="mt-4 inline-flex rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
          >
            Back to dashboard
          </Link>
        </div>
      </div>
    );
  }

  return <ScoreViewer score={matchedScore} />;
}
