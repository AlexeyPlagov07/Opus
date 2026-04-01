# Opus

Full-stack sheet music foundation app:

- React + TypeScript + Vite client
- Node + Express TypeScript server
- Firebase Auth + Firestore + Storage

This version includes:

- Auth (email/password + Google)
- Protected dashboard
- PDF upload and storage
- Score metadata in Firestore
- Score list + delete flow

OMR, MusicXML generation, and audio playback are intentionally not implemented yet.

## Important Note About GCS

Cloud Storage for Firebase is already backed by Google Cloud Storage (GCS).

That means:

- You are already storing files in a GCS bucket.
- Using "Firebase Storage" does not mean a separate non-GCS storage system.
- Storage cost is still based on GCS usage (stored GB, operations, egress).

This project now supports choosing a custom bucket explicitly via env vars.

For reliability with custom buckets, uploads are sent through the backend API and then written to GCS by the server.
This avoids direct browser-to-GCS CORS preflight failures.

## 1. Prerequisites

- Node.js 20+ (LTS recommended)
- npm 10+
- A Firebase project
- Access to the Google Cloud project that owns your bucket

## 2. Install Dependencies

```powershell
cd client
npm install

cd ../server
npm install
```

## 3. Firebase Setup (Auth + Firestore)

### 3.1 Create/select Firebase project

1. Open Firebase Console.
2. Create a project or reuse one.

### 3.2 Register web app

1. In Project settings, add/register a Web app.
2. Copy Firebase Web config values.

### 3.3 Enable Authentication

1. Authentication -> Sign-in method.
2. Enable Email/Password.
3. Enable Google.

### 3.4 Create Firestore

1. Firestore Database -> Create database.
2. Choose production mode and region.
3. Deploy the included Firestore rules.

### 3.5 Service account for server

1. Project settings -> Service accounts.
2. Generate private key JSON.
3. Map JSON values into `server/.env`.

Never commit service account files or secrets.

## 4. Use Your GCS Bucket

You have two supported paths.

### Option A: Firebase default bucket (simplest)

Use the Firebase bucket shown in your web config:

- Example: `project-id.firebasestorage.app` or `project-id.appspot.com`

Set:

- `VITE_FIREBASE_STORAGE_BUCKET` on client
- `FIREBASE_STORAGE_BUCKET` on server

### Option B: Custom bucket in same Google Cloud project

If you want a different bucket name for cost/accounting or lifecycle rules:

1. Create bucket in Google Cloud Storage.
2. Ensure your Firebase/Server service account has access.
3. Set these env vars:

Client:

- `VITE_FIREBASE_STORAGE_BUCKET` (keep normal Firebase config complete)
- `VITE_GCS_BUCKET=<your-bucket-name-without-gs-prefix>`

Server:

- `FIREBASE_STORAGE_BUCKET=<your-bucket-name>` or `GCS_BUCKET=<your-bucket-name>`

Notes:

- Use bucket name only, not `gs://` in env values.
- The server uploads files to this bucket, so browser CORS is not required for upload requests.

## 5. Environment Variables

### 5.1 Client (`client/.env`)

Create from `client/.env.example`:

```env
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_STORAGE_BUCKET=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=
VITE_API_BASE_URL=http://localhost:4000
VITE_GCS_BUCKET=
```

### 5.2 Server (`server/.env`)

Create from `server/.env.example`:

```env
PORT=4000
CLIENT_ORIGIN=http://localhost:5173
FIREBASE_PROJECT_ID=
FIREBASE_CLIENT_EMAIL=
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
FIREBASE_STORAGE_BUCKET=
GCS_BUCKET=
```

Map from service account JSON:

- `project_id` -> `FIREBASE_PROJECT_ID`
- `client_email` -> `FIREBASE_CLIENT_EMAIL`
- `private_key` -> `FIREBASE_PRIVATE_KEY`

Keep `FIREBASE_PRIVATE_KEY` quoted, with escaped `\n` line breaks.

## 6. Deploy Rules

```powershell
npm install -g firebase-tools
firebase login
firebase init
firebase deploy --only firestore:rules,storage
```

## 7. Run Locally

Terminal A:

```powershell
cd server
npm run dev
```

Terminal B:

```powershell
cd client
npm run dev
```

Client URL: `http://localhost:5173`

## 8. Cost Control Tips (GCS)

1. Set lifecycle policies to auto-delete old uploads.
2. Keep files in a low-cost region near users.
3. Avoid unnecessary egress (serve from same region when possible).
4. Track operation counts (list/get/delete) in Cloud Monitoring.
5. Keep test data cleanup automated.

## 9. Troubleshooting

Client says missing env var:

- Verify all required `VITE_FIREBASE_*` fields exist.
- Restart Vite after env changes.

Server auth/storage errors:

- Recheck service account values and private key format.
- Verify bucket name and IAM permissions.

Firestore permission denied:

- Confirm Firestore rules were deployed to the correct project.

Storage permission denied:

- Confirm Storage rules are deployed.
- Confirm upload path UID matches authenticated UID.
