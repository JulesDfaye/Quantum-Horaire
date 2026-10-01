const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const { createDatabase } = require('../src/db');
const { createApp } = require('../src/app');

let db;
let server;
let baseUrl;
let cookie;
const writeHeaders = { 'Content-Type': 'application/json', 'X-Requested-With': 'qh' };

before(async () => {
  process.env.JWT_SECRET = 'test-secret-that-is-long-enough-for-tests';
  db = createDatabase(':memory:');
  server = createServer(createApp(db));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  db.close();
});

test('health endpoint responds without a database leak', async () => {
  const response = await fetch(`${baseUrl}/api/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'ok' });
});

test('registers a director and rejects duplicate email', async () => {
  const register = () => fetch(`${baseUrl}/api/auth/register`, { method: 'POST', headers: writeHeaders, body: JSON.stringify({ email: 'directeur@example.sn', password: 'motdepasse-solide', name: 'Awa Fall' }) });
  const response = await register();
  assert.equal(response.status, 201);
  cookie = response.headers.get('set-cookie').split(';')[0];
  assert.equal((await response.json()).user.role, 'director');
  assert.equal((await register()).status, 409);
});

test('requires the write protection header for profile changes', async () => {
  const response = await fetch(`${baseUrl}/api/auth/me`, { method: 'PUT', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(response.status, 403);
});

test('creates, calculates, updates and isolates monthly fiches', async () => {
  const created = await fetch(`${baseUrl}/api/fiches`, { method: 'POST', headers: { ...writeHeaders, Cookie: cookie }, body: JSON.stringify({ mois: '2026-09' }) });
  assert.equal(created.status, 201);
  const id = (await created.json()).fiche.id;
  const update = await fetch(`${baseUrl}/api/fiches/${id}`, { method: 'PUT', headers: { ...writeHeaders, Cookie: cookie }, body: JSON.stringify({ school: 'École test', notes: '', teachers: [{ name: 'Moussa', hoursDue: 24, lost: 2, compensated: 1, extra: 3 }] }) });
  assert.equal(update.status, 200);
  assert.equal((await update.json()).fiche.teachers[0].hoursRealized, 26);
  assert.equal((await fetch(`${baseUrl}/api/fiches`, { headers: { Cookie: cookie } })).status, 200);
  const duplicate = await fetch(`${baseUrl}/api/fiches`, { method: 'POST', headers: { ...writeHeaders, Cookie: cookie }, body: JSON.stringify({ mois: '2026-09' }) });
  assert.equal(duplicate.status, 409);
});

test('inspection can list users and read fiches across schools', async () => {
  db.prepare("UPDATE users SET role = 'admin' WHERE email = ?").run('directeur@example.sn');
  const usersResponse = await fetch(`${baseUrl}/api/admin/users`, { headers: { Cookie: cookie } });
  assert.equal(usersResponse.status, 200);
  assert.equal((await usersResponse.json()).users.length, 1);
  const fichesResponse = await fetch(`${baseUrl}/api/admin/fiches?mois=2026-09`, { headers: { Cookie: cookie } });
  assert.equal(fichesResponse.status, 200);
  const { fiches } = await fichesResponse.json();
  assert.equal(fiches.length, 1);
  assert.equal(fiches[0].teachers[0].hoursRealized, 26);
});

test('validates months and prevents unauthenticated access', async () => {
  const invalid = await fetch(`${baseUrl}/api/fiches`, { method: 'POST', headers: { ...writeHeaders, Cookie: cookie }, body: JSON.stringify({ mois: '2026-13' }) });
  assert.equal(invalid.status, 400);
  assert.equal((await fetch(`${baseUrl}/api/fiches`)).status, 401);
});