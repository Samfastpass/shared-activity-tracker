import { signIn, signOut, getSession, onSignedOut } from './auth.js';
import { clearUrlCache } from './photos.js';
import { applyTheme, loadProfiles } from './theme.js';
import { createFeed } from './feed.js';
import { setupComposer } from './activity.js';

const $ = (id) => document.getElementById(id);
const loginView = $('login-view');
const appView = $('app-view');
let booted = false;
let feed;

function showLogin(message = '') {
  clearUrlCache();                      // signed photo URLs never outlive the session
  applyTheme('');                       // login screen stays neutral
  appView.hidden = true;
  loginView.hidden = false;
  $('login-error').textContent = message;
  $('login-form').querySelector('button').disabled = false;
}

async function boot(session) {
  const profiles = await loadProfiles();
  const me = profiles.get(session.user.id);
  if (!me) {                            // signed in but not on the allow-list
    await signOut();
    showLogin('This account is not set up for this app.');
    return;
  }
  applyTheme(me.theme);
  $('whoami').textContent = me.display_name;
  loginView.hidden = true;
  appView.hidden = false;

  if (!booted) {
    booted = true;
    const ctx = { me: { id: session.user.id, ...me }, profiles };
    feed = createFeed({ container: $('feed'), moreButton: $('more'), ctx });
    ctx.composer = setupComposer({ dialog: $('composer'), openButton: $('new-activity'), onChanged: () => feed.reload(), ctx });
  }
  await feed.reload();
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
