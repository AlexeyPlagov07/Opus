/**
 * Firebase client SDK initialization.
 *
 * Centralizes app configuration and exports shared auth/database/storage
 * instances for all client features.
 */
import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

/**
 * Ensures required Firebase environment variables are present.
 *
 * @param name Environment variable name.
 * @param value Environment variable value.
 * @returns Non-empty environment variable value.
 */
function assertFirebaseEnv(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

const firebaseConfig = {
  apiKey: assertFirebaseEnv('VITE_FIREBASE_API_KEY', import.meta.env.VITE_FIREBASE_API_KEY),
  authDomain: assertFirebaseEnv('VITE_FIREBASE_AUTH_DOMAIN', import.meta.env.VITE_FIREBASE_AUTH_DOMAIN),
  projectId: assertFirebaseEnv('VITE_FIREBASE_PROJECT_ID', import.meta.env.VITE_FIREBASE_PROJECT_ID),
  storageBucket: assertFirebaseEnv('VITE_FIREBASE_STORAGE_BUCKET', import.meta.env.VITE_FIREBASE_STORAGE_BUCKET),
  messagingSenderId: assertFirebaseEnv(
    'VITE_FIREBASE_MESSAGING_SENDER_ID',
    import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID
  ),
  appId: assertFirebaseEnv('VITE_FIREBASE_APP_ID', import.meta.env.VITE_FIREBASE_APP_ID),
};

const customGcsBucket = import.meta.env.VITE_GCS_BUCKET;

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = customGcsBucket ? getStorage(app, `gs://${customGcsBucket}`) : getStorage(app);
export const googleAuthProvider = new GoogleAuthProvider();
