import { signIn, signOut, getSession, onSignedOut } from './auth.js';
import { clearUrlCache } from './photos.js';
import { startRealtime } from './realtime.js';
import { applyTheme, loadProfiles } from './theme.js';
import { avatar } from './dom.js';
import { setupSettings } from './settings.js';
import { createFeedback } from './feedback.js';
import { createFeed } from './feed.js';
import { setupComposer } from './activity.js';

const $ = (id) => document.getElementById(id);
const loginView = $('login-view');
const appView = $('app-view');
let ctx = null;
let feed;
let settings;
let stopLive = null;
let lastProfileRefresh = 0;

function renderWhoami() {
  $('whoami').textContent = ctx.me.display_name;
  $('whoami-avatar').replaceChildren(avatar(ctx.me, 'small'));
}

// Two views share the page: the feed and settings (#settings, so the back button works).
function showView(name) {
  const inSettings = name === 'settings';
  $('feed-view').hidden = inSettings;
  $('settings-view').hidden = !inSettings;
  $('new-activity').hidden = inSettings;
  if (inSettings) settings.open(); else settings.revert();
}
const route = () => { if (!appView.hidden && ctx) showView(location.hash === '#settings' ? 'settings' : 'feed'); };
function go(name) {
  if (name === 'settings') location.hash = 'settings';
  else history.replaceState(null, '', location.pathname + location.search);
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
    ctx = { me, profiles };
    feed = createFeed({ container: $('feed'), moreButton: $('more'), ctx });
    ctx.composer = setupComposer({ dialog: $('composer'), openButton: $('new-activity'), onChanged: () => feed.reload({ silent: true }), ctx });
    ctx.feedback = createFeedback({ ctx, banner: $('feedback-banner'), onChanged: (id) => feed.refreshFeedback(id) });
    settings = setupSettings({
      ctx,
      onBack: () => go('feed'),
      onSaved: async () => { applyTheme(ctx.me.theme); renderWhoami(); go('feed'); await feed.reload({ silent: true }); },
    });
    $('open-settings').addEventListener('click', () => go('settings'));
  } else {
    Object.assign(ctx, { me, profiles });   // a different person may sign in on the same device
  }
  renderWhoami();
  showView(location.hash === '#settings' ? 'settings' : 'feed');
  lastProfileRefresh = Date.now();
  await ctx.feedback.load();                // before the feed, so cards render with their requests
  await feed.reload();
  stopLive?.();
  stopLive = startRealtime({
    onActivity: feed.onActivity, onPhoto: feed.onPhoto, onComment: feed.onComment, onFeedback: ctx.feedback.onEvent,
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
