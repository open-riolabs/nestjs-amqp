// Copies the canonical Claude skills (.claude/skills) into the schematic asset
// folder (schematics/nest-add/skills) so `nest add` can write them into the
// consuming project. Run as part of build:schematics.
const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '..', '.claude', 'skills');
const dest = path.join(__dirname, '..', 'schematics', 'nest-add', 'skills');

if (!fs.existsSync(src)) {
  console.error(`[sync-skills] source not found: ${src}`);
  process.exit(1);
}

fs.rmSync(dest, { recursive: true, force: true });
fs.cpSync(src, dest, { recursive: true });
console.log(`[sync-skills] copied skills → ${dest}`);
