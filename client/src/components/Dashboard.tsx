import { deleteObject, listAll, ref } from 'firebase/storage';
import { deleteDoc, doc } from 'firebase/firestore';
import { useState } from 'react';
import ScoreCard from './ScoreCard';
import UploadModal from './UploadModal';
import { useScores } from '../hooks/useScores';
import { useAuth } from '../contexts/AuthContext';
import { db, storage } from '../lib/firebase';
import type { Score } from '../../../shared/types';

export default function Dashboard(): JSX.Element {
  const { user, signOut } = useAuth();
  const { scores, loading, error } = useScores();

  const [uploadOpen, setUploadOpen] = useState<boolean>(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function handleDelete(score: Score): Promise<void> {
    if (!user) {
      return;
    }

    setDeletingId(score.id);
    setDeleteError(null);

    try {
      const token = await user.getIdToken();
      const baseUrl = import.meta.env.VITE_API_BASE_URL;

      if (baseUrl) {
        const response = await fetch(`${baseUrl}/scores/${score.id}`, {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        if (!response.ok) {
          const fallbackMessage = 'Unable to delete score on server.';

          try {
            const body = (await response.json()) as { error?: string };
            throw new Error(body.error ?? fallbackMessage);
          } catch {
            throw new Error(fallbackMessage);
          }
        }

        try {
          const body = (await response.json()) as { warning?: string };
          if (body.warning) {
            setDeleteError(body.warning);
          }
        } catch {
          // No response JSON body is fine for successful deletes.
        }
      } else {
        const dirRef = ref(storage, `scores/${user.uid}/${score.id}`);
        const listed = await listAll(dirRef);
        await Promise.all(listed.items.map((item) => deleteObject(item)));
        await deleteDoc(doc(db, 'scores', score.id));
      }
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : 'Delete failed.';
      setDeleteError(message);
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="min-h-screen bg-slate-100">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
          <div>
            <h1 className="text-xl font-semibold text-slate-900">Your Scores</h1>
            <p className="text-sm text-slate-500">{user?.email}</p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setUploadOpen(true)}
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700"
            >
              Upload PDF
            </button>
            <button
              type="button"
              onClick={() => {
                void signOut();
              }}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
        {error ? <p className="mb-4 text-sm text-red-600">{error}</p> : null}
        {deleteError ? <p className="mb-4 text-sm text-red-600">{deleteError}</p> : null}

        {loading ? <p className="text-sm text-slate-600">Loading scores...</p> : null}

        {!loading && scores.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center">
            <h2 className="text-lg font-semibold text-slate-900">No scores yet</h2>
            <p className="mt-2 text-sm text-slate-600">Upload your first PDF to start your music library.</p>
            <button
              type="button"
              onClick={() => setUploadOpen(true)}
              className="mt-4 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700"
            >
              Upload your first score
            </button>
          </div>
        ) : null}

        {scores.length > 0 ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {scores.map((score) => (
              <div key={score.id} className={deletingId === score.id ? 'opacity-60' : ''}>
                <ScoreCard score={score} onDelete={handleDelete} />
              </div>
            ))}
          </div>
        ) : null}
      </main>

      <UploadModal isOpen={uploadOpen} onClose={() => setUploadOpen(false)} />
    </div>
  );
}
