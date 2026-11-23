import { supabase } from './supabase.js';

// Live updates over Supabase Realtime (postgres_changes). Row Level Security applies to what
// each subscriber receives, so only members get events. Returns a function that stops it.
//
// Newer tables (`extras`: [{ topic, table, handler }]) each get their own channel: if one isn't
// available (for example the database hasn't been updated yet) it can't break live updates for
// posts, photos and comments.
export function startRealtime({ onActivity, onPhoto, onComment, extras = [], onReconnect }) {
  let resyncTimer = null;
  const resync = () => { clearTimeout(resyncTimer); resyncTimer = setTimeout(onReconnect, 500); };

  function open(topic, tables) {
    let connectedBefore = false;
    const channel = supabase.channel(topic);
    for (const [table, handler] of tables) {
      channel.on('postgres_changes', { event: '*', schema: 'public', table }, (payload) => {
        try { handler(payload); } catch (e) { console.error('realtime handler failed', e); }
      });
    }
    channel.subscribe((status) => {
      if (status !== 'SUBSCRIBED') return;
      // After a dropped connection, events may have been missed: resync once.
      if (connectedBefore) resync();
      connectedBefore = true;
    });
    return channel;
  }

  const channels = [open('moments', [['activities', onActivity], ['photos', onPhoto], ['comments', onComment]])];
  for (const { topic, table, handler } of extras) channels.push(open(topic, [[table, handler]]));
  return () => { clearTimeout(resyncTimer); channels.forEach((c) => supabase.removeChannel(c)); };
}
