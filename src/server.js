require('dotenv').config();
const { createDatabase } = require('./db');
const { createApp } = require('./app');

const db = createDatabase();
const app = createApp(db);
const port = Number(process.env.PORT) || 3000;
const server = app.listen(port, () => console.log(`Quantum Horaire disponible sur le port ${port}`));

function shutdown() {
  server.close(() => {
    db.close();
    process.exit(0);
  });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);