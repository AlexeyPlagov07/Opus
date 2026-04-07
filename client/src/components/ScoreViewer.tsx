/**
 * Score viewer and annotation workspace.
 *
 * Loads score PDFs (direct URL or authenticated proxy), renders pages to canvas,
 * and supports local annotation editing with persistence in localStorage.
 */
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent as ReactChangeEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { Link } from 'react-router-dom';
import { GlobalWorkerOptions, getDocument, type PDFDocumentProxy, type PDFPageProxy } from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { Score } from '../../../shared/types';
import { useAuth } from '../contexts/AuthContext';

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

type ToolMode = 'cursor' | 'pen' | 'highlighter' | 'text';
type ResizeHandle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

interface Point {
  x: number;
  y: number;
}

interface StrokeAnnotation {
  id: string;
  kind: 'stroke';
  mode: 'pen' | 'highlighter';
  color: string;
  width: number;
  points: Point[];
}

interface TextAnnotation {
  id: string;
  kind: 'text';
  color: string;
  text: string;
  x: number;
  y: number;
  fontSize: number;
  fontFamily: string;
  boxWidth: number;
  boxHeight: number;
}

type ViewerAnnotation = StrokeAnnotation | TextAnnotation;
type AnnotationMap = Record<number, ViewerAnnotation[]>;

interface DrawingState {
  active: boolean;
  pointerId: number | null;
  mode: 'pen' | 'highlighter' | null;
  color: string;
  width: number;
  points: Point[];
}

interface DragState {
  active: boolean;
  pointerId: number | null;
  annotationId: string | null;
  lastPoint: Point | null;
}

interface ResizeState {
  active: boolean;
  pointerId: number | null;
  annotationId: string | null;
  page: number | null;
  handle: ResizeHandle | null;
  startPoint: Point | null;
  startBox: {
    x: number;
    y: number;
    boxWidth: number;
    boxHeight: number;
  } | null;
}

interface EditingTextState {
  annotationId: string;
  page: number;
  draft: string;
  x: number;
  y: number;
  boxWidth: number;
  boxHeight: number;
  color: string;
  fontSize: number;
  fontFamily: string;
}

interface ScoreViewerProps {
  score: Score;
}

const TOOL_COLORS = ['#111827', '#1d4ed8', '#0f766e', '#dc2626', '#a16207', '#6d28d9'];
const FONT_OPTIONS = [
  { label: 'DM Sans', value: '"DM Sans", "Segoe UI", sans-serif' },
  { label: 'Arial', value: 'Arial, sans-serif' },
  { label: 'Georgia', value: 'Georgia, "Times New Roman", serif' },
  { label: 'Courier New', value: '"Courier New", monospace' },
];
const DEFAULT_TEXT_FONT_SIZE = 22;
const DEFAULT_TEXT_FONT_FAMILY = FONT_OPTIONS[0].value;
const DEFAULT_TEXT_BOX_WIDTH = 220;
const DEFAULT_TEXT_BOX_HEIGHT = 64;
const MIN_TEXT_BOX_WIDTH = 90;
const MIN_TEXT_BOX_HEIGHT = 44;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 3;
const ZOOM_STEP = 0.1;
const ANNOTATION_STORAGE_PREFIX = 'opus:annotations:';
const RESIZE_HANDLE_CONFIGS: Array<{
  id: ResizeHandle;
  className: string;
  cursor: string;
}> = [
  { id: 'nw', className: 'left-0 top-0 -translate-x-1/2 -translate-y-1/2', cursor: 'nwse-resize' },
  { id: 'n', className: 'left-1/2 top-0 -translate-x-1/2 -translate-y-1/2', cursor: 'ns-resize' },
  { id: 'ne', className: 'right-0 top-0 translate-x-1/2 -translate-y-1/2', cursor: 'nesw-resize' },
  { id: 'e', className: 'right-0 top-1/2 translate-x-1/2 -translate-y-1/2', cursor: 'ew-resize' },
  { id: 'se', className: 'bottom-0 right-0 translate-x-1/2 translate-y-1/2', cursor: 'nwse-resize' },
  { id: 's', className: 'bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2', cursor: 'ns-resize' },
  { id: 'sw', className: 'bottom-0 left-0 -translate-x-1/2 translate-y-1/2', cursor: 'nesw-resize' },
  { id: 'w', className: 'left-0 top-1/2 -translate-x-1/2 -translate-y-1/2', cursor: 'ew-resize' },
];

/**
 * Builds localStorage key for per-score annotation state.
 *
 * @param scoreId Score identifier.
 * @returns Storage key string.
 */
function getAnnotationStorageKey(scoreId: string): string {
  return `${ANNOTATION_STORAGE_PREFIX}${scoreId}`;
}

/**
 * Computes text annotation line height from font size.
 *
 * @param fontSize Text font size in pixels.
 * @returns Line height in pixels.
 */
function getTextLineHeight(fontSize: number): number {
  return Math.round(fontSize * 1.35);
}

/**
 * Computes minimum text annotation box height for multiline content.
 *
 * @param text Annotation text content.
 * @param fontSize Text font size in pixels.
 * @returns Box height in pixels.
 */
function getTextBoxHeight(text: string, fontSize: number): number {
  const lineCount = Math.max(text.split('\n').length, 1);

  return Math.max(DEFAULT_TEXT_BOX_HEIGHT, lineCount * getTextLineHeight(fontSize) + 16);
}

/**
 * Safely converts unknown errors into displayable messages.
 *
 * @param error Unknown thrown value.
 * @param fallback Message used when error has no string message.
 * @returns Human-readable error message.
 */
function toErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) {
    return error.message;
  }

  return fallback;
}

/**
 * Clamps a number into a bounded range.
 *
 * @param value Input value.
 * @param min Inclusive minimum.
 * @param max Inclusive maximum.
 * @returns Clamped value.
 */
function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Applies drawing style for pen/highlighter stroke rendering.
 *
 * @param context Annotation canvas context.
 * @param annotation Stroke rendering style source.
 */
function configureStrokeContext(
  context: CanvasRenderingContext2D,
  annotation: Pick<StrokeAnnotation, 'mode' | 'color' | 'width'>
): void {
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.strokeStyle = annotation.color;
  context.lineWidth = annotation.width;

  if (annotation.mode === 'highlighter') {
    context.globalAlpha = 0.3;
    context.globalCompositeOperation = 'multiply';
    return;
  }

  context.globalAlpha = 1;
  context.globalCompositeOperation = 'source-over';
}

/**
 * Renders one stroke annotation to canvas.
 *
 * @param context Annotation canvas context.
 * @param annotation Stroke annotation to draw.
 */
function drawStroke(context: CanvasRenderingContext2D, annotation: StrokeAnnotation): void {
  if (annotation.points.length === 0) {
    return;
  }

  configureStrokeContext(context, annotation);

  if (annotation.points.length === 1) {
    const [point] = annotation.points;
    context.beginPath();
    context.arc(point.x, point.y, annotation.width / 2, 0, Math.PI * 2);
    context.fillStyle = annotation.color;
    context.fill();
    return;
  }

  context.beginPath();
  context.moveTo(annotation.points[0].x, annotation.points[0].y);

  for (let index = 1; index < annotation.points.length; index += 1) {
    const point = annotation.points[index];
    context.lineTo(point.x, point.y);
  }

  context.stroke();
}

/**
 * Renders one text annotation to canvas.
 *
 * @param context Annotation canvas context.
 * @param annotation Text annotation to draw.
 */
