require('dotenv').config();
const bcrypt = require('bcryptjs');
const { createDatabase } = require('../src/db');

const [email, password, ...nameParts] = process.argv.slice(2);
const name = nameParts.join(' ').trim();
if (!email || !password || !name || password.length < 10 || password.length > 72) {
  console.error('Usage: npm run create-admin -- email@example.sn "MotDePasseSolide" "Nom Prénom" (10 caractères minimum)');
  process.exit(1);
}
const db = createDatabase();
try {
  db.prepare("INSERT INTO users (email, password_hash, name, role) VALUES (?, ?, ?, 'admin')")
    .run(email.trim(), bcrypt.hashSync(password, 12), name);
  console.log(`Compte d’inspection créé pour ${email.trim()}.`);
} catch (error) {
  if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
    console.error('Cette adresse e-mail existe déjà.');
    process.exitCode = 1;
  } else throw error;
} finally {
  db.close();
}