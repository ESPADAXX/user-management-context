#!/usr/bin/env node
// Regenerates context/manifest.json: the context version + the current version of every item.
// The context version goes up by one whenever any file in context/ changed.
//   npm run context:manifest           write it
//   npm run context:manifest -- --check   fail if it is out of date (CI)
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, diskSource, computeManifest, readManifest, arg } from './lib.mjs';

const src = diskSource();
const current = readManifest(src);
const next = computeManifest(src, current);
const text = JSON.stringify(next, null, 2) + '\n';

if (arg('check')) {
  const fresh = current && JSON.stringify(current) === JSON.stringify(next);
  if (!fresh) {
    console.error('✘ context/manifest.json is out of date: files in context/ changed without regenerating it.');
    console.error('  Run: npm run context:manifest   and commit the result.');
    process.exit(1);
  }
  console.log(`✔ manifest.json is up to date (context v${current.contextVersion})`);
} else {
  writeFileSync(join(ROOT, 'context/manifest.json'), text);
  const bumped = !current || current.contextVersion !== next.contextVersion;
  console.log(bumped ? `Context version → v${next.contextVersion}` : `No change: context v${next.contextVersion}`);
}
