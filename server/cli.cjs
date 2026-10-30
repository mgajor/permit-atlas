const path = require('node:path');
const { startServer } = require('./index.cjs');
const rootDir = path.resolve(__dirname, '..');
startServer({
  host: '127.0.0.1',
  port: Number(process.env.PORT || 4318),
  rootDir,
  dataDir: process.env.PERMIT_ATLAS_DATA_DIR || path.join(rootDir, '.permit-atlas'),
  staticDir: path.join(rootDir, 'dist'),
}).then(({ port, close }) => {
  console.log(`Permit Atlas ready at http://127.0.0.1:${port}`);
  process.on('SIGINT', () => { close(); process.exit(0); });
  process.on('SIGTERM', () => { close(); process.exit(0); });
}).catch(error => { console.error(error); process.exit(1); });
