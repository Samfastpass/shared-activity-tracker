import { signIn, signOut, getSession, onSignedOut } from './auth.js';
import { clearUrlCache } from './photos.js';
import { startRealtime } from './realtime.js';
import { applyTheme, loadProfiles } from './theme.js';
import { createFeed } from './feed.js';
import { setupComposer } from './activity.js';

const $ = (id) => document.getElementById(id);
const loginView = $('login-view');
const appView = $('app-view');
let ctx = null;
let feed;
let stopLive = null;

function showLogin(message = '') {
  stopLive?.(); stopLive = null;       // no live events once signed out
  feed?.clear();                       // and nothing left on the page for the next person
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
  $('whoami').textContent = profile.display_name;
  loginView.hidden = true;
  appView.hidden = false;

  const me = { id: session.user.id, ...profile };
  if (!ctx) {
    ctx = { me, profiles };
    feed = createFeed({ container: $('feed'), moreButton: $('more'), ctx });
    ctx.composer = setupComposer({ dialog: $('composer'), openButton: $('new-activity'), onChanged: () => feed.reload({ silent: true }), ctx });
  } else {
    Object.assign(ctx, { me, profiles });   // a different person may sign in on the same device
  }
  await feed.reload();
  stopLive?.();
  stopLive = startRealtime({
    onActivity: feed.onActivity, onPhoto: feed.onPhoto, onComment: feed.onComment,
    onReconnect: () => feed.reload({ silent: true }),
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
