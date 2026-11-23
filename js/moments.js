import { supabase } from './supabase.js';
import { signUrls } from './photos.js';

const SELECT = 'id, author_id, title, happened_at, created_at, kind, who_came, place_name, lat, lng, photos(id, storage_path, created_at), favourites(user_id, photo_id)';
const PAGE = 200;

// A moment's headline photos: each person's favourite (the moment's author first), otherwise the
// first photo. Returns [{ photo, by: [user ids] }], at most two.
function headlines(a) {
  const photos = a.photos || [];
  const picked = [];
  const order = [...(a.favourites || [])].sort((x, y) => (y.user_id === a.author_id) - (x.user_id === a.author_id));
  for (const f of order) {
    const photo = photos.find((p) => p.id === f.photo_id);
    if (!photo) continue;
    const same = picked.find((h) => h.photo.id === photo.id);
    if (same) same.by.push(f.user_id); else picked.push({ photo, by: [f.user_id] });
  }
  if (!picked.length && photos[0]) picked.push({ photo: photos[0], by: [] });
  return picked.slice(0, 2);
}

// Every moment, newest first, with signed URLs for just the photos that headline them.
export async function loadMoments() {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase.from('activities').select(SELECT)
      .order('happened_at', { ascending: false }).order('created_at', { ascending: false })
      .order('created_at', { referencedTable: 'photos', ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    rows.push(...data);
    if (data.length < PAGE) break;
  }
  for (const a of rows) a.heroes = headlines(a);
  const paths = rows.flatMap((a) => a.heroes.map((h) => h.photo.storage_path));
  let urls = new Map();
  if (paths.length) { try { urls = await signUrls(paths); } catch { /* placeholders are shown */ } }
  for (const a of rows) for (const h of a.heroes) h.url = urls.get(h.photo.storage_path) || null;
  return rows;
}

export const hasPin = (a) => a.lat != null && a.lng != null;
export const placeKey = (a) => `${Number(a.lat).toFixed(3)},${Number(a.lng).toFixed(3)}`;   // ~100 m: one pin per spot
export const matches = (a, filter) => filter === 'all' || a.kind === filter;
