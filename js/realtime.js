import { supabase } from './supabase.js';

// Live updates over Supabase Realtime (postgres_changes). Row Level Security applies to what
// each subscriber receives, so only members get events. Returns a function that stops it.
export function startRealtime({ onActivity, onPhoto, onComment, onReconnect }) {
  let connectedBefore = false;
  const watch = (table, handler) => ({ event: '*', schema: 'public', table, handler });
  const channel = supabase.channel('moments');
  for (const { table, handler } of [
    { table: 'activities', handler: onActivity },
    { table: 'photos', handler: onPhoto },
    { table: 'comments', handler: onComment },
  ]) {
    channel.on('postgres_changes', { event: '*', schema: 'public', table }, (payload) => {
      try { handler(payload); } catch (e) { console.error('realtime handler failed', e); }
    });
  }
  channel.subscribe((status) => {
    if (status !== 'SUBSCRIBED') return;
    // After a dropped connection, events may have been missed: resync once.
    if (connectedBefore) onReconnect();
    connectedBefore = true;
  });
  return () => { supabase.removeChannel(channel); };
}
