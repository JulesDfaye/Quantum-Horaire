const $ = (selector) => document.querySelector(selector);
const state = { user: null, fiche: null, register: false, adminReading: false };
const monthNames = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

function monthLabel(value) {
  const [year, month] = value.split('-').map(Number);
  return `${monthNames[month - 1]} ${year}`;
}
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}
function toast(message) {
  const node = $('#toast');
  node.textContent = message;
  node.classList.add('visible');
  clearTimeout(toast.timeout);
  toast.timeout = setTimeout(() => node.classList.remove('visible'), 3200);
}
async function api(url, options = {}) {
  const headers = { ...(options.body ? { 'Content-Type': 'application/json', 'X-Requested-With': 'qh' } : {}), ...options.headers };
  let response;
  try {
    response = await fetch(url, { ...options, headers, credentials: 'same-origin' });
  } catch {
    throw new Error('Connexion au serveur impossible. Vérifiez votre accès internet.');
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || 'Une erreur est survenue.');
  return body;
}
function showView(view) {
  for (const section of document.querySelectorAll('.view')) section.classList.toggle('hidden', section.id !== `${view}-view`);
  for (const button of document.querySelectorAll('.nav-item')) button.classList.toggle('active', button.dataset.view === view);
  $('#page-label').textContent = view === 'profile' ? 'Mon établissement' : view === 'admin' ? 'Inspection' : view === 'fiche' ? 'Fiche mensuelle' : 'Tableau de bord';
}
function setUser(user) {
  state.user = user;
  $('#auth-screen').classList.add('hidden');
  $('#app-shell').classList.remove('hidden');
  $('#user-name').textContent = user.name;
  $('#user-avatar').textContent = user.name.trim().charAt(0).toLocaleUpperCase('fr');
  $('#user-role').textContent = user.role === 'admin' ? 'Inspection' : 'Direction';
  $('#admin-nav').classList.toggle('hidden', user.role !== 'admin');
  document.querySelectorAll('.director-nav').forEach((item) => item.classList.toggle('hidden', user.role === 'admin'));
  $('#today-label').textContent = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long' }).format(new Date());
  if (user.role === 'admin') {
    const now = new Date();
    $('#admin-month').value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    showView('admin');
    loadAdmin();
  } else {
    showView('dashboard');
    loadFiches();
  }
}
function setAuthMode(register) {
  state.register = register;
  document.querySelectorAll('.register-only').forEach((element) => element.classList.toggle('hidden', !register));
  $('#auth-name').required = register;
  $('#auth-title').textContent = register ? 'Bienvenue.' : 'Ravi de vous revoir.';
  $('#auth-subtitle').textContent = register ? 'Créez votre espace de suivi scolaire.' : 'Connectez-vous pour retrouver vos fiches.';
  $('#auth-eyebrow').textContent = register ? 'CRÉER VOTRE ESPACE' : 'VOTRE ESPACE DE TRAVAIL';
  $('#auth-submit').innerHTML = register ? 'Créer mon compte <span>↗</span>' : 'Se connecter <span>↗</span>';
  $('#auth-switch').innerHTML = register ? 'Déjà un compte ? <button type="button" id="toggle-auth">Se connecter</button>' : 'Pas encore de compte ? <button type="button" id="toggle-auth">Créer un compte</button>';
  $('#auth-password').autocomplete = register ? 'new-password' : 'current-password';
  $('#auth-error').textContent = '';
}
async function loadFiches() {
  try {
    const { fiches } = await api('/api/fiches');
    $('#fiche-count').textContent = String(fiches.length).padStart(2, '0');
    $('#latest-fiche').textContent = fiches.length ? monthLabel(fiches[0].month) : 'Aucune pour le moment';
    $('#history-count').textContent = fiches.length ? `${fiches.length} période${fiches.length > 1 ? 's' : ''}` : '';
    $('#empty-state').classList.toggle('hidden', fiches.length > 0);
    $('#fiche-list').innerHTML = fiches.map((fiche) => `<tr><td class="month-cell">${escapeHtml(monthLabel(fiche.month))}</td><td>${escapeHtml(fiche.school || 'Établissement non renseigné')}</td><td>${escapeHtml(new Intl.DateTimeFormat('fr-FR').format(new Date(`${fiche.updatedAt.replace(' ', 'T')}Z`)))}</td><td><button class="table-action" data-open-fiche="${fiche.id}">Ouvrir ↗</button></td></tr>`).join('');
    document.querySelectorAll('[data-open-fiche]').forEach((button) => button.addEventListener('click', () => openFiche(button.dataset.openFiche)));
  } catch (error) {
    toast(error.message);
  }
}
async function openFiche(id, adminReading = false) {
  try {
    const result = await api(`/api/fiches/${id}`);
    state.fiche = result.fiche;
    state.adminReading = adminReading;
    $('#fiche-eyebrow').textContent = `FICHE MENSUELLE · ${String(result.fiche.teachers.length).padStart(2, '0')} ENSEIGNANT(E)S`;
    $('#fiche-title').textContent = monthLabel(result.fiche.month);
    $('#fiche-month').value = result.fiche.month;
    $('#fiche-school').value = result.fiche.school || '';
    $('#fiche-school').disabled = adminReading;
    $('#fiche-notes').value = result.fiche.notes || '';
    $('#fiche-notes').disabled = adminReading;
    $('#save-fiche').classList.toggle('hidden', adminReading);
    $('#add-teacher').classList.toggle('hidden', adminReading);
    renderTeachers(result.fiche.teachers);
    $('#save-status').textContent = '';
    showView('fiche');
  } catch (error) { toast(error.message); }
}
function renderTeachers(teachers) {
  $('#teacher-empty').classList.toggle('hidden', teachers.length > 0);
  $('#teacher-list').innerHTML = teachers.map((teacher, index) => `<tr data-teacher-row="${index}"><td><input class="teacher-name" data-field="name" aria-label="Nom de l’enseignant" maxlength="120" value="${escapeHtml(teacher.name)}" placeholder="Nom complet" ${state.adminReading ? 'disabled' : ''}></td>${[['hoursDue', 'Heures dues'], ['lost', 'Heures manquées'], ['compensated', 'Heures compensées'], ['extra', 'Heures supplémentaires']].map(([field, label]) => `<td><input type="number" min="0" max="200" step="0.25" data-field="${field}" aria-label="${label}" value="${Number(teacher[field] || 0)}" ${state.adminReading ? 'disabled' : ''}></td>`).join('')}<td class="teacher-result">${Number(teacher.hoursRealized || 0).toLocaleString('fr-FR')} h</td><td><button class="remove-teacher ${state.adminReading ? 'hidden' : ''}" data-remove="${index}" aria-label="Supprimer l’enseignant">×</button></td></tr>`).join('');
  document.querySelectorAll('[data-remove]').forEach((button) => button.addEventListener('click', () => {
    collectTeachers();
    state.fiche.teachers.splice(Number(button.dataset.remove), 1);
    renderTeachers(state.fiche.teachers);
  }));
}
function collectTeachers() {
  if (!state.fiche) return [];
  const previous = state.fiche.teachers;
  const teachers = [...document.querySelectorAll('[data-teacher-row]')].map((row, index) => {
    const value = (field) => row.querySelector(`[data-field="${field}"]`).value;
    return { name: value('name'), hoursDue: Number(value('hoursDue')), lost: Number(value('lost')), compensated: Number(value('compensated')), extra: Number(value('extra')), hoursRealized: previous[index]?.hoursRealized || 0 };
  });
  state.fiche.teachers = teachers;
  return teachers;
}
async function saveFiche() {
  if (!state.fiche) return;
  const teachers = collectTeachers();
  if (teachers.some((teacher) => !teacher.name.trim())) return toast('Renseignez le nom de chaque enseignant.');
  try {
    const { fiche } = await api(`/api/fiches/${state.fiche.id}`, { method: 'PUT', body: JSON.stringify({ school: $('#fiche-school').value, notes: $('#fiche-notes').value, teachers }) });
    state.fiche = fiche;
    renderTeachers(fiche.teachers);
    $('#save-status').textContent = `Enregistré à ${new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' }).format(new Date())}`;
    toast('Fiche enregistrée.');
    loadFiches();
  } catch (error) { toast(error.message); }
}
async function loadAdmin() {
  const month = $('#admin-month').value;
  try {
    const [fichesResult, usersResult] = await Promise.all([
      api(`/api/admin/fiches?mois=${encodeURIComponent(month)}`),
      api('/api/admin/users')
    ]);
    $('#admin-user-count').textContent = String(usersResult.users.length).padStart(2, '0');
    $('#admin-fiche-count').textContent = String(fichesResult.fiches.length).padStart(2, '0');
    $('#admin-empty').classList.toggle('hidden', fichesResult.fiches.length > 0);
    $('#admin-fiche-list').innerHTML = fichesResult.fiches.map((fiche) => {
      const realized = fiche.teachers.reduce((total, teacher) => total + teacher.hoursRealized, 0);
      return `<tr><td class="month-cell">${escapeHtml(monthLabel(fiche.month))}</td><td>${escapeHtml(fiche.school || 'Établissement non renseigné')}</td><td>${escapeHtml(fiche.director)}</td><td>${fiche.teachers.length}</td><td>${realized.toLocaleString('fr-FR')} h</td><td><button class="table-action" data-admin-fiche="${fiche.id}">Consulter ↗</button></td></tr>`;
    }).join('');
    document.querySelectorAll('[data-admin-fiche]').forEach((button) => button.addEventListener('click', () => openFiche(button.dataset.adminFiche, true)));
  } catch (error) { toast(error.message); }
}
async function loadProfile() {
  try {
    const { user } = await api('/api/auth/me');
    $('#profile-name').value = user.name;
    $('#profile-ia').value = user.profile.ia || '';
    $('#profile-ief').value = user.profile.ief || '';
    $('#profile-codec').value = user.profile.codec || '';
    $('#profile-school').value = user.profile.school || '';
  } catch (error) { toast(error.message); }
}

