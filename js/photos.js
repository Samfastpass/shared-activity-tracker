import imageCompression from 'https://esm.sh/browser-image-compression@2.0.2';
import { supabase } from './supabase.js';

const BUCKET = 'photos';
const URL_TTL_SECONDS = 3600;            // signed URLs live ~1 hour
const REFRESH_MARGIN_MS = 5 * 60 * 1000; // re-sign when less than 5 minutes remain
export const MAX_PER_BATCH = 10;

// Signed URLs are kept in memory only (never localStorage / service-worker caches).
const urlCache = new Map();              // storage_path -> { url, expiresAt }

export function clearUrlCache() { urlCache.clear(); }
export function forgetUrl(path) { urlCache.delete(path); }

// One batched request for every path that isn't cached yet. Returns Map(path -> url).
export async function signUrls(paths) {
  const now = Date.now();
  const stale = [...new Set(paths)].filter((p) => {
    const hit = urlCache.get(p);
    return !hit || hit.expiresAt - now < REFRESH_MARGIN_MS;
  });
  if (stale.length) {
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrls(stale, URL_TTL_SECONDS);
    if (error) throw error;
    for (const item of data) {
      if (item.signedUrl) urlCache.set(item.path, { url: item.signedUrl, expiresAt: now + URL_TTL_SECONDS * 1000 });
    }
  }
  const out = new Map();
  for (const p of paths) { const hit = urlCache.get(p); if (hit) out.set(p, hit.url); }
  return out;
}

// Resize to max 1920px, JPEG ~0.8 quality. Re-encoding through a canvas drops all
// EXIF (including GPS) and bakes in the orientation; preserveExif is explicitly off.
export async function prepareImage(file) {
  if (!file.type.startsWith('image/')) throw new Error('That file is not an image.');
  let compressed;
  try {
    compressed = await imageCompression(file, {
      maxSizeMB: 2,
      maxWidthOrHeight: 1920,
      initialQuality: 0.8,
      fileType: 'image/jpeg',
      useWebWorker: true,
      preserveExif: false,
    });
  } catch {
    throw new Error("Couldn't read this photo.");
  }
  const bitmap = await createImageBitmap(compressed);
  const prepared = { blob: compressed, width: bitmap.width, height: bitmap.height };
  bitmap.close?.();
  return prepared;
}

// Storage object first, then its row; if the row fails the object is removed again.
export async function uploadPhoto({ activityId, userId, prepared }) {
  const path = `${userId}/${activityId}/${crypto.randomUUID()}.jpg`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, prepared.blob, {
    contentType: 'image/jpeg', upsert: false, cacheControl: '3600',
  });
  if (error) throw error;
  const { error: rowError } = await supabase.from('photos').insert({
    activity_id: activityId, storage_path: path, width: prepared.width, height: prepared.height,
  });
  if (rowError) {
    await supabase.storage.from(BUCKET).remove([path]).catch(() => {});
    throw rowError;
  }
  return path;
}

export async function removeFiles(paths) {
  if (!paths.length) return;
  const { error } = await supabase.storage.from(BUCKET).remove(paths);
  if (error) throw error;
}

export async function deletePhoto({ id, storage_path }) {
  const { error } = await supabase.from('photos').delete().eq('id', id);
  if (error) throw error;
  await removeFiles([storage_path]).catch(() => {});   // row is gone; an orphaned file is harmless
  forgetUrl(storage_path);
}

// Square 256px JPEG for a profile picture. Re-encoded through a canvas, so EXIF/GPS is dropped.
export async function prepareAvatar(file) {
  if (!file.type.startsWith('image/')) throw new Error('That file is not an image.');
  let small;
  try {
    small = await imageCompression(file, { maxWidthOrHeight: 512, initialQuality: 0.9, fileType: 'image/jpeg', useWebWorker: true, preserveExif: false });
  } catch {
    throw new Error("Couldn't read this photo.");
  }
  const bitmap = await createImageBitmap(small);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const g = canvas.getContext('2d');
  g.fillStyle = '#fff';
  g.fillRect(0, 0, 256, 256);
  g.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, 256, 256);
  bitmap.close?.();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
  if (!blob) throw new Error("Couldn't prepare this photo.");
  return blob;
}

export async function uploadAvatar(userId, blob) {
  const path = `${userId}/avatar/${crypto.randomUUID()}.jpg`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: 'image/jpeg', upsert: false, cacheControl: '3600' });
  if (error) throw error;
  return path;
}
