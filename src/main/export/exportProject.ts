import { spawn } from 'node:child_process';
import { access, copyFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, win32 } from 'node:path';

import type { ExportProgress } from '../../shared/export';
import type {
  MediaAsset,
  SubtitlePosition,
  SubtitleSize,
} from '../../shared/project/types';
import { getSubtitleStyle } from '../../shared/project/subtitleStyle';
import { validateProjectDocument } from '../../shared/project/validateProject';

const VIDEO_FILTER =
  'scale=1080:1920:force_original_aspect_ratio=decrease,' +
  'pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black,setsar=1,fps=30';

export interface ExportProjectDependencies {
  ffmpegPath: string;
  fontPath: string;
  makeTempDirectory?: () => Promise<string>;
  pathExists?: (path: string) => Promise<boolean>;
  writeTextFile?: (path: string, content: string) => Promise<void>;
  runFfmpeg?: (ffmpegPath: string, args: string[]) => Promise<void>;
  copyFile?: (source: string, destination: string) => Promise<void>;
  removeDirectory?: (path: string) => Promise<void>;
  onProgress?: (progress: ExportProgress) => void;
}

interface SceneArgsInput {
  kind: MediaAsset['kind'];
  sourcePath: string;
  durationMs: number | null;
  filter: string;
  outputPath: string;
}

export function resolveFfmpegPath(
  isPackaged: boolean,
  resourcesPath: string,
  developmentPath: string,
): string {
  return isPackaged ? join(resourcesPath, 'ffmpeg.exe') : developmentPath;
}

export function getRuntimeFfmpegPath(
  isPackaged: boolean,
  resourcesPath: string,
): string {
  if (isPackaged) {
    return resolveFfmpegPath(true, resourcesPath, '');
  }

  return resolveFfmpegPath(false, resourcesPath, loadDevelopmentFfmpegPath());
}

export function loadDevelopmentFfmpegPath(): string {
  const loadedPath: unknown = createRequire(__filename)('ffmpeg-static');
  if (typeof loadedPath !== 'string' || loadedPath.length === 0) {
    throw new Error('FFmpeg 실행 파일을 찾지 못했습니다.');
  }

  return loadedPath;
}

export function getMalgunGothicPath(): string {
  return join(process.env.WINDIR ?? 'C:\\Windows', 'Fonts', 'malgun.ttf');
}

export function escapeAssText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/\{/g, '\\{')
    .replace(/\}/g, '\\}')
    .replace(/\r\n|\r|\n/g, '\\N');
}

export function buildAssDocument(
  text: string,
  position: SubtitlePosition,
  size: SubtitleSize,
): string {
  const style = getSubtitleStyle(position, size);
  return [
    '[Script Info]',
    'ScriptType: v4.00+',
    'PlayResX: 1080',
    'PlayResY: 1920',
    'WrapStyle: 0',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Default,Malgun Gothic,${style.fontSize},&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,4,0,${style.alignment},${style.horizontalMargin},${style.horizontalMargin},${style.verticalMargin},1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    `Dialogue: 0,0:00:00.00,9:59:59.99,Default,,0,0,0,,${escapeAssText(text)}`,
    '',
  ].join('\n');
}

function escapeFilterPath(path: string): string {
  return path
    .replace(/\\/g, '/')
    .replace(/'/g, "\\'")
    .replace(/:/g, '\\:')
    .replace(/([,;[\]])/g, '\\$1');
}

function buildVideoFilter(subtitlePath: string | null, fontsDirectory: string): string {
  if (!subtitlePath) {
    return VIDEO_FILTER;
  }

  return `${VIDEO_FILTER},ass=filename='${escapeFilterPath(subtitlePath)}':fontsdir='${escapeFilterPath(fontsDirectory)}'`;
}

export function buildSceneArgs(input: SceneArgsInput): string[] {
  const inputArgs = input.kind === 'image'
    ? ['-loop', '1', '-i', input.sourcePath, '-t', String((input.durationMs as number) / 1000)]
    : ['-i', input.sourcePath];

  return [
    '-y',
    ...inputArgs,
    '-map', '0:v:0',
    '-vf', input.filter,
    '-an',
    '-c:v', 'libx264',
    '-preset', 'medium',
    '-crf', '18',
    '-pix_fmt', 'yuv420p',
    '-r', '30',
    '-movflags', '+faststart',
    input.outputPath,
  ];
}

export function buildFinalMuxArgs(
  videoPath: string,
  narrationPath: string | null,
  outputPath: string,
): string[] {
  const audioInput = narrationPath
    ? ['-i', narrationPath]
    : ['-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000'];
  const audioFilter = narrationPath ? ['-af', 'apad'] : [];

  return [
    '-y',
    '-i', videoPath,
    ...audioInput,
    '-map', '0:v:0',
    '-map', '1:a:0',
    '-c:v', 'copy',
    '-c:a', 'aac',
    '-ar', '48000',
    '-ac', '2',
    ...audioFilter,
    '-shortest',
    '-movflags', '+faststart',
    outputPath,
  ];
}

async function defaultPathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export function runFfmpeg(ffmpegPath: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, args, {
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';

    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      stderr = `${stderr}${chunk}`.slice(-16_384);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`FFmpeg 실행에 실패했습니다 (${code ?? 'unknown'}). ${stderr.trim()}`));
      }
    });
  });
}

