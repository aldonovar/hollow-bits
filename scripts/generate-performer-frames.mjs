import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import ffmpegPath from 'ffmpeg-static';

const FRAME_COUNT = 96;
const FPS = 48;
const FRAME_SIZE = 384;

const projectRoot = process.cwd();
const performerDir = path.join(projectRoot, 'public', 'performer');
const inputImage = path.join(performerDir, 'performer.png');
const outputDir = path.join(performerDir, 'frames');
const outputPattern = path.join(outputDir, 'performer_%03d.png');
const manifestPath = path.join(outputDir, 'manifest.json');

const assertFileExists = async (filePath) => {
  try {
    await fs.access(filePath);
  } catch {
    throw new Error(`Missing required file: ${filePath}`);
  }
};

const buildFilterGraph = () => {
  const halfCycle = Math.max(2, Math.floor(FRAME_COUNT / 2));
  const thirdCycle = Math.max(2, Math.floor(FRAME_COUNT / 3));
  const quarterCycle = Math.max(2, Math.floor(FRAME_COUNT / 4));

  return [
    `[0:v]format=rgba,scale=${FRAME_SIZE}:${FRAME_SIZE}:flags=neighbor,zoompan=`,
    `z='1+0.018*sin(2*PI*on/${FRAME_COUNT})+0.007*sin(2*PI*on/${halfCycle}+0.45)':`,
    `x='iw/2-(iw/zoom/2)+4*sin(2*PI*on/${FRAME_COUNT}+0.35)+2*sin(2*PI*on/${thirdCycle})':`,
    `y='ih/2-(ih/zoom/2)+3*cos(2*PI*on/${FRAME_COUNT}-0.28)+1.5*sin(2*PI*on/${quarterCycle}+0.9)':`,
    `d=1:fps=${FPS}:s=${FRAME_SIZE}x${FRAME_SIZE}[main]`,
    ';',
    `[0:v]format=rgba,scale=${FRAME_SIZE}:${FRAME_SIZE}:flags=neighbor,zoompan=`,
    `z='1+0.01*sin(2*PI*on/${FRAME_COUNT}+1.2)':`,
    `x='iw/2-(iw/zoom/2)+2*sin(2*PI*on/${halfCycle}+0.9)':`,
    `y='ih/2-(ih/zoom/2)+1*cos(2*PI*on/${thirdCycle}-0.4)':`,
    `d=1:fps=${FPS}:s=${FRAME_SIZE}x${FRAME_SIZE},`,
    `colorchannelmixer=aa=0.13[ghost]`,
    ';',
    `[main][ghost]blend=all_mode='screen':all_opacity=0.5[mix]`,
    ';',
    `[mix]curves=all='0/0 0.22/0.2 0.5/0.56 0.82/0.9 1/1'[graded]`,
    ';',
    `[graded]drawgrid=w=iw:h=4:t=1:c=white@0.03[outv]`
  ].join('');
};

const runFfmpeg = () => {
  if (!ffmpegPath) {
    throw new Error('ffmpeg-static did not return a binary path');
  }

  const args = [
    '-y',
    '-loglevel',
    'error',
    '-loop',
    '1',
    '-i',
    inputImage,
    '-frames:v',
    String(FRAME_COUNT),
    '-filter_complex',
    buildFilterGraph(),
    '-map',
    '[outv]',
    '-pix_fmt',
    'rgba',
    '-compression_level',
    '6',
    '-start_number',
    '0',
    outputPattern
  ];

  const result = spawnSync(ffmpegPath, args, {
    cwd: projectRoot,
    stdio: 'pipe',
    encoding: 'utf8'
  });

  if (result.status !== 0) {
    const stderr = (result.stderr || '').trim();
    throw new Error(`ffmpeg failed with code ${result.status}: ${stderr}`);
  }
};

const writeManifest = async () => {
  const entries = await fs.readdir(outputDir);
  const frameFiles = entries
    .filter((entry) => /^performer_\d{3}\.png$/u.test(entry))
    .sort();

  if (frameFiles.length !== FRAME_COUNT) {
    throw new Error(`Expected ${FRAME_COUNT} frames, got ${frameFiles.length}`);
  }

  const manifest = {
    version: 1,
    fps: FPS,
    frameCount: frameFiles.length,
    frameWidth: FRAME_SIZE,
    frameHeight: FRAME_SIZE,
    frames: frameFiles.map((fileName) => `/performer/frames/${fileName}`)
  };

  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
};

const cleanOutput = async () => {
  await fs.rm(outputDir, { recursive: true, force: true });
  await fs.mkdir(outputDir, { recursive: true });
};

const main = async () => {
  await assertFileExists(inputImage);
  await cleanOutput();
  runFfmpeg();
  await writeManifest();
  console.log(`Generated ${FRAME_COUNT} performer frames in ${outputDir}`);
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
