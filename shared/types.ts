/**
 * Shared domain contracts used by both client and server.
 *
 * These types define persisted score data and timestamp shapes so both
 * applications can share the same API and Firestore document expectations.
 */
export type ScoreStatus = 'uploaded' | 'processing' | 'ready' | 'error';

export interface FirestoreTimestamp {
  seconds: number;
  nanoseconds: number;
}

export interface Score {
  id: string;
  ownerId: string;
  title: string;
  composer: string;
  instrument: string;
  difficulty: number;
  pdfUrl: string;
  musicXmlUrl: string | null;
  midiUrl: string | null;
  status: ScoreStatus;
  pageCount: number | null;
  createdAt: FirestoreTimestamp;
  updatedAt: FirestoreTimestamp;
}

export interface Annotation {
  id: string;
  scoreId: string;
  ownerId: string;
  page: number;
  x: number;
  y: number;
  text: string;
  createdAt: FirestoreTimestamp;
  updatedAt: FirestoreTimestamp;
}