function normalizedWindowsPath(path: string): string {
  return win32.normalize(path).toLocaleLowerCase('en-US');
}

export async function exportProject(
  projectValue: unknown,
  outputPath: string,
  dependencies: ExportProjectDependencies,
): Promise<void> {
  const project = validateProjectDocument(projectValue);
  if (project.scenes.length === 0) {
    throw new Error('내보낼 장면이 없습니다.');
  }
  const reportProgress = dependencies.onProgress ?? (() => undefined);
  reportProgress({ stage: 'preparing' });

  const sourcePaths = [
    ...project.media.map(({ sourcePath }) => sourcePath),
    ...(project.narration ? [project.narration.sourcePath] : []),
  ];
  const normalizedOutputPath = normalizedWindowsPath(outputPath);
  if (sourcePaths.some((sourcePath) => normalizedWindowsPath(sourcePath) === normalizedOutputPath)) {
    throw new Error('출력 경로는 원본 파일과 같을 수 없습니다.');
  }

  const pathExists = dependencies.pathExists ?? defaultPathExists;
  if (!(await pathExists(dependencies.ffmpegPath))) {
    throw new Error('FFmpeg 실행 파일을 찾지 못했습니다.');
  }
  for (const asset of project.media) {
    if (!(await pathExists(asset.sourcePath))) {
      throw new Error(`원본 파일을 찾지 못했습니다: ${asset.fileName}`);
    }
  }
  if (project.narration && !(await pathExists(project.narration.sourcePath))) {
    throw new Error(`원본 파일을 찾지 못했습니다: ${project.narration.fileName}`);
  }
  if (project.scenes.some(({ subtitle }) => subtitle.length > 0) && !(await pathExists(dependencies.fontPath))) {
    throw new Error('맑은 고딕 글꼴을 찾지 못해 자막을 내보낼 수 없습니다.');
  }

  const makeTempDirectory = dependencies.makeTempDirectory ?? (() => mkdtemp(join(tmpdir(), 'combark-export-')));
  const writeTextFile = dependencies.writeTextFile ?? ((path, content) => writeFile(path, content, 'utf8'));
  const execute = dependencies.runFfmpeg ?? runFfmpeg;
  const copyOutput = dependencies.copyFile ?? copyFile;
  const removeDirectory = dependencies.removeDirectory ?? ((path) => rm(path, { recursive: true, force: true }));
  const tempDirectory = await makeTempDirectory();

  try {
    const mediaById = new Map(project.media.map((asset) => [asset.id, asset]));
    const sceneFiles: string[] = [];
    const fontsDirectory = win32.dirname(dependencies.fontPath);

    for (const [index, scene] of project.scenes.entries()) {
      reportProgress({
        stage: 'scene',
        sceneIndex: index + 1,
        sceneCount: project.scenes.length,
      });
      const asset = mediaById.get(scene.mediaId) as MediaAsset;
      const sequence = index.toString().padStart(6, '0');
      const scenePath = join(tempDirectory, `scene-${sequence}.mp4`);
      let subtitlePath: string | null = null;
      if (scene.subtitle.length > 0) {
        subtitlePath = join(tempDirectory, `subtitle-${sequence}.ass`);
        await writeTextFile(
          subtitlePath,
          buildAssDocument(
            scene.subtitle,
            scene.subtitlePosition,
            scene.subtitleSize,
          ),
        );
      }

      await execute(dependencies.ffmpegPath, buildSceneArgs({
        kind: asset.kind,
        sourcePath: asset.sourcePath,
        durationMs: scene.durationMs,
        filter: buildVideoFilter(subtitlePath, fontsDirectory),
        outputPath: scenePath,
      }));
      sceneFiles.push(scenePath);
    }

    const concatListPath = join(tempDirectory, 'scenes.txt');
    await writeTextFile(
      concatListPath,
      `${sceneFiles.map((scenePath) => `file '${win32.basename(scenePath)}'`).join('\n')}\n`,
    );
    const combinedVideoPath = join(tempDirectory, 'combined.mp4');
    reportProgress({ stage: 'concatenating' });
    await execute(dependencies.ffmpegPath, [
      '-y', '-f', 'concat', '-safe', '0', '-i', concatListPath,
      '-map', '0:v:0', '-c:v', 'copy', combinedVideoPath,
    ]);

    const finalPath = join(tempDirectory, 'final.mp4');
    reportProgress({ stage: 'muxing-audio' });
    await execute(
      dependencies.ffmpegPath,
      buildFinalMuxArgs(combinedVideoPath, project.narration?.sourcePath ?? null, finalPath),
    );
    reportProgress({ stage: 'writing-output' });
    await copyOutput(finalPath, outputPath);
  } finally {
    await removeDirectory(tempDirectory);
  }
  reportProgress({ stage: 'complete' });
}
