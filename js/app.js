import { signIn, signOut, getSession, onSignedOut } from './auth.js';
import { clearUrlCache } from './photos.js';
import { startRealtime } from './realtime.js';
import { applyTheme, loadProfiles } from './theme.js';
import { avatar } from './dom.js';
import { setupSettings } from './settings.js';
import { createFeedback } from './feedback.js';
import { createTimeline } from './timeline.js';
import { createMapView } from './mapview.js';
import { setupMomentDialog } from './momentview.js';
import { createFeed } from './feed.js';
import { setupComposer } from './activity.js';

const $ = (id) => document.getElementById(id);
const loginView = $('login-view');
const appView = $('app-view');
let ctx = null;
let feed;
let settings;
let timeline;
let mapView;
let currentView = 'feed';
let stopLive = null;
let lastProfileRefresh = 0;

function refreshActive() {
  if (appView.hidden) return;
  if (currentView === 'timeline') timeline.show();
  if (currentView === 'map') mapView.show();
}

function renderWhoami() {
  $('whoami').textContent = ctx.me.display_name;
  $('whoami-avatar').replaceChildren(avatar(ctx.me, 'small'));
}

// The sections share one page and are addressed by hash (#timeline, #map, #settings), so the
// browser back button and reloads work.
const VIEWS = ['feed', 'timeline', 'map', 'settings'];
const hashView = () => { const v = location.hash.replace('#', ''); return VIEWS.includes(v) ? v : 'feed'; };

function showView(name, force = false) {
  if ((name === 'timeline' || name === 'map') && ctx?.features?.moments2 === false) name = 'feed';   // needs the updated database
  const previous = currentView;
  if (name === previous && !force) return;      // e.g. the hash-change that follows our own switch: don't reset a form being typed in
  currentView = name;
  for (const v of VIEWS) $(`${v}-view`).hidden = v !== name;
  $('new-activity').hidden = name === 'settings' || name === 'map';
  document.querySelectorAll('#tabs a').forEach((a) => { if (a.dataset.tab === name) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  $('tabs').hidden = name === 'settings';
  if (name === 'settings') settings.open(); else if (previous === 'settings') settings.revert();
  if (name === 'timeline') timeline.show();
  if (name === 'map') mapView.show();
}
const route = () => { if (!appView.hidden && ctx) showView(hashView()); };
function go(name) {
  if (name === 'feed') history.replaceState(null, '', location.pathname + location.search);
  else location.hash = name;
  showView(name);
}
window.addEventListener('hashchange', route);

// The other person may have changed their name, picture or theme.
async function refreshProfiles() {
  lastProfileRefresh = Date.now();
  try {
    const fresh = await loadProfiles();
    const sig = (m) => JSON.stringify([...m].map(([id, p]) => [id, p.display_name, p.theme, p.avatar_path]).sort());
    const changed = sig(fresh) !== sig(ctx.profiles);
    for (const [id, p] of fresh) {
      const mine = ctx.profiles.get(id);
      if (mine) Object.assign(mine, p); else ctx.profiles.set(id, p);     // keep ctx.me's identity
    }
    if (changed) { renderWhoami(); await feed.reload({ silent: true }); }
  } catch { /* try again next time */ }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && ctx && !appView.hidden && Date.now() - lastProfileRefresh > 30000) refreshProfiles();
});

function showLogin(message = '') {
  stopLive?.(); stopLive = null;       // no live events once signed out
  if (location.hash) history.replaceState(null, '', location.pathname + location.search);
  timeline?.clear(); mapView?.clear();
  feed?.clear();                       // and nothing left on the page for the next person
  ctx?.feedback?.clear();
  clearUrlCache();                      // signed photo URLs never outlive the session
  applyTheme('');                       // login screen stays neutral
  appView.hidden = true;
  loginView.hidden = false;
  $('login-error').textContent = message;
  $('login-form').querySelector('button').disabled = false;
}

async function boot(session) {
  const profiles = await loadProfiles();
  const profile = profiles.get(session.user.id);
  if (!profile) {                            // signed in but not on the allow-list
    await signOut();
    showLogin('This account is not set up for this app.');
    return;
  }
  applyTheme(profile.theme);
  loginView.hidden = true;
  appView.hidden = false;

  const me = profile;                       // same object as in the profiles map (it has the id)
  if (!ctx) {
    ctx = { me, profiles, features: { moments2: true } };
    feed = createFeed({ container: $('feed'), moreButton: $('more'), ctx });
    ctx.composer = setupComposer({ dialog: $('composer'), openButton: $('new-activity'), onChanged: () => feed.reload({ silent: true }), ctx });
    ctx.feedback = createFeedback({ ctx, banner: $('feedback-banner'), onChanged: (id) => feed.refreshFeedback(id) });
    settings = setupSettings({
      ctx,
      onBack: () => go('feed'),
      onSaved: async () => { applyTheme(ctx.me.theme); renderWhoami(); go('feed'); await feed.reload({ silent: true }); },
    });
    $('open-settings').addEventListener('click', () => go('settings'));
    const moment = setupMomentDialog({ ctx, onChanged: () => { feed.reload({ silent: true }); refreshActive(); } });
    timeline = createTimeline({ ctx, view: $('timeline-view'), openMoment: moment.open });
    mapView = createMapView({ ctx, view: $('map-view'), openMoment: moment.open });
    let refreshTimer = null;
    ctx.dataChanged = () => { clearTimeout(refreshTimer); refreshTimer = setTimeout(refreshActive, 600); };   // live changes while a section is open
  } else {
    Object.assign(ctx, { me, profiles });   // a different person may sign in on the same device
  }
  renderWhoami();
  lastProfileRefresh = Date.now();
  await ctx.feedback.load();                // before the feed, so cards render with their requests
  await feed.reload();
  document.querySelectorAll('#tabs [data-needs="v2"]').forEach((a) => { a.hidden = ctx.features.moments2 === false; });   // the feed load tells us
  showView(hashView(), true);
  stopLive?.();
  stopLive = startRealtime({
    onActivity: feed.onActivity, onPhoto: feed.onPhoto, onComment: feed.onComment, extras: [
      { topic: 'moments-feedback', table: 'feedback_requests', handler: ctx.feedback.onEvent },
      { topic: 'moments-favourites', table: 'favourites', handler: feed.onFavourite },
    ],
    onReconnect: async () => { refreshProfiles(); await ctx.feedback.load(); feed.reload({ silent: true }); },
  });
}

$('login-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const form = ev.currentTarget;
  const button = form.querySelector('button');
  button.disabled = true;
  $('login-error').textContent = '';
  try {
    const session = await signIn(form.elements.email.value.trim(), form.elements.password.value);
    form.elements.password.value = '';
    await boot(session);
  } catch (e) {
    showLogin(e.message === 'Invalid login credentials' ? 'Wrong email or password.' : e.message);
  }
});

$('sign-out').addEventListener('click', signOut);
onSignedOut(() => showLogin());

(async function init() {
  try {
    const session = await getSession();
    if (session) await boot(session); else showLogin();
  } catch (e) {
    showLogin(`Couldn't start: ${e.message}`);
  }
})();
