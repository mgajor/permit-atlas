const fs = require('node:fs');
const path = require('node:path');
const lock = require('../package-lock.json');
const seen = new Set();
let out = 'THIRD-PARTY DEPENDENCY NOTICES\n\nGenerated from the installed lockfile. Dependencies retain their own licenses.\n\n';
for (const [location, info] of Object.entries(lock.packages || {})) {
  if (!location || info.dev) continue;
  const name = info.name || location.split('node_modules/').at(-1);
  const key = `${name}@${info.version}`;
  if (seen.has(key)) continue;
  seen.add(key);
  out += `\n${'='.repeat(72)}\n${key}\nDeclared license: ${info.license || 'See upstream package'}\n`;
  const folder = path.resolve(__dirname, '..', location);
  if (!fs.existsSync(folder)) throw new Error(`Install dependencies first: ${location}`);
  const files = fs.readdirSync(folder).filter(f => /^(license|licence|copying|notice)(\.|$|-)/i.test(f));
  if (!files.length) out += 'No root license file found; consult the upstream package.\n';
  for (const file of files) {
    const p = path.join(folder, file);
    if (fs.statSync(p).isFile()) out += `\n--- ${file} ---\n${fs.readFileSync(p, 'utf8')}\n`;
  }
}
fs.writeFileSync(path.resolve(__dirname, '../THIRD_PARTY_NOTICES.txt'), out);
console.log(`Wrote notices for ${seen.size} production dependencies`);