$('#auth-switch').addEventListener('click', (event) => { if (event.target.id === 'toggle-auth') setAuthMode(!state.register); });
$('#auth-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  $('#auth-error').textContent = '';
  const body = { email: $('#auth-email').value, password: $('#auth-password').value };
  if (state.register) body.name = $('#auth-name').value;
  try {
    const { user } = await api(`/api/auth/${state.register ? 'register' : 'login'}`, { method: 'POST', body: JSON.stringify(body) });
    setUser(user);
  } catch (error) { $('#auth-error').textContent = error.message; }
});
document.querySelectorAll('.nav-item').forEach((button) => button.addEventListener('click', () => {
  showView(button.dataset.view);
  if (button.dataset.view === 'profile') loadProfile();
  if (button.dataset.view === 'admin') loadAdmin();
}));
$('#admin-month').addEventListener('change', loadAdmin);
$('#admin-refresh').addEventListener('click', loadAdmin);
$('#new-fiche').addEventListener('click', () => {
  const now = new Date();
  $('#new-month').value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  $('#new-error').textContent = '';
  $('#new-fiche-dialog').showModal();
});
$('#empty-new').addEventListener('click', () => $('#new-fiche').click());
$('#new-fiche-form').addEventListener('submit', async (event) => {
  if (event.submitter?.value === 'cancel') return;
  event.preventDefault();
  try {
    const { fiche } = await api('/api/fiches', { method: 'POST', body: JSON.stringify({ mois: $('#new-month').value, copier: $('#copy-previous').checked }) });
    $('#new-fiche-dialog').close();
    await openFiche(fiche.id);
    loadFiches();
  } catch (error) { $('#new-error').textContent = error.message; }
});
$('#add-teacher').addEventListener('click', () => {
  collectTeachers();
  state.fiche.teachers.push({ name: '', hoursDue: 0, lost: 0, compensated: 0, extra: 0, hoursRealized: 0 });
  renderTeachers(state.fiche.teachers);
  document.querySelector('[data-teacher-row]:last-child .teacher-name')?.focus();
});
$('#save-fiche').addEventListener('click', saveFiche);
$('#print-fiche').addEventListener('click', () => window.print());
$('#back-to-list').addEventListener('click', () => {
  if (state.adminReading) {
    state.adminReading = false;
    showView('admin');
    loadAdmin();
  } else {
    showView('dashboard');
    loadFiches();
  }
});
$('#logout').addEventListener('click', async () => {
  try { await api('/api/auth/logout', { method: 'POST', body: '{}' }); } finally { state.user = null; state.fiche = null; $('#app-shell').classList.add('hidden'); $('#auth-screen').classList.remove('hidden'); $('#auth-form').reset(); }
});
$('#profile-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const body = { name: $('#profile-name').value, profile: { ia: $('#profile-ia').value, ief: $('#profile-ief').value, codec: $('#profile-codec').value, school: $('#profile-school').value } };
  try {
    const { user } = await api('/api/auth/me', { method: 'PUT', body: JSON.stringify(body) });
    state.user = user;
    $('#user-name').textContent = user.name;
    $('#profile-status').textContent = 'Profil enregistré.';
  } catch (error) { $('#profile-status').textContent = error.message; }
});
$('#password-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    await api('/api/auth/me/password', { method: 'PUT', body: JSON.stringify({ currentPassword: $('#current-password').value, newPassword: $('#new-password').value }) });
    $('#password-status').textContent = 'Mot de passe mis à jour.';
    event.target.reset();
  } catch (error) { $('#password-status').textContent = error.message; }
});

api('/api/auth/me').then(({ user }) => setUser(user)).catch(() => {
  $('#auth-screen').classList.remove('hidden');
  $('#app-shell').classList.add('hidden');
});