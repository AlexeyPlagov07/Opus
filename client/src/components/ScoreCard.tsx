import type { Score } from '../../../shared/types';

interface ScoreCardProps {
  score: Score;
  onDelete: (score: Score) => Promise<void>;
}

const statusStyles: Record<Score['status'], string> = {
  uploaded: 'bg-blue-100 text-blue-700',
  processing: 'bg-amber-100 text-amber-700',
  ready: 'bg-emerald-100 text-emerald-700',
  error: 'bg-red-100 text-red-700',
};

function formatDate(timestamp: Score['createdAt']): string {
  const date = new Date(timestamp.seconds * 1000);

  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
}

export default function ScoreCard({ score, onDelete }: ScoreCardProps): JSX.Element {
  return (
    <article className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <a
        href={score.pdfUrl}
        target="_blank"
        rel="noreferrer"
        className="flex h-36 items-center justify-center bg-gradient-to-br from-slate-100 to-slate-200"
      >
        <span className="text-sm font-medium text-slate-600">Open PDF</span>
      </a>

      <div className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-2">
          <h3 className="line-clamp-1 text-base font-semibold text-slate-900">{score.title}</h3>
          <span className={`rounded-full px-2 py-1 text-xs font-medium capitalize ${statusStyles[score.status]}`}>
            {score.status}
          </span>
        </div>

        <p className="text-xs text-slate-500">Uploaded {formatDate(score.createdAt)}</p>

        <button
          type="button"
          className="w-full rounded-lg border border-red-200 px-3 py-2 text-sm font-medium text-red-700 transition hover:bg-red-50"
          onClick={() => {
            const confirmed = window.confirm(`Delete \"${score.title}\"? This cannot be undone.`);
            if (confirmed) {
              void onDelete(score);
            }
          }}
        >
          Delete
        </button>
      </div>
    </article>
  );
}