function drawText(context: CanvasRenderingContext2D, annotation: TextAnnotation): void {
  context.globalAlpha = 1;
  context.globalCompositeOperation = 'source-over';
  context.fillStyle = annotation.color;
  context.font = `${annotation.fontSize}px ${annotation.fontFamily}`;
  context.textBaseline = 'top';

  const lines = annotation.text.split('\n');
  const lineHeight = getTextLineHeight(annotation.fontSize);
  const x = annotation.x + 8;
  const y = annotation.y + 8;

  lines.forEach((line, index) => {
    context.fillText(line, x, y + index * lineHeight, annotation.boxWidth - 16);
  });

  if (annotation.text.trim().length === 0) {
    context.save();
    context.setLineDash([8, 6]);
    context.lineWidth = 1.5;
    context.strokeStyle = '#0284c7';
    context.strokeRect(annotation.x, annotation.y, annotation.boxWidth, annotation.boxHeight);
    context.restore();
  }
}

/**
 * Computes Euclidean distance between two points.
 *
 * @param pointA First point.
 * @param pointB Second point.
 * @returns Point distance.
 */
function distance(pointA: Point, pointB: Point): number {
  return Math.hypot(pointA.x - pointB.x, pointA.y - pointB.y);
}

/**
 * Computes the minimum distance from a point to a segment.
 *
 * @param point Probe point.
 * @param start Segment start point.
 * @param end Segment end point.
 * @returns Minimum distance to segment.
 */
function pointToSegmentDistance(point: Point, start: Point, end: Point): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;

  if (dx === 0 && dy === 0) {
    return distance(point, start);
  }

  const t = ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy);
  const clampedT = clamp(t, 0, 1);

  return distance(point, {
    x: start.x + clampedT * dx,
    y: start.y + clampedT * dy,
  });
}

/**
 * Checks whether a point falls within a text annotation box.
 *
 * @param point Probe point.
 * @param annotation Text annotation bounds.
 * @returns True when point is inside the text box rectangle.
 */
function isPointInsideTextBox(point: Point, annotation: TextAnnotation): boolean {
  return (
    point.x >= annotation.x &&
    point.x <= annotation.x + annotation.boxWidth &&
    point.y >= annotation.y &&
    point.y <= annotation.y + annotation.boxHeight
  );
}

/**
 * Checks whether a point is close enough to a stroke to select it.
 *
 * @param point Probe point.
 * @param annotation Stroke annotation.
 * @returns True when point is within stroke selection tolerance.
 */
function isPointNearStroke(point: Point, annotation: StrokeAnnotation): boolean {
  const tolerance = Math.max(annotation.width + 4, 8);

  if (annotation.points.length === 1) {
    return distance(point, annotation.points[0]) <= tolerance;
  }

  for (let index = 0; index < annotation.points.length - 1; index += 1) {
    if (pointToSegmentDistance(point, annotation.points[index], annotation.points[index + 1]) <= tolerance) {
      return true;
    }
  }

  return false;
}

/**
 * Finds the top-most selectable annotation at a point.
 *
 * @param point Probe point.
 * @param annotations Candidate annotation stack for a page.
 * @returns Top-most hit annotation or null.
 */
function findTopAnnotationAtPoint(point: Point, annotations: ViewerAnnotation[]): ViewerAnnotation | null {
  for (let index = annotations.length - 1; index >= 0; index -= 1) {
    const annotation = annotations[index];

    if (annotation.kind === 'text' && isPointInsideTextBox(point, annotation)) {
      return annotation;
    }

    if (annotation.kind === 'stroke' && isPointNearStroke(point, annotation)) {
      return annotation;
    }
  }

  return null;
}

/**
 * Moves a text annotation while keeping it within canvas bounds.
 *
 * @param annotation Text annotation to move.
 * @param dx Horizontal movement delta.
 * @param dy Vertical movement delta.
 * @param canvasSize Canvas width/height point.
 * @returns Moved text annotation.
 */
function moveTextAnnotation(annotation: TextAnnotation, dx: number, dy: number, canvasSize: Point): TextAnnotation {
  return {
    ...annotation,
    x: clamp(annotation.x + dx, 0, Math.max(canvasSize.x - annotation.boxWidth, 0)),
    y: clamp(annotation.y + dy, 0, Math.max(canvasSize.y - annotation.boxHeight, 0)),
  };
}

/**
 * Moves a stroke annotation while preserving stroke shape and bounds.
 *
 * @param annotation Stroke annotation to move.
 * @param dx Horizontal movement delta.
 * @param dy Vertical movement delta.
 * @param canvasSize Canvas width/height point.
 * @returns Moved stroke annotation.
 */
function moveStrokeAnnotation(
  annotation: StrokeAnnotation,
  dx: number,
  dy: number,
  canvasSize: Point
): StrokeAnnotation {
  if (annotation.points.length === 0) {
    return annotation;
  }

  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  annotation.points.forEach((point) => {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
  });

  const clampedDx = clamp(dx, -minX, canvasSize.x - maxX);
  const clampedDy = clamp(dy, -minY, canvasSize.y - maxY);

  return {
    ...annotation,
    points: annotation.points.map((point) => ({
      x: point.x + clampedDx,
      y: point.y + clampedDy,
    })),
  };
}

/**
 * Clears and redraws the annotation overlay canvas.
 *
 * @param canvas Annotation canvas element.
 * @param width CSS pixel width.
 * @param height CSS pixel height.
 * @param annotations Page annotations to render.
 */
function redrawAnnotationCanvas(
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
  annotations: ViewerAnnotation[]
): void {
  const context = canvas.getContext('2d');
  if (!context) {
    return;
  }

  const dpr = window.devicePixelRatio || 1;

  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.clearRect(0, 0, width, height);

  annotations.forEach((annotation) => {
    if (annotation.kind === 'stroke') {
      drawStroke(context, annotation);
      return;
    }

    drawText(context, annotation);
  });
}

/**
 * Normalizes deserialized localStorage annotation data into safe runtime shape.
 *
 * @param raw Unknown parsed JSON payload.
 * @returns Normalized annotation map keyed by page.
 */
function normalizeAnnotationMap(raw: unknown): AnnotationMap {
  if (!raw || typeof raw !== 'object') {
    return {};
  }

  const normalized: AnnotationMap = {};

  Object.entries(raw as Record<string, unknown>).forEach(([pageKey, rawAnnotations]) => {
    const page = Number(pageKey);

    if (!Number.isFinite(page) || !Array.isArray(rawAnnotations)) {
      return;
    }

    const safeAnnotations: ViewerAnnotation[] = [];

    rawAnnotations.forEach((candidate) => {
      if (!candidate || typeof candidate !== 'object') {
        return;
      }

      const annotation = candidate as Partial<ViewerAnnotation> & Record<string, unknown>;

      if (annotation.kind === 'stroke') {
        if (!Array.isArray(annotation.points) || typeof annotation.id !== 'string') {
          return;
        }

        const points = annotation.points
          .filter((point): point is Point => {
            if (!point || typeof point !== 'object') {
              return false;
            }

            const castPoint = point as Partial<Point>;
            return typeof castPoint.x === 'number' && typeof castPoint.y === 'number';
          })
          .map((point) => ({ x: point.x, y: point.y }));

        safeAnnotations.push({
          id: annotation.id,
          kind: 'stroke',
          mode: annotation.mode === 'highlighter' ? 'highlighter' : 'pen',
          color: typeof annotation.color === 'string' ? annotation.color : TOOL_COLORS[0],
          width: typeof annotation.width === 'number' ? annotation.width : 3,
          points,
        });
        return;
      }

      if (annotation.kind === 'text' && typeof annotation.id === 'string') {
        safeAnnotations.push({
          id: annotation.id,
          kind: 'text',
          color: typeof annotation.color === 'string' ? annotation.color : TOOL_COLORS[0],
          text: typeof annotation.text === 'string' ? annotation.text : '',
          x: typeof annotation.x === 'number' ? annotation.x : 0,
          y: typeof annotation.y === 'number' ? annotation.y : 0,
          fontSize: typeof annotation.fontSize === 'number' ? annotation.fontSize : DEFAULT_TEXT_FONT_SIZE,
          fontFamily: typeof annotation.fontFamily === 'string' ? annotation.fontFamily : DEFAULT_TEXT_FONT_FAMILY,
          boxWidth: typeof annotation.boxWidth === 'number' ? annotation.boxWidth : DEFAULT_TEXT_BOX_WIDTH,
          boxHeight: typeof annotation.boxHeight === 'number' ? annotation.boxHeight : DEFAULT_TEXT_BOX_HEIGHT,
        });
      }
    });

    normalized[page] = safeAnnotations;
  });

  return normalized;
}

