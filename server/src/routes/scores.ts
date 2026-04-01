import { Router } from 'express';
import multer from 'multer';
import { randomUUID } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb, adminStorage } from '../lib/firebase-admin';
import { verifyToken } from '../middleware/verifyToken';
import type { Score } from '../../../shared/types';

const router = Router();
const VALID_STATUSES: Score['status'][] = ['uploaded', 'processing', 'ready', 'error'];
const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024;

const upload = multer({
	storage: multer.memoryStorage(),
	limits: { fileSize: MAX_FILE_SIZE_BYTES },
	fileFilter: (_req, file, callback) => {
		const isPdfMime = file.mimetype === 'application/pdf';
		const isPdfName = /\.pdf$/i.test(file.originalname);
		callback(null, isPdfMime || isPdfName);
	},
});

function getTitleFromFilename(fileName: string): string {
	return fileName.replace(/\.pdf$/i, '').trim() || 'Untitled Score';
}

function buildFirebaseDownloadUrl(bucketName: string, objectPath: string, token: string): string {
	return `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(objectPath)}?alt=media&token=${token}`;
}

router.use(verifyToken);

router.post('/upload', upload.single('file'), async (req, res) => {
	try {
		const uid = req.user?.uid;
		const file = req.file;

		if (!uid) {
			res.status(401).json({ error: 'Unauthorized.' });
			return;
		}

		if (!file) {
			res.status(400).json({ error: 'Missing PDF file in form-data (field name: file).' });
			return;
		}

		if (file.size > MAX_FILE_SIZE_BYTES) {
			res.status(400).json({ error: 'PDF must be 50 MB or smaller.' });
			return;
		}

		const scoreRef = adminDb.collection('scores').doc();
		const objectPath = `scores/${uid}/${scoreRef.id}/original.pdf`;
		const downloadToken = randomUUID();
		const bucket = adminStorage.bucket();
		const bucketFile = bucket.file(objectPath);

		await bucketFile.save(file.buffer, {
			resumable: false,
			contentType: 'application/pdf',
			metadata: {
				metadata: {
					firebaseStorageDownloadTokens: downloadToken,
				},
			},
		});

		const scorePayload: Score = {
			id: scoreRef.id,
			ownerId: uid,
			title: getTitleFromFilename(file.originalname),
			pdfUrl: buildFirebaseDownloadUrl(bucket.name, objectPath, downloadToken),
			musicXmlUrl: null,
			midiUrl: null,
			status: 'uploaded',
			pageCount: null,
			createdAt: { seconds: 0, nanoseconds: 0 },
			updatedAt: { seconds: 0, nanoseconds: 0 },
		};

		await scoreRef.set({
			id: scorePayload.id,
			ownerId: scorePayload.ownerId,
			title: scorePayload.title,
			pdfUrl: scorePayload.pdfUrl,
			musicXmlUrl: scorePayload.musicXmlUrl,
			midiUrl: scorePayload.midiUrl,
			status: scorePayload.status,
			pageCount: scorePayload.pageCount,
			createdAt: FieldValue.serverTimestamp(),
			updatedAt: FieldValue.serverTimestamp(),
		});

		res.status(201).json({ scoreId: scorePayload.id, score: scorePayload });
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Failed to upload score.';
		res.status(500).json({ error: message });
	}
});

router.post('/', async (req, res) => {
	try {
		const { scoreId } = req.body as { scoreId?: string };
		const uid = req.user?.uid;

		if (!uid) {
			res.status(401).json({ error: 'Unauthorized.' });
			return;
		}

		if (!scoreId) {
			res.status(400).json({ error: 'Missing scoreId.' });
			return;
		}

		const scoreRef = adminDb.collection('scores').doc(scoreId);
		const scoreSnapshot = await scoreRef.get();

		if (!scoreSnapshot.exists) {
			res.status(404).json({ error: 'Score not found.' });
			return;
		}

		const data = scoreSnapshot.data() as Record<string, unknown>;

		if (data.ownerId !== uid) {
			res.status(403).json({ error: 'Forbidden.' });
			return;
		}

		// TODO: Trigger asynchronous OMR pipeline in a background job queue.
		res.status(200).json({ ok: true, scoreId });
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Failed to start score processing.';
		res.status(500).json({ error: message });
	}
});

router.get('/', async (req, res) => {
	try {
		const uid = req.user?.uid;

		if (!uid) {
			res.status(401).json({ error: 'Unauthorized.' });
			return;
		}

		const querySnapshot = await adminDb
			.collection('scores')
			.where('ownerId', '==', uid)
			.orderBy('createdAt', 'desc')
			.get();

		const scores = querySnapshot.docs.map((snapshot) => {
			const data = snapshot.data() as Record<string, unknown>;
			const rawStatus = (data.status as Score['status']) ?? 'uploaded';

			return {
				id: snapshot.id,
				ownerId: String(data.ownerId ?? ''),
				title: String(data.title ?? 'Untitled Score'),
				pdfUrl: String(data.pdfUrl ?? ''),
				musicXmlUrl: (data.musicXmlUrl as string | null) ?? null,
				midiUrl: (data.midiUrl as string | null) ?? null,
				status: VALID_STATUSES.includes(rawStatus) ? rawStatus : 'uploaded',
				pageCount: (data.pageCount as number | null) ?? null,
				createdAt: data.createdAt,
				updatedAt: data.updatedAt,
			};
		});

		res.status(200).json({ scores });
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Failed to fetch scores.';
		res.status(500).json({ error: message });
	}
});

router.delete('/:id', async (req, res) => {
	try {
		const uid = req.user?.uid;
		const scoreId = req.params.id;

		if (!uid) {
			res.status(401).json({ error: 'Unauthorized.' });
			return;
		}

		if (!scoreId) {
			res.status(400).json({ error: 'Missing score id.' });
			return;
		}

		const scoreRef = adminDb.collection('scores').doc(scoreId);
		const scoreSnapshot = await scoreRef.get();

		if (!scoreSnapshot.exists) {
			res.status(404).json({ error: 'Score not found.' });
			return;
		}

		const data = scoreSnapshot.data() as Record<string, unknown>;

		if (data.ownerId !== uid) {
			res.status(403).json({ error: 'Forbidden.' });
			return;
		}

		let storageCleanupWarning: string | null = null;

		try {
			const bucket = adminStorage.bucket();
			const [files] = await bucket.getFiles({ prefix: `scores/${uid}/${scoreId}/` });
			const deletionResults = await Promise.allSettled(files.map((file) => file.delete()));

			const failedDeletes = deletionResults.filter((result) => result.status === 'rejected').length;
			if (failedDeletes > 0) {
				storageCleanupWarning = `Score removed, but ${failedDeletes} file(s) could not be deleted from storage.`;
			}
		} catch (storageError) {
			const message = storageError instanceof Error ? storageError.message : 'Storage cleanup failed.';
			storageCleanupWarning = `Score removed, but storage cleanup failed: ${message}`;
		}

		await scoreRef.delete();

		res.status(200).json({ ok: true, warning: storageCleanupWarning });
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Failed to delete score.';
		res.status(500).json({ error: message });
	}
});

export default router;
