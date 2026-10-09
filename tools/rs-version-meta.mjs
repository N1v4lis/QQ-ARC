import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const root = new URL('../', import.meta.url);
const source = JSON.parse(readFileSync(new URL('docs/rs-version-series.json', root), 'utf8'));

export function rsVersionMetadata(value) {
  const match = /^(?:RS|v)?(\d+)\.(\d+)\.(\d+)(-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.exec(value);
  if (!match) throw new Error('Expected an RS version or numeric SemVer, e.g. RS0.1.1');
  const version = `${match[1]}.${match[2]}.${match[3]}${match[4] ?? ''}`;
  const series = source.series.find(item => item.version.split('.').slice(0, 2).join('.') === `${match[1]}.${match[2]}`);
  if (!series) throw new Error('This version series has no user-approved codename');
  const publicVersion = `${source.prefix}${version}`;
  return {
    version, publicVersion, codename: series.codename, phrase: series.phrase,
    releaseTitle: `${publicVersion} — ${series.codename} — ${series.phrase}`,
    milestoneNumber: series.milestone.number, milestoneUrl: series.milestone.url,
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const pubspec = readFileSync(new URL('flutter/pubspec.yaml', root), 'utf8');
  const value = process.argv[2] ?? /^version:\s*(\S+)/m.exec(pubspec)?.[1];
  try { console.log(JSON.stringify(rsVersionMetadata(value ?? ''), null, 2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
