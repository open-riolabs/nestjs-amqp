// Copies the canonical Claude skills (.claude/skills) into the nest-add schematic
// asset folder (files/skills) so `nest add` can write them into the consuming
// project's .claude/skills. Run whenever the skills change: `npm run sync:skills`.
const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '..', '.claude', 'skills');
const dest = path.join(__dirname, '..', 'libs', 'rlb-nestjs-amqp', 'src', 'schematics', 'nest-add', 'files', 'skills');

if (!fs.existsSync(src)) {
  console.error(`[sync-skills] source not found: ${src}`);
  process.exit(1);
}

fs.rmSync(dest, { recursive: true, force: true });
fs.mkdirSync(dest, { recursive: true });
fs.cpSync(src, dest, { recursive: true });
console.log(`[sync-skills] copied skills → ${dest}`);
