import {
  TIMELINE_PIXELS_PER_SECOND,
  type TimelineBlockLayout,
} from './timelineLayout';

const IMAGE_DURATION_MIN_MS = 500;
const IMAGE_DURATION_SNAP_MS = 100;

export function getSceneInsertionIndex(
  pointerCanvasX: number,
  blocks: TimelineBlockLayout[],
): number {
  const insertionIndex = blocks.findIndex(
    (block) => pointerCanvasX < block.leftPx + block.widthPx / 2,
  );
  return insertionIndex === -1 ? blocks.length : insertionIndex;
}

export function getSceneMoveTargetIndex(
  fromIndex: number,
  insertionIndex: number,
  sceneCount: number,
): number {
  const adjustedIndex =
    insertionIndex > fromIndex ? insertionIndex - 1 : insertionIndex;
  return Math.min(Math.max(adjustedIndex, 0), Math.max(sceneCount - 1, 0));
}

export function getSelectedSceneIndexAfterMove(
  selectedSceneIndex: number | null,
  fromIndex: number,
  toIndex: number,
): number | null {
  if (selectedSceneIndex === null || fromIndex === toIndex) {
    return selectedSceneIndex;
  }
  if (selectedSceneIndex === fromIndex) {
    return toIndex;
  }
  if (
    fromIndex < toIndex &&
    selectedSceneIndex > fromIndex &&
    selectedSceneIndex <= toIndex
  ) {
    return selectedSceneIndex - 1;
  }
  if (
    fromIndex > toIndex &&
    selectedSceneIndex >= toIndex &&
    selectedSceneIndex < fromIndex
  ) {
    return selectedSceneIndex + 1;
  }
  return selectedSceneIndex;
}

export function getSnappedImageDurationMs(
  originalDurationMs: number,
  deltaX: number,
  pixelsPerSecond = TIMELINE_PIXELS_PER_SECOND,
): number {
  const requestedDurationMs =
    originalDurationMs + (deltaX / pixelsPerSecond) * 1000;
  const snappedDurationMs =
    Math.round(requestedDurationMs / IMAGE_DURATION_SNAP_MS) *
    IMAGE_DURATION_SNAP_MS;
  return Math.max(IMAGE_DURATION_MIN_MS, snappedDurationMs);
}

export function buildDraftTimelineBlocks(
  blocks: TimelineBlockLayout[],
  resizedSceneIndex: number,
  draftDurationMs: number,
  pixelsPerSecond = TIMELINE_PIXELS_PER_SECOND,
): TimelineBlockLayout[] {
  const resizedBlockPosition = blocks.findIndex(
    (block) => block.sceneIndex === resizedSceneIndex,
  );
  if (resizedBlockPosition === -1) {
    return blocks;
  }

  const resizedBlock = blocks[resizedBlockPosition];
  const draftWidthPx = (draftDurationMs / 1000) * pixelsPerSecond;
  const widthDeltaPx = draftWidthPx - resizedBlock.widthPx;

  return blocks.map((block, blockPosition) => {
    if (blockPosition < resizedBlockPosition) {
      return block;
    }
    if (blockPosition === resizedBlockPosition) {
      return { ...block, widthPx: draftWidthPx };
    }
    return { ...block, leftPx: block.leftPx + widthDeltaPx };
  });
}
