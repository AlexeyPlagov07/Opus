/**
 * Dashboard feature component.
 *
 * Displays the authenticated user's uploaded scores, supports searching and
 * sorting, and coordinates score upload and deletion flows.
 */
import { deleteObject, listAll, ref } from 'firebase/storage';
import { deleteDoc, doc } from 'firebase/firestore';
import { useMemo, useState } from 'react';
import ScoreCard from './ScoreCard';
import UploadModal from './UploadModal';
import { useScores } from '../hooks/useScores';
import { useAuth } from '../contexts/AuthContext';
import { db, storage } from '../lib/firebase';
import type { Score } from '../../../shared/types';

type SortOption =
  | 'recently-opened'
  | 'recently-uploaded'
  | 'alphabetical'
  | 'difficulty-asc'
  | 'difficulty-desc';

const LAST_OPENED_STORAGE_KEY = 'opus:lastOpenedByScoreId:v1';

/**
 * Reads persisted "last opened" timestamps used for sorting.
 *
 * @returns Map of score id to epoch milliseconds.
 */
function readLastOpenedByScoreId(): Record<string, number> {
  try {
    const raw = localStorage.getItem(LAST_OPENED_STORAGE_KEY);

    if (!raw) {
      return {};
    }

    const parsed = JSON.parse(raw) as Record<string, unknown>;

    if (!parsed || typeof parsed !== 'object') {
      return {};
    }

    const normalized: Record<string, number> = {};

    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
        normalized[key] = value;
      }
    }

    return normalized;
  } catch {
    return {};
  }
}

/**
 * Converts Firestore timestamp to sortable epoch milliseconds.
 *
 * @param score Score whose creation time should be converted.
 * @returns Millisecond timestamp used for ordering.
 */
function getCreatedAtSortValue(score: Score): number {
  return score.createdAt.seconds * 1000 + Math.floor(score.createdAt.nanoseconds / 1_000_000);
}

/**
 * Renders dashboard layout and interactions.
 *
 * @returns Dashboard screen.
 */
export default function Dashboard(): JSX.Element {
  const { user, signOut } = useAuth();
  const { scores, loading, error } = useScores();

  const [uploadOpen, setUploadOpen] = useState<boolean>(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [sortBy, setSortBy] = useState<SortOption>('recently-uploaded');
  const [lastOpenedByScoreId, setLastOpenedByScoreId] = useState<Record<string, number>>(() =>
    readLastOpenedByScoreId()
  );

  const searchedScores = useMemo(() => {
    const normalizedQuery = searchTerm.trim().toLowerCase();

    if (!normalizedQuery) {
      return scores;
    }

    return scores.filter((score) => {
      const title = score.title.toLowerCase();
      const composer = score.composer.toLowerCase();

      return title.includes(normalizedQuery) || composer.includes(normalizedQuery);
    });
  }, [scores, searchTerm]);

  const visibleScores = useMemo(() => {
    const sorted = [...searchedScores];

    if (sortBy === 'alphabetical') {
      sorted.sort((left, right) =>
        left.title.localeCompare(right.title, undefined, { sensitivity: 'base', numeric: true })
      );
      return sorted;
    }

    if (sortBy === 'recently-opened') {
      sorted.sort((left, right) => {
        const leftOpenedAt = lastOpenedByScoreId[left.id] ?? 0;
        const rightOpenedAt = lastOpenedByScoreId[right.id] ?? 0;

        if (rightOpenedAt !== leftOpenedAt) {
          return rightOpenedAt - leftOpenedAt;
        }

        return getCreatedAtSortValue(right) - getCreatedAtSortValue(left);
      });
      return sorted;
    }

    if (sortBy === 'difficulty-asc') {
      sorted.sort((left, right) => {
        if (left.difficulty !== right.difficulty) {
          return left.difficulty - right.difficulty;
        }

        return left.title.localeCompare(right.title, undefined, { sensitivity: 'base', numeric: true });
      });
      return sorted;
    }

    if (sortBy === 'difficulty-desc') {
      sorted.sort((left, right) => {
        if (left.difficulty !== right.difficulty) {
          return right.difficulty - left.difficulty;
        }

        return left.title.localeCompare(right.title, undefined, { sensitivity: 'base', numeric: true });
      });
      return sorted;
    }

    sorted.sort((left, right) => getCreatedAtSortValue(right) - getCreatedAtSortValue(left));
    return sorted;
  }, [searchedScores, sortBy, lastOpenedByScoreId]);

  /**
   * Marks a score as recently opened for local sorting.
   *
   * @param scoreId Score id being opened.
   */
  function handleOpenScore(scoreId: string): void {
    setLastOpenedByScoreId((previous) => {
      const next = {
        ...previous,
        [scoreId]: Date.now(),
      };

      try {
        localStorage.setItem(LAST_OPENED_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Keep in-memory sorting even if storage writes fail.
      }

      return next;
    });
  }

  /**
   * Deletes a score and related storage artifacts.
   *
   * @param score Score to delete.
   * @returns Promise that resolves when delete attempt finishes.
   */
  async function handleDelete(score: Score): Promise<void> {
    if (!user) {
      return;
    }

    setDeletingId(score.id);
    setDeleteError(null);

    try {
      const token = await user.getIdToken();
      const baseUrl = import.meta.env.PROD ? '' : import.meta.env.VITE_API_BASE_URL;

      if (import.meta.env.PROD || baseUrl) {
        const response = await fetch(`${baseUrl}/api/scores/${score.id}`, {
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
          <>
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
              <input
                type="search"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="Search by piece name or composer"
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-slate-500 sm:flex-1"
              />

              <label className="flex items-center gap-2 text-sm text-slate-700">
                <span className="whitespace-nowrap">Sort by</span>
                <select
                  value={sortBy}
                  onChange={(event) => setSortBy(event.target.value as SortOption)}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-slate-500"
                >
                  <option value="recently-opened">Recently opened</option>
                  <option value="recently-uploaded">Recently uploaded</option>
                  <option value="alphabetical">Alphabetical</option>
                  <option value="difficulty-asc">Difficulty (low to high)</option>
                  <option value="difficulty-desc">Difficulty (high to low)</option>
                </select>
              </label>
            </div>

            {visibleScores.length === 0 ? (
              <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-600">
                No scores match your search.
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {visibleScores.map((score) => (
                  <div key={score.id} className={deletingId === score.id ? 'opacity-60' : ''}>
                    <ScoreCard score={score} onDelete={handleDelete} onOpen={handleOpenScore} />
                  </div>
                ))}
              </div>
            )}
          </>
        ) : null}
      </main>

      <UploadModal isOpen={uploadOpen} onClose={() => setUploadOpen(false)} />
    </div>
  );
}
