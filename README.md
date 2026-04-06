# Opus

Opus is a full-stack sheet music application.

It lets users:
- Sign in with Firebase Authentication
- Upload sheet music PDFs
- Store metadata (piece name, composer, instrument, difficulty)
- Browse a personal dashboard
- Search by piece name or composer
- Sort by recently opened, recently uploaded, alphabetical, and difficulty
- Open a score in an in-app viewer and annotate it
- Delete scores

## Stack

- Frameworks
   - React
   - Express
   - Vite
   - Tailwind CSS

- Libraries
   - React DOM
   - React Router DOM
   - Firebase client SDK
   - Firebase Admin SDK
   - PDF.js
   - cors
   - multer
   - dotenv
   - TypeScript
   - @vitejs/plugin-react
   - PostCSS
   - Autoprefixer

- Other things used in the app
   - Firebase Authentication
   - Firestore
   - Cloud Storage
   - Node.js runtime
   - localStorage for annotation persistence
   - Canvas rendering for the score viewer
   - Pointer events and ResizeObserver for annotation interaction

## Prerequisites

- Node.js 20+ (LTS recommended)
- npm 10+
- A Firebase project
- A Firebase service account with access to Firestore and Storage

## Project Structure

- client: React app (dashboard, auth, score viewer)
- server: Express API (auth verification, score upload/list/delete/pdf streaming)
- shared: shared TypeScript types used by client and server

## 1) Install Dependencies

From the project root:

```powershell
cd client
npm install

cd ../server
npm install
```

## 2) Configure Environment Variables

### Client config

Create client/.env with:

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

Notes:
- VITE_API_BASE_URL is required for upload and PDF access through the backend.
- Leave VITE_GCS_BUCKET empty unless you intentionally use a custom bucket.

### Server config

Create server/.env with:

```env
PORT=4000
CLIENT_ORIGIN=http://localhost:5173
FIREBASE_PROJECT_ID=
FIREBASE_CLIENT_EMAIL=
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
FIREBASE_STORAGE_BUCKET=
GCS_BUCKET=
```

Map values from your Firebase service account JSON:
- project_id -> FIREBASE_PROJECT_ID
- client_email -> FIREBASE_CLIENT_EMAIL
- private_key -> FIREBASE_PRIVATE_KEY (keep escaped \n line breaks)

Bucket notes:
- Use FIREBASE_STORAGE_BUCKET for the primary bucket.
- GCS_BUCKET is an optional fallback bucket name.

## 3) Firebase Setup

1. Create or select a Firebase project.
2. Add a Web app and copy config values to client/.env.
3. Enable Authentication providers:
   - Email/Password
   - Google
4. Create Firestore Database.
5. Create/enable Cloud Storage.

Optional: deploy included rules from project root:

```powershell
npm install -g firebase-tools
firebase login
firebase deploy --only firestore:rules,storage
```

## 4) Run the App Locally

Use two terminals.

Terminal A (server):

```powershell
cd server
npm run dev
```

Terminal B (client):

```powershell
cd client
npm run dev
```

Open:
- Client: http://localhost:5173
- Server health check: http://localhost:4000/health

## 5) Build for Production

```powershell
cd server
npm run build

cd ../client
npm run build
```

To run the built server:

```powershell
cd server
npm start
```

## 6) How to Use the Application

1. Sign up or sign in.
2. Open the dashboard.
3. Upload a PDF and fill metadata:
   - Name of piece
   - Composer
   - Instrument
   - Difficulty (1-10)
4. Use search to find scores by piece name or composer.
5. Use sort options:
   - Recently opened
   - Recently uploaded
   - Alphabetical
   - Difficulty (low to high)
   - Difficulty (high to low)
6. Open a score card to view and annotate in-app.
7. Delete a score from the dashboard if needed.

## Troubleshooting

### Missing client env variable error

- Confirm all required VITE_FIREBASE_* variables exist in client/.env.
- Restart the Vite dev server after env changes.

### Upload fails with API/base URL errors

- Confirm VITE_API_BASE_URL in client/.env points to your running server.
- Confirm the server is running on PORT (default 4000).

### Unauthorized (401) from API

- Ensure you are signed in.
- Ensure the Authorization header is being sent by the client.
- Verify Firebase Admin credentials in server/.env.

### Permission denied in Firestore/Storage

- Verify your Firebase rules are deployed to the correct project.
- Verify service account permissions to Firestore and Storage.

### CORS issues

- Ensure CLIENT_ORIGIN in server/.env matches your client URL (for local dev: http://localhost:5173).