/**
 * Main score viewer component.
 *
 * @param score Score metadata used to load and render score assets.
 * @returns Interactive score viewer UI.
 */
export default function ScoreViewer({ score }: ScoreViewerProps): JSX.Element {
  const { user } = useAuth();
  const viewerHostRef = useRef<HTMLDivElement | null>(null);
  const pdfCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const annotationCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const textEditorRef = useRef<HTMLTextAreaElement | null>(null);
  const drawingRef = useRef<DrawingState>({
    active: false,
    pointerId: null,
    mode: null,
    color: TOOL_COLORS[0],
    width: 3,
    points: [],
  });
  const dragRef = useRef<DragState>({
    active: false,
    pointerId: null,
    annotationId: null,
    lastPoint: null,
  });
  const resizeRef = useRef<ResizeState>({
    active: false,
    pointerId: null,
    annotationId: null,
    page: null,
    handle: null,
    startPoint: null,
    startBox: null,
  });

  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null);
  const [loadingPdf, setLoadingPdf] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);

  const [pageNumber, setPageNumber] = useState<number>(1);
  const [pageCount, setPageCount] = useState<number>(0);
  const [pageInputValue, setPageInputValue] = useState<string>('1');
  const [zoomLevel, setZoomLevel] = useState<number>(1);
  const [containerWidth, setContainerWidth] = useState<number>(900);
  const [canvasSize, setCanvasSize] = useState<{ width: number; height: number }>({ width: 0, height: 0 });

  const [toolMode, setToolMode] = useState<ToolMode>('cursor');
  const [activeColor, setActiveColor] = useState<string>(TOOL_COLORS[0]);
  const [textFontFamily, setTextFontFamily] = useState<string>(DEFAULT_TEXT_FONT_FAMILY);
  const [textFontSize, setTextFontSize] = useState<number>(DEFAULT_TEXT_FONT_SIZE);
  const [textFontSizeInput, setTextFontSizeInput] = useState<string>(String(DEFAULT_TEXT_FONT_SIZE));
  const [penWidth, setPenWidth] = useState<number>(3);
  const [highlighterWidth, setHighlighterWidth] = useState<number>(14);
  const [annotationsByPage, setAnnotationsByPage] = useState<AnnotationMap>({});
  const [hydratedScoreId, setHydratedScoreId] = useState<string | null>(null);
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState<EditingTextState | null>(null);
  const [isDraggingSelection, setIsDraggingSelection] = useState<boolean>(false);
  const [isResizingSelection, setIsResizingSelection] = useState<boolean>(false);

  const currentPageAnnotations = useMemo(() => annotationsByPage[pageNumber] ?? [], [annotationsByPage, pageNumber]);
  const activeTextEditor = editingText && editingText.page === pageNumber ? editingText : null;
  const selectedTextAnnotation = useMemo(() => {
    if (!selectedAnnotationId) {
      return null;
    }

    return (
      currentPageAnnotations.find((annotation): annotation is TextAnnotation => {
        return annotation.kind === 'text' && annotation.id === selectedAnnotationId;
      }) ?? null
    );
  }, [currentPageAnnotations, selectedAnnotationId]);
  const textBoxOutline =
    activeTextEditor ??
    (selectedTextAnnotation
      ? {
          x: selectedTextAnnotation.x,
          y: selectedTextAnnotation.y,
          boxWidth: selectedTextAnnotation.boxWidth,
          boxHeight: selectedTextAnnotation.boxHeight,
          color: selectedTextAnnotation.color,
        }
      : null);
  const resizableTextAnnotation = activeTextEditor
    ? {
        id: activeTextEditor.annotationId,
        page: activeTextEditor.page,
        x: activeTextEditor.x,
        y: activeTextEditor.y,
        boxWidth: activeTextEditor.boxWidth,
        boxHeight: activeTextEditor.boxHeight,
      }
    : selectedTextAnnotation
      ? {
          id: selectedTextAnnotation.id,
          page: pageNumber,
          x: selectedTextAnnotation.x,
          y: selectedTextAnnotation.y,
          boxWidth: selectedTextAnnotation.boxWidth,
          boxHeight: selectedTextAnnotation.boxHeight,
        }
      : null;
  const textStyleTarget = activeTextEditor ?? selectedTextAnnotation;

  const canGoPrevious = pageNumber > 1;
  const canGoNext = pageNumber < pageCount;
  const canZoomOut = zoomLevel > MIN_ZOOM;
  const canZoomIn = zoomLevel < MAX_ZOOM;
  const zoomPercent = Math.round(zoomLevel * 100);
  const canvasCursor =
    toolMode === 'cursor'
      ? isDraggingSelection || isResizingSelection
        ? 'grabbing'
        : 'grab'
      : toolMode === 'text'
        ? 'text'
        : 'crosshair';

  useEffect(() => {
    const host = viewerHostRef.current;
    if (!host) {
      return;
    }

    const measure = () => {
      setContainerWidth(Math.max(host.clientWidth - 32, 280));
    };

    measure();

    const observer = new ResizeObserver(() => {
      measure();
    });

    observer.observe(host);

    return () => {
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    setLoadingPdf(true);
    setLoadError(null);
    setRenderError(null);
    setPageCount(0);
    setPageNumber(1);
    setHydratedScoreId(null);
    setSelectedAnnotationId(null);
    setEditingText(null);
    setPdfDoc(null);

    let cancelled = false;
    let loadingTask: ReturnType<typeof getDocument> | null = null;

    async function loadPdf(): Promise<void> {
      try {
        const baseUrl = import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, '') as string | undefined;
        const shouldUseProxy = Boolean(baseUrl && user);

        if (baseUrl && !user) {
          throw new Error('Missing authenticated user for PDF proxy fetch.');
        }

        const fileSource = shouldUseProxy
          ? {
              url: `${baseUrl}/scores/${score.id}/pdf`,
              httpHeaders: {
                Authorization: `Bearer ${await user!.getIdToken()}`,
              },
            }
          : score.pdfUrl;

        if (cancelled) {
          return;
        }

        loadingTask =
          typeof fileSource === 'string'
            ? getDocument({
                url: fileSource,
                disableRange: true,
                disableStream: true,
              })
            : getDocument({
                ...fileSource,
                disableRange: true,
                disableStream: true,
              });
        const nextDoc = await loadingTask.promise;

        if (cancelled) {
          void nextDoc.destroy();
          return;
        }

        setPdfDoc(nextDoc);
        setPageCount(nextDoc.numPages);
        setPageNumber(1);
        setLoadingPdf(false);
      } catch (error: unknown) {
        if (cancelled) {
          return;
        }

        setLoadError(toErrorMessage(error, 'Unable to load this score PDF.'));
        setLoadingPdf(false);
      }
    }

    void loadPdf();

    return () => {
      cancelled = true;
      if (loadingTask) {
        void loadingTask.destroy();
      }
    };
  }, [score.id, score.pdfUrl, user]);

  useEffect(() => {
    if (activeTextEditor && textEditorRef.current) {
      textEditorRef.current.focus();
    }
  }, [activeTextEditor]);

  useEffect(() => {
    try {
      const serialized = window.localStorage.getItem(getAnnotationStorageKey(score.id));

      if (!serialized) {
        setAnnotationsByPage({});
        setHydratedScoreId(score.id);
        return;
      }

      const parsed = JSON.parse(serialized) as unknown;
      setAnnotationsByPage(normalizeAnnotationMap(parsed));
      setHydratedScoreId(score.id);
    } catch {
      setAnnotationsByPage({});
      setHydratedScoreId(score.id);
    }
  }, [score.id]);

  useEffect(() => {
    if (hydratedScoreId !== score.id) {
      return;
    }

    try {
      const key = getAnnotationStorageKey(score.id);

      if (Object.keys(annotationsByPage).length === 0) {
        window.localStorage.removeItem(key);
        return;
      }

      window.localStorage.setItem(key, JSON.stringify(annotationsByPage));
    } catch {
      // Ignore storage failures to keep annotation editing functional.
    }
  }, [annotationsByPage, hydratedScoreId, score.id]);

  useEffect(() => {
    setPageInputValue(String(pageNumber));
  }, [pageNumber]);

  useEffect(() => {
    if (!textStyleTarget) {
      setTextFontSizeInput(String(textFontSize));
      return;
    }

    setTextFontFamily(textStyleTarget.fontFamily);
    setTextFontSize(textStyleTarget.fontSize);
    setTextFontSizeInput(String(textStyleTarget.fontSize));
  }, [textStyleTarget, textFontSize]);

  useEffect(() => {
    return () => {
      if (pdfDoc) {
        void pdfDoc.destroy();
      }
    };
  }, [pdfDoc]);

  useEffect(() => {
    if (!pdfDoc || !pdfCanvasRef.current || !annotationCanvasRef.current) {
      return;
    }

    const activeDocument = pdfDoc;

    let cancelled = false;
    let renderTask: ReturnType<PDFPageProxy['render']> | null = null;

    async function renderPage(): Promise<void> {
      try {
        setRenderError(null);

        const page = await activeDocument.getPage(pageNumber);

        if (cancelled) {
          return;
        }

        const baseViewport = page.getViewport({ scale: 1 });
        const nextScale = Math.max(containerWidth, 280) / baseViewport.width;
        const viewport = page.getViewport({ scale: nextScale });

        const pdfCanvas = pdfCanvasRef.current;
        const annotationCanvas = annotationCanvasRef.current;

        if (!pdfCanvas || !annotationCanvas) {
          return;
        }

        const dpr = window.devicePixelRatio || 1;

        pdfCanvas.width = Math.floor(viewport.width * dpr);
        pdfCanvas.height = Math.floor(viewport.height * dpr);
        pdfCanvas.style.width = `${viewport.width}px`;
        pdfCanvas.style.height = `${viewport.height}px`;

        annotationCanvas.width = Math.floor(viewport.width * dpr);
        annotationCanvas.height = Math.floor(viewport.height * dpr);
        annotationCanvas.style.width = `${viewport.width}px`;
        annotationCanvas.style.height = `${viewport.height}px`;

        const context = pdfCanvas.getContext('2d');

        if (!context) {
          setRenderError('Could not initialize the PDF canvas.');
          return;
        }

        context.setTransform(dpr, 0, 0, dpr, 0, 0);
        context.clearRect(0, 0, viewport.width, viewport.height);

        renderTask = page.render({
          canvas: pdfCanvas,
          canvasContext: context,
          viewport,
        });
        await renderTask.promise;

        if (cancelled) {
          return;
        }

        setCanvasSize({ width: viewport.width, height: viewport.height });
      } catch (error) {
        if (cancelled) {
          return;
        }

        setRenderError(toErrorMessage(error, 'Failed to render this PDF page.'));
      }
    }

    void renderPage();

    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
  }, [containerWidth, pageNumber, pdfDoc]);

  useEffect(() => {
    const annotationCanvas = annotationCanvasRef.current;
    if (!annotationCanvas || canvasSize.width === 0 || canvasSize.height === 0) {
      return;
    }

    redrawAnnotationCanvas(annotationCanvas, canvasSize.width, canvasSize.height, currentPageAnnotations);
  }, [canvasSize, currentPageAnnotations]);

  function appendAnnotation(annotation: ViewerAnnotation): void {
    setAnnotationsByPage((previous) => {
      const pageAnnotations = previous[pageNumber] ?? [];

      return {
        ...previous,
        [pageNumber]: [...pageAnnotations, annotation],
      };
    });
  }

  function updateAnnotationOnPage(
    page: number,
    annotationId: string,
    updater: (annotation: ViewerAnnotation) => ViewerAnnotation | null
  ): void {
    setAnnotationsByPage((previous) => {
      const pageAnnotations = previous[page] ?? [];
      let hasChange = false;

      const updatedAnnotations = pageAnnotations.flatMap((annotation) => {
        if (annotation.id !== annotationId) {
          return [annotation];
        }

        hasChange = true;
        const updated = updater(annotation);

        return updated ? [updated] : [];
      });

      if (!hasChange) {
        return previous;
      }

      return {
        ...previous,
        [page]: updatedAnnotations,
      };
    });
  }

  function removeAnnotationOnPage(page: number, annotationId: string): void {
    setAnnotationsByPage((previous) => {
      const pageAnnotations = previous[page] ?? [];
      const nextAnnotations = pageAnnotations.filter((annotation) => annotation.id !== annotationId);

      if (nextAnnotations.length === pageAnnotations.length) {
        return previous;
      }

      return {
        ...previous,
        [page]: nextAnnotations,
      };
    });
  }

  function openTextEditorForAnnotation(annotation: TextAnnotation, page: number): void {
    setSelectedAnnotationId(annotation.id);
    setEditingText({
      annotationId: annotation.id,
      page,
      draft: annotation.text,
      x: annotation.x,
      y: annotation.y,
      boxWidth: annotation.boxWidth,
      boxHeight: annotation.boxHeight,
      color: annotation.color,
      fontSize: annotation.fontSize,
      fontFamily: annotation.fontFamily,
    });
  }

  function commitEditingText(): void {
    if (!editingText) {
      return;
    }

    const { annotationId, page, draft, x, y, boxWidth, boxHeight, color, fontSize, fontFamily } = editingText;
    const normalized = draft.replace(/\r/g, '');

    updateAnnotationOnPage(page, annotationId, (annotation) => {
      if (annotation.kind !== 'text') {
        return annotation;
      }

      if (normalized.trim().length === 0) {
        return null;
      }

      return {
        ...annotation,
        x,
        y,
        color,
        fontSize,
        fontFamily,
        boxWidth,
        boxHeight,
        text: normalized,
      };
    });

    setEditingText(null);
  }

  function handleTextEditorChange(event: ReactChangeEvent<HTMLTextAreaElement>): void {
    if (!editingText) {
      return;
    }

    const nextDraft = event.target.value;
    const editingSnapshot = editingText;
    const nextBoxHeight = getTextBoxHeight(nextDraft, editingSnapshot.fontSize);

    setEditingText({
      ...editingSnapshot,
      draft: nextDraft,
      boxHeight: nextBoxHeight,
    });

    updateAnnotationOnPage(editingSnapshot.page, editingSnapshot.annotationId, (annotation) => {
      if (annotation.kind !== 'text') {
        return annotation;
      }

      return {
        ...annotation,
        boxHeight: nextBoxHeight,
      };
    });
  }

  function handleTextEditorKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      commitEditingText();
      event.currentTarget.blur();
      return;
    }

    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      commitEditingText();
      event.currentTarget.blur();
    }
  }

  useEffect(() => {
    function handleEscapeKey(event: KeyboardEvent): void {
      if (event.key !== 'Escape') {
        return;
      }

      event.preventDefault();

      if (editingText) {
        commitEditingText();
      }

      drawingRef.current = {
        active: false,
        pointerId: null,
        mode: null,
        color: drawingRef.current.color,
        width: drawingRef.current.width,
        points: [],
      };

      dragRef.current = {
        active: false,
        pointerId: null,
        annotationId: null,
        lastPoint: null,
      };

      resizeRef.current = {
        active: false,
        pointerId: null,
        annotationId: null,
        page: null,
        handle: null,
        startPoint: null,
        startBox: null,
      };

      setIsDraggingSelection(false);
      setIsResizingSelection(false);
      setToolMode('cursor');
    }

    window.addEventListener('keydown', handleEscapeKey);

    return () => {
      window.removeEventListener('keydown', handleEscapeKey);
    };
  }, [editingText]);

  useEffect(() => {
    function handleDeleteKey(event: KeyboardEvent): void {
      if (event.key !== 'Delete' && event.key !== 'Backspace') {
        return;
      }

      const target = event.target as HTMLElement | null;

      if (target) {
        const tagName = target.tagName.toLowerCase();
        const isEditableField =
          tagName === 'input' ||
          tagName === 'textarea' ||
          target.isContentEditable ||
          target.getAttribute('role') === 'textbox';

        if (isEditableField) {
          return;
        }
      }

      const annotationId = selectedAnnotationId ?? editingText?.annotationId;

      if (!annotationId) {
        return;
      }

      event.preventDefault();

      const deletePage =
        editingText && editingText.annotationId === annotationId ? editingText.page : pageNumber;

      removeAnnotationOnPage(deletePage, annotationId);

      if (editingText?.annotationId === annotationId) {
        setEditingText(null);
      }

      if (selectedAnnotationId === annotationId) {
        setSelectedAnnotationId(null);
      }
    }

    window.addEventListener('keydown', handleDeleteKey);

    return () => {
      window.removeEventListener('keydown', handleDeleteKey);
    };
  }, [editingText, pageNumber, selectedAnnotationId]);

  function finishDragging(event: ReactPointerEvent<HTMLCanvasElement>): void {
    const dragging = dragRef.current;

    if (!dragging.active || dragging.pointerId !== event.pointerId) {
      return;
    }

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    dragRef.current = {
      active: false,
      pointerId: null,
      annotationId: null,
      lastPoint: null,
    };

    setIsDraggingSelection(false);
  }

  function handleToolChange(nextMode: ToolMode): void {
    if (toolMode === nextMode) {
      return;
    }

    if (toolMode === 'text' && editingText) {
      commitEditingText();
    }

    setToolMode(nextMode);
  }

  function goToPreviousPage(): void {
    if (editingText) {
      commitEditingText();
    }

    setSelectedAnnotationId(null);
    setPageNumber((current) => Math.max(current - 1, 1));
  }

  function goToNextPage(): void {
    if (editingText) {
      commitEditingText();
    }

    setSelectedAnnotationId(null);
    setPageNumber((current) => Math.min(current + 1, pageCount || 1));
  }

  function applyZoom(nextZoom: number): void {
    setZoomLevel(clamp(Number(nextZoom.toFixed(2)), MIN_ZOOM, MAX_ZOOM));
  }

  function zoomIn(): void {
    applyZoom(zoomLevel + ZOOM_STEP);
  }

  function zoomOut(): void {
    applyZoom(zoomLevel - ZOOM_STEP);
  }

  function resetZoom(): void {
    setZoomLevel(1);
  }

  function commitPageInput(rawValue: string): void {
    const normalized = rawValue.trim();

    if (!normalized) {
      setPageInputValue(String(pageNumber));
      return;
    }

    const parsed = Number(normalized);

    if (!Number.isFinite(parsed)) {
      setPageInputValue(String(pageNumber));
      return;
    }

    const nextPage = clamp(Math.round(parsed), 1, Math.max(pageCount, 1));

    if (editingText) {
      commitEditingText();
    }

    setSelectedAnnotationId(null);
    setPageNumber(nextPage);
  }

  function handlePageInputKeyDown(event: ReactKeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      commitPageInput(event.currentTarget.value);
      event.currentTarget.blur();
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      setPageInputValue(String(pageNumber));
      event.currentTarget.blur();
    }
  }

  function updateActiveTextStyle(nextStyle: { fontFamily?: string; fontSize?: number }): void {
    const nextFontFamily = nextStyle.fontFamily ?? textFontFamily;
    const nextFontSize = nextStyle.fontSize ?? textFontSize;

    setTextFontFamily(nextFontFamily);
    setTextFontSize(nextFontSize);

    if (editingText) {
      setEditingText((previous) => {
        if (!previous) {
          return previous;
        }

        return {
          ...previous,
          fontFamily: nextFontFamily,
          fontSize: nextFontSize,
          boxHeight: Math.max(previous.boxHeight, getTextBoxHeight(previous.draft, nextFontSize)),
        };
      });

      updateAnnotationOnPage(editingText.page, editingText.annotationId, (annotation) => {
        if (annotation.kind !== 'text') {
          return annotation;
        }

        return {
          ...annotation,
          fontFamily: nextFontFamily,
          fontSize: nextFontSize,
          boxHeight: Math.max(annotation.boxHeight, getTextBoxHeight(annotation.text, nextFontSize)),
        };
      });

      return;
    }

    if (selectedTextAnnotation) {
      updateAnnotationOnPage(pageNumber, selectedTextAnnotation.id, (annotation) => {
        if (annotation.kind !== 'text') {
          return annotation;
        }

        return {
          ...annotation,
          fontFamily: nextFontFamily,
          fontSize: nextFontSize,
          boxHeight: Math.max(annotation.boxHeight, getTextBoxHeight(annotation.text, nextFontSize)),
        };
      });
    }
  }

  function commitTextFontSizeInput(rawValue: string): void {
    const normalized = rawValue.trim();

    if (!normalized) {
      setTextFontSizeInput(String(textStyleTarget?.fontSize ?? textFontSize));
      return;
    }

    const parsed = Number(normalized);

    if (!Number.isFinite(parsed)) {
      setTextFontSizeInput(String(textStyleTarget?.fontSize ?? textFontSize));
      return;
    }

    const nextSize = clamp(Math.round(parsed), 10, 96);
    updateActiveTextStyle({ fontSize: nextSize });
    setTextFontSizeInput(String(nextSize));
  }

  function getCurrentCanvasBounds(): { width: number; height: number } {
    const canvas = annotationCanvasRef.current;

    return {
      width: canvasSize.width > 0 ? canvasSize.width : canvas?.clientWidth ?? 0,
      height: canvasSize.height > 0 ? canvasSize.height : canvas?.clientHeight ?? 0,
    };
  }

  function handleResizeHandlePointerDown(
    event: ReactPointerEvent<HTMLButtonElement>,
    handle: ResizeHandle
  ): void {
    if (!resizableTextAnnotation) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    setSelectedAnnotationId(resizableTextAnnotation.id);
    setIsResizingSelection(true);

    resizeRef.current = {
      active: true,
      pointerId: event.pointerId,
      annotationId: resizableTextAnnotation.id,
      page: resizableTextAnnotation.page,
      handle,
      startPoint: { x: event.clientX, y: event.clientY },
      startBox: {
        x: resizableTextAnnotation.x,
        y: resizableTextAnnotation.y,
        boxWidth: resizableTextAnnotation.boxWidth,
        boxHeight: resizableTextAnnotation.boxHeight,
      },
    };
  }

  useEffect(() => {
    function finishResize(): void {
      if (!resizeRef.current.active) {
        return;
      }

      resizeRef.current = {
        active: false,
        pointerId: null,
        annotationId: null,
        page: null,
        handle: null,
        startPoint: null,
        startBox: null,
      };

      setIsResizingSelection(false);
    }

    function handlePointerMove(event: PointerEvent): void {
      const resize = resizeRef.current;

      if (
        !resize.active ||
        resize.pointerId !== event.pointerId ||
        !resize.startPoint ||
        !resize.startBox ||
        !resize.handle ||
        !resize.annotationId ||
        resize.page == null
      ) {
        return;
      }

      event.preventDefault();

      const { width: canvasWidth, height: canvasHeight } = getCurrentCanvasBounds();

      if (canvasWidth <= 0 || canvasHeight <= 0) {
        return;
      }

      const dx = (event.clientX - resize.startPoint.x) / zoomLevel;
      const dy = (event.clientY - resize.startPoint.y) / zoomLevel;
      const handle = resize.handle;

      let nextX = resize.startBox.x;
      let nextY = resize.startBox.y;
      let nextWidth = resize.startBox.boxWidth;
      let nextHeight = resize.startBox.boxHeight;

      if (handle.includes('e')) {
        nextWidth = resize.startBox.boxWidth + dx;
      }

      if (handle.includes('s')) {
        nextHeight = resize.startBox.boxHeight + dy;
      }

      if (handle.includes('w')) {
        nextX = resize.startBox.x + dx;
        nextWidth = resize.startBox.boxWidth - dx;
      }

      if (handle.includes('n')) {
        nextY = resize.startBox.y + dy;
        nextHeight = resize.startBox.boxHeight - dy;
      }

      if (nextWidth < MIN_TEXT_BOX_WIDTH) {
        if (handle.includes('w')) {
          nextX -= MIN_TEXT_BOX_WIDTH - nextWidth;
        }
        nextWidth = MIN_TEXT_BOX_WIDTH;
      }

      if (nextHeight < MIN_TEXT_BOX_HEIGHT) {
        if (handle.includes('n')) {
          nextY -= MIN_TEXT_BOX_HEIGHT - nextHeight;
        }
        nextHeight = MIN_TEXT_BOX_HEIGHT;
      }

      if (nextX < 0) {
        if (handle.includes('w')) {
          nextWidth += nextX;
        }
        nextX = 0;
      }

      if (nextY < 0) {
        if (handle.includes('n')) {
          nextHeight += nextY;
        }
        nextY = 0;
      }

      if (nextX + nextWidth > canvasWidth) {
        nextWidth = canvasWidth - nextX;
      }

      if (nextY + nextHeight > canvasHeight) {
        nextHeight = canvasHeight - nextY;
      }

      nextWidth = Math.max(nextWidth, MIN_TEXT_BOX_WIDTH);
      nextHeight = Math.max(nextHeight, MIN_TEXT_BOX_HEIGHT);

      updateAnnotationOnPage(resize.page, resize.annotationId, (annotation) => {
        if (annotation.kind !== 'text') {
          return annotation;
        }

        return {
          ...annotation,
          x: nextX,
          y: nextY,
          boxWidth: nextWidth,
          boxHeight: nextHeight,
        };
      });

      setEditingText((previous) => {
        if (!previous || previous.annotationId !== resize.annotationId || previous.page !== resize.page) {
          return previous;
        }

        return {
          ...previous,
          x: nextX,
          y: nextY,
          boxWidth: nextWidth,
          boxHeight: nextHeight,
        };
      });
    }

    function handlePointerUp(event: PointerEvent): void {
      if (resizeRef.current.active && resizeRef.current.pointerId === event.pointerId) {
        finishResize();
      }
    }

    window.addEventListener('pointermove', handlePointerMove, { passive: false });
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
    };
  }, [canvasSize.height, canvasSize.width, updateAnnotationOnPage, zoomLevel]);

  function getPointerPoint(event: ReactPointerEvent<HTMLCanvasElement>): Point {
    const bounds = event.currentTarget.getBoundingClientRect();
    const effectiveSize = getEffectiveCanvasSize(event.currentTarget);

    if (bounds.width <= 0 || bounds.height <= 0) {
      return { x: 0, y: 0 };
    }

    const xRatio = (event.clientX - bounds.left) / bounds.width;
    const yRatio = (event.clientY - bounds.top) / bounds.height;

    return {
      x: clamp(xRatio * effectiveSize.width, 0, effectiveSize.width),
      y: clamp(yRatio * effectiveSize.height, 0, effectiveSize.height),
    };
  }

  function getEffectiveCanvasSize(target: HTMLCanvasElement): { width: number; height: number } {
    const width = canvasSize.width > 0 ? canvasSize.width : target.clientWidth;
    const height = canvasSize.height > 0 ? canvasSize.height : target.clientHeight;

    return { width, height };
  }

  function handleCanvasDoubleClick(event: ReactMouseEvent<HTMLCanvasElement>): void {
    const effectiveSize = getEffectiveCanvasSize(event.currentTarget);

    if (effectiveSize.width === 0 || effectiveSize.height === 0) {
      return;
    }

    const bounds = event.currentTarget.getBoundingClientRect();

    if (bounds.width <= 0 || bounds.height <= 0) {
      return;
    }

    const xRatio = (event.clientX - bounds.left) / bounds.width;
    const yRatio = (event.clientY - bounds.top) / bounds.height;

    const point = {
      x: clamp(xRatio * effectiveSize.width, 0, effectiveSize.width),
      y: clamp(yRatio * effectiveSize.height, 0, effectiveSize.height),
    };

    const hitAnnotation = findTopAnnotationAtPoint(point, currentPageAnnotations);

    if (!hitAnnotation || hitAnnotation.kind !== 'text') {
      return;
    }

    event.preventDefault();
    openTextEditorForAnnotation(hitAnnotation, pageNumber);
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLCanvasElement>): void {
    const effectiveSize = getEffectiveCanvasSize(event.currentTarget);

    if (effectiveSize.width === 0 || effectiveSize.height === 0) {
      return;
    }

    if (canvasSize.width === 0 || canvasSize.height === 0) {
      setCanvasSize({ width: effectiveSize.width, height: effectiveSize.height });
    }

    if (editingText && toolMode !== 'text') {
      commitEditingText();
    }

    const bounds = event.currentTarget.getBoundingClientRect();

    if (bounds.width <= 0 || bounds.height <= 0) {
      return;
    }

    const xRatio = (event.clientX - bounds.left) / bounds.width;
    const yRatio = (event.clientY - bounds.top) / bounds.height;

    const point = {
      x: clamp(xRatio * effectiveSize.width, 0, effectiveSize.width),
      y: clamp(yRatio * effectiveSize.height, 0, effectiveSize.height),
    };

    if (toolMode === 'text') {
      if (editingText) {
        commitEditingText();
      }

      const annotation: TextAnnotation = {
        id: crypto.randomUUID(),
        kind: 'text',
        color: activeColor,
        text: '',
        x: clamp(point.x, 0, Math.max(effectiveSize.width - DEFAULT_TEXT_BOX_WIDTH, 0)),
        y: clamp(point.y, 0, Math.max(effectiveSize.height - DEFAULT_TEXT_BOX_HEIGHT, 0)),
        fontSize: textFontSize,
        fontFamily: textFontFamily,
        boxWidth: DEFAULT_TEXT_BOX_WIDTH,
        boxHeight: DEFAULT_TEXT_BOX_HEIGHT,
      };

      appendAnnotation(annotation);
      setSelectedAnnotationId(annotation.id);

      setEditingText({
        annotationId: annotation.id,
        page: pageNumber,
        draft: '',
        x: annotation.x,
        y: annotation.y,
        boxWidth: annotation.boxWidth,
        boxHeight: annotation.boxHeight,
        color: annotation.color,
        fontSize: annotation.fontSize,
        fontFamily: annotation.fontFamily,
      });

      return;
    }

    if (toolMode === 'cursor') {
      const hitAnnotation = findTopAnnotationAtPoint(point, currentPageAnnotations);

      if (!hitAnnotation) {
        setSelectedAnnotationId(null);
        return;
      }

      setSelectedAnnotationId(hitAnnotation.id);

      event.currentTarget.setPointerCapture(event.pointerId);
      dragRef.current = {
        active: true,
        pointerId: event.pointerId,
        annotationId: hitAnnotation.id,
        lastPoint: point,
      };
      setIsDraggingSelection(true);

      return;
    }

    event.currentTarget.setPointerCapture(event.pointerId);
    setSelectedAnnotationId(null);

    const width = toolMode === 'pen' ? penWidth : highlighterWidth;

    drawingRef.current = {
      active: true,
      pointerId: event.pointerId,
      mode: toolMode,
      color: activeColor,
      width,
      points: [point],
    };

    const context = event.currentTarget.getContext('2d');
    if (!context) {
      return;
    }

    const dpr = window.devicePixelRatio || 1;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    configureStrokeContext(context, {
      mode: toolMode,
      color: activeColor,
      width,
    });
    context.beginPath();
    context.moveTo(point.x, point.y);
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLCanvasElement>): void {
    const dragging = dragRef.current;

    if (dragging.active && dragging.pointerId === event.pointerId && dragging.annotationId && dragging.lastPoint) {
      const point = getPointerPoint(event);
      const dx = point.x - dragging.lastPoint.x;
      const dy = point.y - dragging.lastPoint.y;

      dragging.lastPoint = point;

      if (dx === 0 && dy === 0) {
        return;
      }

      const effectiveSize = getEffectiveCanvasSize(event.currentTarget);

      updateAnnotationOnPage(pageNumber, dragging.annotationId, (annotation) => {
        if (annotation.kind === 'text') {
          const moved = moveTextAnnotation(annotation, dx, dy, { x: effectiveSize.width, y: effectiveSize.height });

          setEditingText((previous) => {
            if (!previous || previous.annotationId !== moved.id || previous.page !== pageNumber) {
              return previous;
            }

            return {
              ...previous,
              x: moved.x,
              y: moved.y,
            };
          });

          return moved;
        }

        return moveStrokeAnnotation(annotation, dx, dy, { x: effectiveSize.width, y: effectiveSize.height });
      });
      return;
    }

    const drawing = drawingRef.current;
    if (!drawing.active || drawing.pointerId !== event.pointerId || !drawing.mode) {
      return;
    }

    const point = getPointerPoint(event);
    const lastPoint = drawing.points[drawing.points.length - 1];

    drawing.points.push(point);

    if (!lastPoint) {
      return;
    }

    const context = event.currentTarget.getContext('2d');
    if (!context) {
      return;
    }

    const dpr = window.devicePixelRatio || 1;

    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    configureStrokeContext(context, {
      mode: drawing.mode,
      color: drawing.color,
      width: drawing.width,
    });
    context.beginPath();
    context.moveTo(lastPoint.x, lastPoint.y);
    context.lineTo(point.x, point.y);
    context.stroke();
  }

  function finalizeStroke(event: ReactPointerEvent<HTMLCanvasElement>): void {
    const drawing = drawingRef.current;

    if (!drawing.active || drawing.pointerId !== event.pointerId || !drawing.mode) {
      return;
    }

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    const points = drawing.points.slice();

    drawingRef.current = {
      active: false,
      pointerId: null,
      mode: null,
      color: drawing.color,
      width: drawing.width,
      points: [],
    };

    if (points.length === 0) {
      return;
    }

    const nextAnnotationId = crypto.randomUUID();

    appendAnnotation({
      id: nextAnnotationId,
      kind: 'stroke',
      mode: drawing.mode,
      color: drawing.color,
      width: drawing.width,
      points,
    });
    setSelectedAnnotationId(nextAnnotationId);
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLCanvasElement>): void {
    finishDragging(event);
    finalizeStroke(event);
  }

  function handlePointerCancel(event: ReactPointerEvent<HTMLCanvasElement>): void {
    finishDragging(event);
    finalizeStroke(event);
  }

  function undoCurrentPage(): void {
    if (editingText) {
      commitEditingText();
    }

    setSelectedAnnotationId(null);

    setAnnotationsByPage((previous) => {
      const pageAnnotations = previous[pageNumber] ?? [];

      if (pageAnnotations.length === 0) {
        return previous;
      }

      return {
        ...previous,
        [pageNumber]: pageAnnotations.slice(0, -1),
      };
    });
  }

  function clearCurrentPage(): void {
    if (editingText) {
      commitEditingText();
    }

    setSelectedAnnotationId(null);
    setEditingText(null);

    setAnnotationsByPage((previous) => {
      const pageAnnotations = previous[pageNumber] ?? [];

      if (pageAnnotations.length === 0) {
        return previous;
      }

      return {
        ...previous,
        [pageNumber]: [],
      };
    });
  }

  const colorInputRef = useRef<HTMLInputElement | null>(null);

  return (
    <div className="min-h-screen bg-slate-100">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold text-slate-900">{score.title}</h1>
            <p className="text-sm text-slate-500">
              Page {Math.min(pageNumber, Math.max(pageCount, 1))} of {pageCount || 1}
            </p>
          </div>

          <Link
            to="/"
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
          >
            Back to dashboard
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-start gap-4">
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Tool</p>
              <div className="flex items-center gap-2">
                {(['cursor', 'pen', 'highlighter', 'text'] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => handleToolChange(mode)}
                    className={`rounded-lg px-3 py-2 text-sm font-medium transition ${
                      toolMode === mode
                        ? 'bg-slate-900 text-white'
                        : 'border border-slate-300 text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    {mode === 'cursor' ? 'Cursor' : mode === 'pen' ? 'Pen' : mode === 'highlighter' ? 'Highlighter' : 'Text'}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Color</p>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  aria-label="Choose color"
                  onClick={() => colorInputRef.current?.click()}
                  className="h-7 w-7 rounded-full border border-white/70 ring-2 ring-slate-900 ring-offset-2"
                  style={{ backgroundColor: activeColor }}
                />
                <input
                  ref={colorInputRef}
                  type="color"
                  value={activeColor}
                  onChange={(event) => setActiveColor(event.target.value)}
                  className="sr-only"
                />
              </div>
            </div>

            <label className="flex flex-col gap-2 text-sm font-medium text-slate-700">
              Pen width ({penWidth}px)
              <input
                type="range"
                min={1}
                max={8}
                value={penWidth}
                onChange={(event) => setPenWidth(Number(event.target.value))}
              />
            </label>

            <label className="flex flex-col gap-2 text-sm font-medium text-slate-700">
              Highlighter width ({highlighterWidth}px)
              <input
                type="range"
                min={8}
                max={32}
                value={highlighterWidth}
                onChange={(event) => setHighlighterWidth(Number(event.target.value))}
              />
            </label>

            <label className="flex flex-col gap-2 text-sm font-medium text-slate-700">
              Font
              <select
                value={textStyleTarget?.fontFamily ?? textFontFamily}
                onChange={(event) => {
                  updateActiveTextStyle({ fontFamily: event.target.value });
                }}
                className="rounded-lg border border-slate-300 px-2 py-2 text-sm text-slate-700"
              >
                {FONT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-2 text-sm font-medium text-slate-700">
              Font size
              <input
                type="text"
                inputMode="numeric"
                value={textFontSizeInput}
                onChange={(event) => {
                  const digitsOnly = event.target.value.replace(/[^0-9]/g, '');
                  setTextFontSizeInput(digitsOnly);
                }}
                onBlur={(event) => commitTextFontSizeInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    commitTextFontSizeInput(event.currentTarget.value);
                    event.currentTarget.blur();
                    return;
                  }

                  if (event.key === 'Escape') {
                    event.preventDefault();
                    setTextFontSizeInput(String(textStyleTarget?.fontSize ?? textFontSize));
                    event.currentTarget.blur();
                  }
                }}
                className="w-20 rounded-lg border border-slate-300 px-2 py-2 text-sm text-slate-700"
              />
            </label>

            <div className="ml-auto flex gap-2">
              <button
                type="button"
                onClick={undoCurrentPage}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
              >
                Undo
              </button>
              <button
                type="button"
                onClick={clearCurrentPage}
                className="rounded-lg border border-red-200 px-3 py-2 text-sm font-medium text-red-700 transition hover:bg-red-50"
              >
                Clear page
              </button>
            </div>
          </div>
        </section>

        <section ref={viewerHostRef} className="mt-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
            <h2 className="text-base font-semibold text-slate-900">Score Viewer</h2>
            <div className="flex items-center justify-center gap-2">
              <button
                type="button"
                onClick={goToPreviousPage}
                disabled={!canGoPrevious}
                aria-label="Previous page"
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {'<'}
              </button>

              <input
                type="text"
                inputMode="numeric"
                value={pageInputValue}
                onChange={(event) => {
                  const digitsOnly = event.target.value.replace(/[^0-9]/g, '');
                  setPageInputValue(digitsOnly);
                }}
                onBlur={(event) => commitPageInput(event.target.value)}
                onKeyDown={handlePageInputKeyDown}
                aria-label="Go to page"
                className="w-16 rounded-lg border border-slate-300 px-2 py-2 text-center text-sm font-medium text-slate-700 outline-none ring-slate-300 focus:ring"
              />

              <button
                type="button"
                onClick={goToNextPage}
                disabled={!canGoNext}
                aria-label="Next page"
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {'>'}
              </button>
            </div>

            <div className="justify-self-end">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={zoomOut}
                  disabled={!canZoomOut}
                  aria-label="Zoom out"
                  className="rounded-lg border border-slate-300 px-2 py-1 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  -
                </button>
                <span className="min-w-14 text-center text-sm font-medium text-slate-600">{zoomPercent}%</span>
                <button
                  type="button"
                  onClick={zoomIn}
                  disabled={!canZoomIn}
                  aria-label="Zoom in"
                  className="rounded-lg border border-slate-300 px-2 py-1 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  +
                </button>
                <button
                  type="button"
                  onClick={resetZoom}
                  className="rounded-lg border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
                >
                  Reset
                </button>
              </div>
            </div>
          </div>

          <div className="mt-4 overflow-auto rounded-lg border border-slate-200 bg-slate-50 p-3">
            {loadingPdf ? <p className="text-sm text-slate-600">Loading sheet music...</p> : null}
            {loadError ? <p className="text-sm text-red-700">{loadError}</p> : null}
            {renderError ? <p className="mb-2 text-sm text-red-700">{renderError}</p> : null}

            {!loadError ? (
              <div className="mx-auto w-fit">
                <div
                  className="relative"
                  style={{
                    width: canvasSize.width > 0 ? `${canvasSize.width * zoomLevel}px` : undefined,
                    height: canvasSize.height > 0 ? `${canvasSize.height * zoomLevel}px` : undefined,
                  }}
                >
                  <div
                    className="absolute left-0 top-0 origin-top-left"
                    style={{
                      width: canvasSize.width > 0 ? `${canvasSize.width}px` : undefined,
                      height: canvasSize.height > 0 ? `${canvasSize.height}px` : undefined,
                      transform: `scale(${zoomLevel})`,
                    }}
                  >
                    <canvas ref={pdfCanvasRef} className="relative z-0 block rounded bg-white shadow" />
                    <canvas
                      ref={annotationCanvasRef}
                      className="absolute left-0 top-0 touch-none"
                      style={{ cursor: canvasCursor, zIndex: 10 }}
                      onMouseDown={(e) => {
                        // Prevent focus stealing from the active text editor
                        if (toolMode === 'text' || editingText) {
                          e.preventDefault();
                        }
                      }}
                      onPointerDown={handlePointerDown}
                      onPointerMove={handlePointerMove}
                      onPointerUp={handlePointerUp}
                      onPointerCancel={handlePointerCancel}
                      onDoubleClick={handleCanvasDoubleClick}
                    />
                    {textBoxOutline ? (
                      <div
                        className="pointer-events-none absolute rounded border-2 border-dashed border-sky-500 bg-sky-100/10"
                        style={{
                          left: `${textBoxOutline.x}px`,
                          top: `${textBoxOutline.y}px`,
                          width: `${textBoxOutline.boxWidth}px`,
                          height: `${textBoxOutline.boxHeight}px`,
                          zIndex: 25,
                        }}
                      />
                    ) : null}
                    {resizableTextAnnotation ? (
                      <div
                        className="pointer-events-none absolute"
                        style={{
                          left: `${resizableTextAnnotation.x}px`,
                          top: `${resizableTextAnnotation.y}px`,
                          width: `${resizableTextAnnotation.boxWidth}px`,
                          height: `${resizableTextAnnotation.boxHeight}px`,
                          zIndex: 35,
                        }}
                      >
                        {RESIZE_HANDLE_CONFIGS.map((handle) => (
                          <button
                            key={handle.id}
                            type="button"
                            aria-label={`Resize textbox ${handle.id}`}
                            className={`pointer-events-auto absolute h-3 w-3 rounded-full border border-sky-600 bg-white ${handle.className}`}
                            style={{ cursor: handle.cursor }}
                            onPointerDown={(event) => handleResizeHandlePointerDown(event, handle.id)}
                          />
                        ))}
                      </div>
                    ) : null}
                    {activeTextEditor ? (
                      <textarea
                        ref={textEditorRef}
                        value={activeTextEditor.draft}
                        onChange={handleTextEditorChange}
                        onBlur={commitEditingText}
                        onKeyDown={handleTextEditorKeyDown}
                        onPointerDown={(event) => {
                          event.stopPropagation();
                        }}
                        className="absolute rounded border-2 border-dashed border-sky-500 bg-white/90 px-2 py-1 text-slate-900 shadow-sm outline-none"
                        style={{
                          left: `${activeTextEditor.x}px`,
                          top: `${activeTextEditor.y}px`,
                          width: `${activeTextEditor.boxWidth}px`,
                          height: `${activeTextEditor.boxHeight}px`,
                          color: activeTextEditor.color,
                          fontSize: `${activeTextEditor.fontSize}px`,
                          fontFamily: activeTextEditor.fontFamily,
                          lineHeight: `${getTextLineHeight(activeTextEditor.fontSize)}px`,
                          resize: 'none',
                          zIndex: 30,
                        }}
                        placeholder="Type your annotation"
                      />
                    ) : null}
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </section>
      </main>
    </div>
  );
}
