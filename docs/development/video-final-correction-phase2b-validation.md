# Video final correction Phase 2-B validation

Validated on 2026-10-26 Asia/Seoul in the `feat/video-stabilization-phase2a` worktree at base HEAD `c299a8f2a35b9ea0e1b6840ee2898dfb5648b3b6`. No commit or push was made.

## Automated verification

- Full suite: 57 files passed, 2 smoke files skipped; 821 tests passed, 26 skipped, 0 failed.
- Baseline was 786 passed and 24 skipped. Phase 2-B adds 35 ordinary passing tests and two opt-in real-FFmpeg smoke tests.
- TypeScript typecheck: passed.
- ESLint: passed with no warnings.
- Project save/load/export focused regression: 19 files and 356 tests passed.
- The two opt-in smoke tests were executed explicitly during acceptance: whole-file correction passed for both presets and live cancellation passed.
- Post-review safety tests cover atomic destination no-replace publication, early rejection of filesystems without hard-link support, probe-name collision ownership, successful-result preservation after pending-name cleanup failure, cancel/completion races, checking-stage progress, audio signature mismatch, selecting-stage job exclusion, and destination reselection after changing a completed preset.

## Real MP4 acceptance

Source: `D:\combark-shorts-studio-planning\사랑의꿈\사랑의꿈.mp4`

- Source bytes: 123,279,010.
- Source SHA-256 before and after every run: `D5DB3E2A941CEEA407C6424277C5CDB0798C864EE00950FF3F7CA3E255873DDA`.
- Source media: 297.233333 seconds, 1080x1920, SAR 1:1, DAR 9:16, 30 fps, H.264 video, one 48 kHz stereo AAC audio stream.

Basic output:

- Path: `C:\Users\user\AppData\Local\Temp\combark-phase2b-basic-c299a8f.mp4`.
- Bytes: 126,224,788.
- SHA-256: `5F309EDF559B2A5AE67257C42AC04C994C30EE8D256CEEC0087233BA888DE768`.
- Whole-file test duration: 924.90 seconds.
- Full decode verification passed with source duration, dimensions, SAR/DAR, 30 fps, exact frame count, and one preserved audio stream.

Strong output:

- Path: `C:\Users\user\AppData\Local\Temp\combark-phase2b-strong-c299a8f.mp4`.
- Bytes: 125,732,395.
- SHA-256: `F3CA0101B807B0C2AAEF38BBB1ACD01B925F96BFDB97BDDF1CC2545C73D739F9`.
- Whole-file test duration: 975.64 seconds.
- Full decode verification passed with source duration, dimensions, SAR/DAR, 30 fps, exact frame count, and one preserved audio stream.
- Side-by-side frames at 30, 120, and 240 seconds showed no black border or obvious shape distortion. The packaged Chromium decoder also loaded and played the source, basic, and strong files at the 30-second position with `readyState=4`.

Strong was enabled after these checks. The acceptance did not include watching every frame continuously or establishing a quantitative stabilization-quality metric; the UI therefore keeps the crop warning visible and does not claim universal quality improvement.

After code review, fresh 12-second CFR real-MP4 runs passed the revised atomic publication and audio-signature verification path; the final run completed in 42.41 seconds. Before decoding, the app probes hard-link support in the selected output directory and cleans both UUID probe names. Unsupported filesystems are rejected early; actual publication only creates a hard link from the fully verified sibling pending file, so an existing destination is never replaced and a partial copy is never exposed. An earlier stream-copy-cut fixture was safely rejected before publication because its edit-list/container duration differed from frame duration; this was retained as negative validation rather than weakening the duration check. A subsequent smoke assertion exposed duplicate input/output FFmpeg audio-log counting; parsing was restricted to the input inventory and the final real run passed.

## Cancellation and cleanup

- A live FFmpeg detect process was aborted after progress reached 30 frames.
- The operation rejected with `AbortError`.
- Output absent, sibling pending files: 0, correction temp directories: 0, FFmpeg processes: 0.
- Source SHA-256 remained unchanged.

## Windows package and runtime

- `electron-forge package --arch=x64`: passed.
- Packaged application: `out\Combark Shorts Studio-win32-x64\Combark Shorts Studio.exe` (246,325,248 bytes).
- Packaged FFmpeg: `out\Combark Shorts Studio-win32-x64\resources\ffmpeg.exe` (82,797,568 bytes).
- Packaged app loaded from `app.asar`, exposed every final-correction preload API, opened the final-correction dialog, loaded and played all three real MP4 files, and reported no runtime exception or log issue during the smoke check.
- The packaged app was closed after validation; the main process count returned to zero.
- The package and packaged-runtime playback smoke were repeated after the code-review fixes with the same successful result and zero captured runtime issues.

## Phase 2-A preservation

The pre-Phase-2-B SHA ledger is `docs/development/phase-2a-baseline-before-phase-2b.md`. Of its 38 files, 29 remain byte-identical. Nine shared integration files were intentionally extended for Phase 2-B: main registration, preload, shared IPC, styles, the media-job coordinator, preset reuse in the Phase 2-A stabilization IPC, A/B playback generalization, and the two corresponding preload tests. No Phase 2-A file was deleted, reset, stashed, cleaned, or checked out.

G feature-point stabilization and H optical-flow shape consistency remain excluded and are not present in the UI.
