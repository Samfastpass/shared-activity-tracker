import { supabase } from './supabase.js';

// Theme keys map to [data-theme="…"] blocks in css/themes.css.
export function applyTheme(key) {
  document.body.dataset.theme = key || '';
}

export async function loadProfiles() {
  const { data, error } = await supabase.from('profiles').select('id, display_name, theme, avatar_path');
  if (error) throw error;
  return new Map(data.map((p) => [p.id, p]));
}
