/**
 * Firebase Admin SDK bootstrap module.
 *
 * Creates a singleton Admin app instance and exports auth, firestore, and
 * storage clients used by server routes and middleware.
 */
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';

const firebaseProjectId = process.env.FIREBASE_PROJECT_ID;
const firebaseClientEmail = process.env.FIREBASE_CLIENT_EMAIL;
const firebasePrivateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
const defaultStorageBucket = process.env.FIREBASE_STORAGE_BUCKET ?? process.env.GCS_BUCKET;

if (!firebaseProjectId || !firebaseClientEmail || !firebasePrivateKey) {
  throw new Error('Missing Firebase Admin credentials in environment variables.');
}

const adminApp =
  getApps()[0] ??
  initializeApp({
    credential: cert({
      projectId: firebaseProjectId,
      clientEmail: firebaseClientEmail,
      privateKey: firebasePrivateKey,
    }),
    storageBucket: defaultStorageBucket,
  });

export const adminAuth = getAuth(adminApp);
export const adminDb = getFirestore(adminApp);
export const adminStorage = getStorage(adminApp);
