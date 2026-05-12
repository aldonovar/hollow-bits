import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();

const localCoreCandidates = [
  path.join(root, 'src', 'hollowbits-core', 'index.ts'),
  path.join(root, 'hollowbits-core', 'index.ts'),
];

const peerCoreCandidates = [
  process.env.HOLLOWBITS_PEER_CORE,
  path.resolve(root, '..', '..', 'DevStreams', 'ESP', 'hollowbits-core', 'index.ts'),
  path.resolve(root, '..', '..', 'Proyectos Web', 'hollow-web', 'src', 'hollowbits-core', 'index.ts'),
].filter(Boolean);

const requiredSnippets = [
  "CORE_CONTRACT_VERSION = '2026.05-local-first'",
  "PROJECT_SCHEMA_VERSION = '3.0-reference'",
  "'project-audio'",
  "'project-stems'",
  "'project-exports'",
  "'asset-library'",
  "'user-avatars'",
  'renderMinutesPerMonth',
  'snapshotRetentionDays',
  'apiWebhookCallsPerMonth',
  'getUsageLimitForMetric',
  'getFeatureUpgradeTarget',
  'formatUsageMetric',
  'TRACK_CONTRACT_FIELDS',
  'sidechainSourceTrackId',
  'isFrozen',
  'frozenBufferSourceId',
];

const findExisting = (candidates) => candidates.find((candidate) => candidate && fs.existsSync(candidate));
const normalize = (source) => source.replace(/\r\n/g, '\n').trim();

const localCorePath = findExisting(localCoreCandidates);
if (!localCorePath) {
  throw new Error('Missing local @hollowbits/core contract.');
}

const localSource = fs.readFileSync(localCorePath, 'utf8');
const missing = requiredSnippets.filter((snippet) => !localSource.includes(snippet));
if (missing.length > 0) {
  throw new Error(`Local contract is missing required snippets: ${missing.join(', ')}`);
}

const peerCorePath = findExisting(
  peerCoreCandidates.filter((candidate) => path.resolve(candidate) !== path.resolve(localCorePath))
);

if (peerCorePath) {
  const peerSource = fs.readFileSync(peerCorePath, 'utf8');
  if (normalize(peerSource) !== normalize(localSource)) {
    throw new Error(`Ecosystem contract diverged from peer repo: ${peerCorePath}`);
  }
}

console.log(`Ecosystem contract OK: ${path.relative(root, localCorePath) || localCorePath}`);
if (peerCorePath) {
  console.log(`Peer parity OK: ${peerCorePath}`);
}
