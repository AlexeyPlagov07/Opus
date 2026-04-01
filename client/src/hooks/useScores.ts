import { useEffect, useState } from 'react';
import {
  collection,
  onSnapshot,
  orderBy,
  query,
  where,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import type { Score } from '../../../shared/types';

interface UseScoresResult {
  scores: Score[];
  loading: boolean;
  error: string | null;
}

function isTimestampLike(value: unknown): value is { seconds: number; nanoseconds: number } {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as { seconds?: unknown; nanoseconds?: unknown };
  return typeof candidate.seconds === 'number' && typeof candidate.nanoseconds === 'number';
}

function mapScore(snapshot: QueryDocumentSnapshot): Score {
  const data = snapshot.data() as Record<string, unknown>;

  const createdAt = data.createdAt;
  const updatedAt = data.updatedAt;

  return {
    id: snapshot.id,
    ownerId: String(data.ownerId ?? ''),
    title: String(data.title ?? 'Untitled Score'),
    pdfUrl: String(data.pdfUrl ?? ''),
    musicXmlUrl: (data.musicXmlUrl as string | null) ?? null,
    midiUrl: (data.midiUrl as string | null) ?? null,
    status: (data.status as Score['status']) ?? 'uploaded',
    pageCount: (data.pageCount as number | null) ?? null,
    createdAt: isTimestampLike(createdAt) ? createdAt : { seconds: 0, nanoseconds: 0 },
    updatedAt: isTimestampLike(updatedAt) ? updatedAt : { seconds: 0, nanoseconds: 0 },
  };
}

export function useScores(): UseScoresResult {
  const { user } = useAuth();
  const [scores, setScores] = useState<Score[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) {
      setScores([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    const scoresRef = collection(db, 'scores');
    const scoresQuery = query(
      scoresRef,
      where('ownerId', '==', user.uid),
      orderBy('createdAt', 'desc')
    );

    const unsubscribe = onSnapshot(
      scoresQuery,
      (snapshot) => {
        setScores(snapshot.docs.map(mapScore));
        setLoading(false);
      },
      (nextError) => {
        setError(nextError.message);
        setLoading(false);
      }
    );

    return unsubscribe;
  }, [user]);

  return { scores, loading, error };
}
