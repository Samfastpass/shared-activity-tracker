import { supabase } from './supabase.js';
import { signUrls } from './photos.js';

// Theme keys map to [data-theme="…"] blocks in css/themes.css.
export const THEMES = [
  { key: 'a', name: 'Ember', blurb: 'Black with red and orange' },
  { key: 'b', name: 'Berry', blurb: 'Maroon with teal' },
];

export function applyTheme(key) {
  document.body.dataset.theme = key || '';
}

// Profiles come with a signed avatarUrl (private bucket, ~1 hour) when they have a picture.
export async function loadProfiles() {
  const { data, error } = await supabase.from('profiles').select('id, display_name, theme, avatar_path');
  if (error) throw error;
  const profiles = new Map(data.map((p) => [p.id, { ...p, avatarUrl: null }]));
  const paths = data.map((p) => p.avatar_path).filter(Boolean);
  if (paths.length) {
    try {
      const urls = await signUrls(paths);
      for (const p of profiles.values()) if (p.avatar_path) p.avatarUrl = urls.get(p.avatar_path) || null;
    } catch { /* initials are shown instead */ }
  }
  return profiles;
}
