import { useMemo, useRef, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';

interface UploadModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const MAX_FILE_SIZE = 50 * 1024 * 1024;

function getTitleFromFilename(fileName: string): string {
  return fileName.replace(/\.pdf$/i, '').trim() || 'Untitled Score';
}

export default function UploadModal({ isOpen, onClose }: UploadModalProps): JSX.Element | null {
  const { user } = useAuth();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [uploading, setUploading] = useState<boolean>(false);
  const [progress, setProgress] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);

  const progressLabel = useMemo(() => `${Math.round(progress)}%`, [progress]);

  if (!isOpen) {
    return null;
  }

  async function notifyBackend(scoreId: string): Promise<void> {
    if (!user) {
      return;
    }

    const token = await user.getIdToken();
    const baseUrl = import.meta.env.VITE_API_BASE_URL;

    if (!baseUrl) {
      return;
    }

    const response = await fetch(`${baseUrl}/scores`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ scoreId }),
    });

    if (!response.ok) {
      const fallbackMessage = 'Failed to notify backend about uploaded score.';

      try {
        const body = (await response.json()) as { error?: string };
        throw new Error(body.error ?? fallbackMessage);
      } catch {
        throw new Error(fallbackMessage);
      }
    }
  }

  function validateFile(file: File): string | null {
    if (file.type !== 'application/pdf') {
      return 'Only PDF files are allowed.';
    }

    if (file.size > MAX_FILE_SIZE) {
      return 'PDF must be 50 MB or smaller.';
    }

    return null;
  }

  async function uploadFile(file: File): Promise<void> {
    if (!user) {
      setError('You must be signed in to upload.');
      return;
    }

    const validationError = validateFile(file);
    if (validationError) {
      setError(validationError);
      return;
    }

    setUploading(true);
    setError(null);
    setProgress(0);

    try {
      const baseUrl = import.meta.env.VITE_API_BASE_URL;

      if (!baseUrl) {
        throw new Error('Missing VITE_API_BASE_URL. Backend upload is required for custom GCS buckets.');
      }

      const token = await user.getIdToken();
      const payload = new FormData();
      payload.append('file', file, file.name);
      payload.append('title', getTitleFromFilename(file.name));

      setProgress(25);
      const uploadResponse = await fetch(`${baseUrl}/scores/upload`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: payload,
      });
      setProgress(80);

      if (!uploadResponse.ok) {
        const fallbackMessage = 'Upload failed on server.';

        try {
          const body = (await uploadResponse.json()) as { error?: string };
          throw new Error(body.error ?? fallbackMessage);
        } catch {
          throw new Error(fallbackMessage);
        }
      }

      const uploadBody = (await uploadResponse.json()) as { scoreId?: string };

      if (!uploadBody.scoreId) {
        throw new Error('Upload succeeded but no score id was returned.');
      }

      // TODO: Trigger OMR and conversion pipeline after backend jobs are implemented.
      await notifyBackend(uploadBody.scoreId);
      setProgress(100);

      setUploading(false);
      onClose();
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : 'Upload failed.';
      setError(message);
      setUploading(false);
    }
  }

  function handleFileSelection(files: FileList | null): void {
    const file = files?.[0];
    if (file) {
      void uploadFile(file);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/40 px-4">
      <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl">
        <div className="mb-4 flex items-start justify-between">
          <h2 className="text-xl font-semibold text-slate-900">Upload a score PDF</h2>
          <button
            type="button"
            className="text-sm font-medium text-slate-500 hover:text-slate-700"
            onClick={onClose}
            disabled={uploading}
          >
            Close
          </button>
        </div>

        <div
          onDragOver={(event) => {
            event.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setIsDragging(false);
            handleFileSelection(event.dataTransfer.files);
          }}
          onClick={() => fileInputRef.current?.click()}
          className={`cursor-pointer rounded-xl border-2 border-dashed p-8 text-center transition ${
            isDragging
              ? 'border-slate-500 bg-slate-100'
              : 'border-slate-300 bg-slate-50 hover:border-slate-400 hover:bg-slate-100'
          }`}
        >
          <p className="text-sm font-medium text-slate-700">Drag and drop PDF here</p>
          <p className="mt-1 text-xs text-slate-500">or click to browse (max 50 MB)</p>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf"
          className="hidden"
          onChange={(event) => handleFileSelection(event.target.files)}
        />

        {uploading ? (
          <div className="mt-4">
            <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200">
              <div className="h-full bg-slate-900 transition-all" style={{ width: `${progress}%` }} />
            </div>
            <p className="mt-2 text-xs text-slate-600">Uploading... {progressLabel}</p>
          </div>
        ) : null}

        {error ? <p className="mt-4 text-sm text-red-600">{error}</p> : null}
      </div>
    </div>
  );
}
