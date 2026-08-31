import { upload } from '@vercel/blob/client';

function blobPathFor(musicId) {
    const entropy = typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID().replace(/[^a-z0-9-]/gi, '').toLowerCase()
        : Math.random().toString(36).slice(2, 12);
    return `music/${musicId}/v${Date.now()}-${entropy}.mp3`;
}

/**
 * Upload an MP3 directly from the authenticated After Hours browser to Blob.
 * BLOB_READ_WRITE_TOKEN is never exposed: the SDK requests a short-lived,
 * Music-ID-restricted token from /api/music-upload first.
 */
export async function uploadMusicBlob(file, musicId, onProgress) {
    if (!(file instanceof File)) throw new Error('MP3ファイルを選択してください');
    if (!musicId) throw new Error('Music ID がありません');
    if (file.type && file.type !== 'audio/mpeg' && !/\.mp3$/i.test(file.name || '')) {
        throw new Error('MP3 ファイルのみアップロードできます');
    }

    const adminToken = sessionStorage.getItem('admin_token') || '';
    const headers = adminToken ? { Authorization: `Bearer ${adminToken}` } : {};
    const pathname = blobPathFor(musicId);

    return upload(pathname, file, {
        access: 'public',
        handleUploadUrl: '/api/music-upload',
        clientPayload: JSON.stringify({ musicId }),
        headers,
        contentType: 'audio/mpeg',
        multipart: file.size > 4.5 * 1024 * 1024,
        onUploadProgress: onProgress,
    });
}