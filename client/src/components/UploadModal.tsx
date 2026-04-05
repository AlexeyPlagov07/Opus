/**
 * Upload modal feature.
 *
 * Handles PDF validation, metadata capture, backend upload, and post-upload
 * processing notification for a score.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';

interface UploadModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const MAX_FILE_SIZE = 50 * 1024 * 1024;
const INSTRUMENT_OPTIONS = [
  'Piano',
  'Violin',
  'Viola',
  'Cello',
  'Bass',
  'Flute',
  'Clarinet',
  'Saxophone',
  'Trumpet',
  'Trombone',
  'Percussion',
  'Voice',
  'Guitar',
  'Other',
];

/**
 * Derives a default title from an uploaded filename.
 *
 * @param fileName Uploaded file name.
 * @returns Title without the .pdf extension.
 */
function getTitleFromFilename(fileName: string): string {
  return fileName.replace(/\.pdf$/i, '').trim() || 'Untitled Score';
}

/**
 * Upload dialog for selecting a PDF and score metadata.
 *
 * @param isOpen Whether the modal is visible.
 * @param onClose Callback invoked after close/cancel.
 * @returns Modal UI, or null when hidden.
 */
export default function UploadModal({ isOpen, onClose }: UploadModalProps): JSX.Element | null {
  const { user } = useAuth();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [uploading, setUploading] = useState<boolean>(false);
  const [progress, setProgress] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [pieceName, setPieceName] = useState<string>('');
  const [composer, setComposer] = useState<string>('');
  const [instrument, setInstrument] = useState<string>(INSTRUMENT_OPTIONS[0]);
  const [difficulty, setDifficulty] = useState<number>(5);

  const progressLabel = useMemo(() => `${Math.round(progress)}%`, [progress]);

  useEffect(() => {
    if (!isOpen) {
      setIsDragging(false);
      setUploading(false);
      setProgress(0);
      setError(null);
      setSelectedFile(null);
      setPieceName('');
      setComposer('');
      setInstrument(INSTRUMENT_OPTIONS[0]);
      setDifficulty(5);
    }
  }, [isOpen]);

  if (!isOpen) {
    return null;
  }

  /**
   * Notifies backend queue endpoint to start score processing.
   *
   * @param scoreId Uploaded score id.
   * @returns Promise that resolves when notification request completes.
   */
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

  /**
   * Validates upload file constraints.
   *
   * @param file Candidate PDF file.
   * @returns Null when valid, otherwise an error message.
   */
  function validateFile(file: File): string | null {
    if (file.type !== 'application/pdf') {
      return 'Only PDF files are allowed.';
    }

    if (file.size > MAX_FILE_SIZE) {
      return 'PDF must be 50 MB or smaller.';
    }

    return null;
  }

  /**
   * Executes backend upload and processing notification flow.
   *
   * @returns Promise that resolves after upload flow completion.
   */
  async function uploadFile(): Promise<void> {
    if (!selectedFile) {
      setError('Select a PDF file to upload.');
      return;
    }

    if (!user) {
      setError('You must be signed in to upload.');
      return;
    }

    const validationError = validateFile(selectedFile);
    if (validationError) {
      setError(validationError);
      return;
    }

    const normalizedTitle = pieceName.trim() || getTitleFromFilename(selectedFile.name);
    const normalizedComposer = composer.trim() || 'Unknown Composer';
    const normalizedInstrument = instrument.trim() || INSTRUMENT_OPTIONS[0];
    const normalizedDifficulty = Math.min(10, Math.max(1, Math.round(difficulty)));

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
      payload.append('file', selectedFile, selectedFile.name);
      payload.append('title', normalizedTitle);
      payload.append('composer', normalizedComposer);
      payload.append('instrument', normalizedInstrument);
      payload.append('difficulty', String(normalizedDifficulty));

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

  /**
   * Handles file picker and drag-drop selection.
   *
   * @param files File list from browser file input/drop event.
   */
  function handleFileSelection(files: FileList | null): void {
    if (uploading) {
      return;
    }

    const file = files?.[0];

    if (!file) {
      return;
    }

    const validationError = validateFile(file);
    if (validationError) {
      setError(validationError);
      setSelectedFile(null);
      return;
    }

    setSelectedFile(file);
    setPieceName(getTitleFromFilename(file.name));
    setError(null);
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
            if (uploading) {
              return;
            }
            event.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => {
            if (!uploading) {
              setIsDragging(false);
            }
          }}
          onDrop={(event) => {
            if (uploading) {
              return;
            }
            event.preventDefault();
            setIsDragging(false);
            handleFileSelection(event.dataTransfer.files);
          }}
          onClick={() => {
            if (!uploading) {
              fileInputRef.current?.click();
            }
          }}
          className={`rounded-xl border-2 border-dashed p-8 text-center transition ${
            isDragging
              ? 'border-slate-500 bg-slate-100'
              : 'border-slate-300 bg-slate-50 hover:border-slate-400 hover:bg-slate-100'
          } ${uploading ? 'cursor-not-allowed opacity-70' : 'cursor-pointer'}`}
        >
          <p className="text-sm font-medium text-slate-700">Drag and drop PDF here</p>
          <p className="mt-1 text-xs text-slate-500">or click to browse (max 50 MB)</p>
          {selectedFile ? (
            <p className="mt-3 text-xs font-medium text-slate-700">Selected: {selectedFile.name}</p>
          ) : null}
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf"
          className="hidden"
          onChange={(event) => {
            handleFileSelection(event.target.files);
            event.target.value = '';
          }}
        />

        <div className="mt-4 space-y-4">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-700">Name of piece</span>
            <input
              type="text"
              value={pieceName}
              onChange={(event) => setPieceName(event.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-slate-500"
              placeholder="e.g. Clair de Lune"
              disabled={uploading}
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-700">Composer</span>
            <input
              type="text"
              value={composer}
              onChange={(event) => setComposer(event.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-slate-500"
              placeholder="e.g. Claude Debussy"
              disabled={uploading}
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-700">Instrument</span>
            <select
              value={instrument}
              onChange={(event) => setInstrument(event.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-slate-500"
              disabled={uploading}
            >
              {INSTRUMENT_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <div className="mb-1 flex items-center justify-between text-xs font-medium text-slate-700">
              <span>Difficulty (out of 10)</span>
              <span>{difficulty}/10</span>
            </div>
            <input
              type="range"
              min={1}
              max={10}
              step={1}
              value={difficulty}
              onChange={(event) => setDifficulty(Number(event.target.value))}
              className="w-full"
              disabled={uploading}
            />
          </label>
        </div>

        {uploading ? (
          <div className="mt-4">
            <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200">
              <div className="h-full bg-slate-900 transition-all" style={{ width: `${progress}%` }} />
            </div>
            <p className="mt-2 text-xs text-slate-600">Uploading... {progressLabel}</p>
          </div>
        ) : null}

        {error ? <p className="mt-4 text-sm text-red-600">{error}</p> : null}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
            onClick={onClose}
            disabled={uploading}
          >
            Cancel
          </button>
          <button
            type="button"
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => {
              void uploadFile();
            }}
            disabled={uploading || !selectedFile}
          >
            Upload score
          </button>
        </div>
      </div>
    </div>
  );
}
