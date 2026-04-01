import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';

const serviceAccountProjectId = process.env.FIREBASE_PROJECT_ID;
const serviceAccountClientEmail = process.env.FIREBASE_CLIENT_EMAIL;
const serviceAccountPrivateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
const storageBucket = process.env.FIREBASE_STORAGE_BUCKET ?? process.env.GCS_BUCKET;

if (!serviceAccountProjectId || !serviceAccountClientEmail || !serviceAccountPrivateKey) {
  throw new Error('Missing Firebase Admin credentials in environment variables.');
}

const adminApp =
  getApps()[0] ??
  initializeApp({
    credential: cert({
      projectId: serviceAccountProjectId,
      clientEmail: serviceAccountClientEmail,
      privateKey: serviceAccountPrivateKey,
    }),
    storageBucket,
  });

export const adminAuth = getAuth(adminApp);
export const adminDb = getFirestore(adminApp);
export const adminStorage = getStorage(adminApp);
