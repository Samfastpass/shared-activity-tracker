import { supabase } from './supabase.js';
import { el, toast } from './dom.js';

const MAX_QUESTIONS = 5;
const IDEAS = ['What was your favourite part?', 'What should we do differently next time?', 'How did it make you feel?', 'Would you do it again?'];
const SELECT = 'id, activity_id, requester_id, recipient_id, questions, answers, status, created_at, answered_at, activities(title)';
const $ = (id) => document.getElementById(id);

// "Meet feedback": one person asks the other for feedback on a post, writing 1-5 questions.
// Both of them can read the answers. If the table isn't there yet (database not updated) the
// feature simply stays hidden.
export function createFeedback({ ctx, banner, onChanged }) {
  const items = new Map();          // request id -> request
  let available = false;
  let askFor = null;                // the post the ask dialog is about
  let answering = null;             // the request the answer dialog is about

  const name = (id) => ctx.profiles.get(id)?.display_name || 'Someone';
  const theme = (id) => ctx.profiles.get(id)?.theme || '';
  const other = () => [...ctx.profiles.values()].find((p) => p.id !== ctx.me.id) || null;
  const titleOf = (r) => r.activities?.title ?? 'a moment';
  const forActivity = (id) => [...items.values()].filter((r) => r.activity_id === id).sort((a, b) => a.created_at.localeCompare(b.created_at));

  async function load() {
    const { data, error } = await supabase.from('feedback_requests').select(SELECT).order('created_at', { ascending: true });
    items.clear();
    available = !error;
    if (!error) data.forEach((r) => items.set(r.id, r));
    renderBanner();
  }

  function clear() { items.clear(); available = false; renderBanner(); }

  async function fetchOne(id) {
    const { data, error } = await supabase.from('feedback_requests').select(SELECT).eq('id', id).maybeSingle();
    if (error) throw error;
    return data;
  }

  function store(row) { items.set(row.id, row); renderBanner(); onChanged(row.activity_id); }

  // ---------- live events ----------
  async function onEvent(payload) {
    if (payload.eventType === 'DELETE') {
      const old = items.get(payload.old?.id);
      items.delete(payload.old?.id);
      renderBanner();
      if (old) onChanged(old.activity_id);
      return;
    }
    let row;
    try { row = await fetchOne(payload.new.id); } catch { return; }
    if (!row) return;
    const prev = items.get(row.id);
    available = true;
    store(row);
    if (payload.eventType === 'INSERT' && !prev && row.recipient_id === ctx.me.id) {
      toast(`${name(row.requester_id)} asked for your feedback on “${titleOf(row)}”`);
    } else if (row.status === 'answered' && prev?.status !== 'answered' && row.requester_id === ctx.me.id) {
      toast(`${name(row.recipient_id)} answered your feedback request`);
    }
  }

  // ---------- banner: requests waiting for me ----------
  function renderBanner() {
    const waiting = [...items.values()].filter((r) => r.recipient_id === ctx.me.id && r.status === 'pending');
    banner.hidden = !waiting.length;
    banner.replaceChildren(...waiting.map((r) => el('div', { class: 'fb-banner-row', 'data-author-theme': theme(r.requester_id) },
      el('span', {}, el('strong', {}, name(r.requester_id)), ` asked for your feedback on “${titleOf(r)}”`),
      el('button', { class: 'btn primary small', type: 'button', onclick: () => openAnswer(r) }, 'Answer'))));
  }

  // ---------- what a post card shows ----------
  function sectionFor(activity) {
    return available ? forActivity(activity.id).map(box) : [];
  }

  function box(r) {
    const asRecipient = r.recipient_id === ctx.me.id;
    const withdraw = r.requester_id === ctx.me.id && el('button', {
      class: 'link danger', type: 'button',
      onclick: () => remove(r),
    }, r.status === 'pending' ? 'Withdraw' : 'Remove');

    if (r.status === 'pending') {
      return el('div', { class: 'fb-box pending', 'data-request-id': r.id, 'data-author-theme': theme(r.requester_id) },
        el('div', { class: 'fb-head' },
          asRecipient ? el('span', {}, el('strong', {}, name(r.requester_id)), ' asked for your feedback')
                      : el('span', {}, 'Waiting for ', el('strong', {}, name(r.recipient_id)), '’s feedback'),
          asRecipient ? el('button', { class: 'btn primary small', type: 'button', onclick: () => openAnswer(r) }, 'Answer') : withdraw),
        el('ul', { class: 'fb-questions' }, ...r.questions.map((q) => el('li', {}, q))));
    }
    return el('div', { class: 'fb-box answered', 'data-request-id': r.id, 'data-author-theme': theme(r.recipient_id) },
      el('div', { class: 'fb-head' },
        el('span', {}, el('strong', {}, name(r.recipient_id)), ` gave feedback to ${name(r.requester_id)}`),
        withdraw),
      ...r.questions.map((q, i) => el('div', { class: 'fb-qa' },
        el('p', { class: 'fb-q' }, q),
        el('p', { class: 'fb-a' }, r.answers?.[i]?.trim() || '—'))));
  }

  async function remove(r) {
    if (!confirm(r.status === 'pending' ? 'Withdraw this feedback request?' : 'Remove this feedback and its answers?')) return;
    const { error } = await supabase.from('feedback_requests').delete().eq('id', r.id);
    if (error) return toast(`Couldn't remove: ${error.message}`);
    items.delete(r.id);
    renderBanner();
    onChanged(r.activity_id);
  }

  // ---------- ask dialog ----------
  const askDialog = $('ask-dialog');
  const askForm = $('ask-form');
  const askList = $('ask-questions');
  const askStatus = askForm.querySelector('.status');
  const questionInputs = () => [...askList.querySelectorAll('input')];

  function syncAskControls() {
    const n = questionInputs().length;
    $('ask-add').disabled = n >= MAX_QUESTIONS;
    askList.querySelectorAll('.q-remove').forEach((b) => { b.hidden = n <= 1; });
  }

  function addQuestion(text = '') {
    if (questionInputs().length >= MAX_QUESTIONS) return null;
    const input = el('input', { type: 'text', maxlength: 300, placeholder: 'Write a question…', 'aria-label': 'Question', value: text });
    const row = el('div', { class: 'q-row' }, input,
      el('button', { class: 'link q-remove', type: 'button', 'aria-label': 'Remove this question', onclick: () => { row.remove(); syncAskControls(); } }, '✕'));
    askList.append(row);
    syncAskControls();
    return input;
  }

  $('ask-chips').replaceChildren(...IDEAS.map((idea) => el('button', {
    class: 'chip', type: 'button',
    onclick: () => {
      const empty = questionInputs().find((i) => !i.value.trim());
      const input = empty || addQuestion();
      if (input) { input.value = idea; input.focus(); }
    },
  }, idea)));
  askList.addEventListener('input', () => { askStatus.textContent = ''; });
  $('ask-add').addEventListener('click', () => addQuestion()?.focus());
  askDialog.querySelector('[data-cancel]').addEventListener('click', () => askDialog.close());

  function openAsk(activity) {
    const who = other();
    if (!who) return toast('There is nobody else to ask yet.');
    askFor = activity;
    $('ask-title').textContent = `Ask ${who.display_name} for feedback`;
    $('ask-sub').textContent = `About “${activity.title}”. Write 1 to ${MAX_QUESTIONS} questions.`;
    askList.replaceChildren();
    askStatus.textContent = '';
    addQuestion();
    askDialog.showModal();
    questionInputs()[0].focus();
  }

  askForm.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const questions = questionInputs().map((i) => i.value.trim()).filter(Boolean);
    if (!questions.length) { askStatus.textContent = 'Write at least one question.'; return; }
    const who = other();
    const button = askForm.querySelector('button[type=submit]');
    button.disabled = true; askStatus.textContent = '';
    try {
      const { data, error } = await supabase.from('feedback_requests')
        .insert({ activity_id: askFor.id, recipient_id: who.id, questions }).select(SELECT).single();
      if (error) throw error;
      available = true;
      store(data);
      askDialog.close();
      toast(`Feedback request sent to ${who.display_name}`);
    } catch (e) {
      askStatus.textContent = `Couldn't send: ${e.message}`;
    } finally { button.disabled = false; }
  });

  // ---------- answer dialog ----------
  const answerDialog = $('answer-dialog');
  const answerForm = $('answer-form');
  const answerStatus = answerForm.querySelector('.status');
  answerDialog.querySelector('[data-cancel]').addEventListener('click', () => answerDialog.close());
  $('answer-fields').addEventListener('input', () => { answerStatus.textContent = ''; });

  function openAnswer(r) {
    answering = r;
    $('answer-title').textContent = `${name(r.requester_id)} would love your feedback`;
    $('answer-sub').textContent = `About “${titleOf(r)}”`;
    $('answer-fields').replaceChildren(...r.questions.map((q, i) => el('label', {},
      q, el('textarea', { name: `a${i}`, rows: 3, maxlength: 2000, placeholder: 'Your answer…' }))));
    answerStatus.textContent = '';
    answerDialog.showModal();
    answerForm.querySelector('textarea')?.focus();
  }

  answerForm.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const answers = answering.questions.map((_, i) => answerForm.elements[`a${i}`].value.trim());
    if (!answers.some(Boolean)) { answerStatus.textContent = 'Please answer at least one question.'; return; }
    const button = answerForm.querySelector('button[type=submit]');
    button.disabled = true; answerStatus.textContent = '';
    try {
      const { data, error } = await supabase.from('feedback_requests').update({ answers }).eq('id', answering.id).select(SELECT);
      if (error) throw error;
      if (!data.length) throw new Error('this request was withdrawn or already answered');
      store(data[0]);
      answerDialog.close();
      toast('Thanks, your feedback was sent');
    } catch (e) {
      answerStatus.textContent = `Couldn't send: ${e.message}`;
    } finally { button.disabled = false; }
  });

  return { load, clear, onEvent, sectionFor, openAsk, openAnswer, available: () => available, other };
}
