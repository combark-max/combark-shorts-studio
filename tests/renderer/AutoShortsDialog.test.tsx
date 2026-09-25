import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AutoShortsDialog } from '../../src/renderer/components/AutoShortsDialog';
import { createNewProject } from '../../src/shared/project/createProject';
import type { ProjectDocument } from '../../src/shared/project/types';

afterEach(cleanup);

function createDialogProject(): ProjectDocument {
  const project = createNewProject('자동 만들기');
  project.media = [
    {
      id: 'image-id',
      kind: 'image',
      sourcePath: 'C:\\media\\photo.jpg',
      fileName: 'photo.jpg',
    },
    {
      id: 'video-id',
      kind: 'video',
      sourcePath: 'C:\\media\\clip.mp4',
      fileName: 'clip.mp4',
    },
  ];
  project.scenes = [
    {
      mediaId: 'image-id',
      durationMs: 4500,
      subtitle: '기존 자막',
      subtitlePosition: 'top',
      subtitleSize: 'large',
    },
    {
      mediaId: 'video-id',
      durationMs: null,
      subtitle: '',
      subtitlePosition: 'bottom',
      subtitleSize: 'small',
    },
  ];
  project.narration = {
    sourcePath: 'C:\\audio\\voice.wav',
    fileName: 'voice.wav',
  };
  return project;
}

describe('AutoShortsDialog', () => {
  it('shows script input, counts, result summary, and overwrite warnings', async () => {
    const user = userEvent.setup();
    render(
      <AutoShortsDialog
        project={createDialogProject()}
        missingMediaIds={[]}
        narrationMissing={false}
        onCancel={vi.fn()}
        onApply={vi.fn(() => true)}
      />,
    );

    expect(screen.getByRole('dialog', { name: '쇼츠 자동 만들기' })).toBeInTheDocument();
    expect(screen.getByText('현재 장면 수: 2')).toBeInTheDocument();
    expect(screen.getByText('인식된 자막 단위 수: 0')).toBeInTheDocument();
    expect(screen.getByText('예상 적용 결과: 메타데이터 확인 중...')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '자동 구성 적용' })).toBeDisabled();
    expect(screen.getByText('기존 수동 편집이 덮어써질 수 있습니다.')).toBeInTheDocument();
    expect(screen.getByText('자막 1개 변경 예정')).toBeInTheDocument();
    expect(screen.getByText('이미지 표시시간 1개 변경 예정')).toBeInTheDocument();

    await user.type(
      screen.getByRole('textbox', { name: '대본 또는 자막' }),
      '첫째. 둘째!',
    );
    expect(screen.getByText('인식된 자막 단위 수: 2')).toBeInTheDocument();
    expect(screen.getByText('자막 2개 변경 예정')).toBeInTheDocument();
  });

  it('loads narration and unique video metadata and previews narration-based timing', () => {
    const project = createDialogProject();
    project.scenes.splice(2, 0, { ...project.scenes[1] });
    const { container } = render(
      <AutoShortsDialog
        project={project}
        missingMediaIds={[]}
        narrationMissing={false}
        onCancel={vi.fn()}
        onApply={vi.fn(() => true)}
      />,
    );
    const audio = container.querySelector('audio');
    const videos = container.querySelectorAll('video');

    expect(audio).not.toBeNull();
    expect(videos).toHaveLength(1);
    Object.defineProperty(audio, 'duration', { configurable: true, value: 14.001 });
    Object.defineProperty(videos[0], 'duration', { configurable: true, value: 5 });
    fireEvent.loadedMetadata(audio as HTMLAudioElement);
    fireEvent.loadedMetadata(videos[0]);

    expect(screen.getByText('내레이션 길이: 14.001초')).toBeInTheDocument();
    expect(screen.getByText('영상 길이: 모두 확인됨')).toBeInTheDocument();
    expect(screen.getByText('예상 적용 결과: 내레이션 길이에 맞춤')).toBeInTheDocument();
    expect(screen.getByText('이미지 표시시간 1개 변경 예정')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '자동 구성 적용' })).toBeEnabled();
  });

  it('shows a non-blocking fallback when media metadata loading fails', () => {
    const project = createDialogProject();
    const { container } = render(
      <AutoShortsDialog
        project={project}
        missingMediaIds={[]}
        narrationMissing={false}
        onCancel={vi.fn()}
        onApply={vi.fn(() => true)}
      />,
    );
    const audio = container.querySelector('audio');
    const video = container.querySelector('video');

    expect(audio).not.toBeNull();
    expect(video).not.toBeNull();
    fireEvent.error(audio as HTMLAudioElement);
    fireEvent.error(video as HTMLVideoElement);
    expect(screen.getByText('내레이션 길이: 확인 실패')).toBeInTheDocument();
    expect(screen.getByText('영상 길이: 확인 실패')).toBeInTheDocument();
    expect(
      screen.getByText(
        '예상 적용 결과: 내레이션 길이와 정확히 맞출 수 없어 이미지 장면 3초 적용',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '자동 구성 적용' })).toBeEnabled();
  });

  it('switches to fallback when an asynchronous missing-source result arrives after opening', () => {
    const project = createDialogProject();
    const { rerender } = render(
      <AutoShortsDialog
        project={project}
        missingMediaIds={[]}
        narrationMissing={false}
        onCancel={vi.fn()}
        onApply={vi.fn(() => true)}
      />,
    );
    expect(screen.getByText('예상 적용 결과: 메타데이터 확인 중...')).toBeInTheDocument();

    rerender(
      <AutoShortsDialog
        project={project}
        missingMediaIds={['video-id']}
        narrationMissing
        onCancel={vi.fn()}
        onApply={vi.fn(() => true)}
      />,
    );

    expect(screen.getByText('내레이션 길이: 확인 실패')).toBeInTheDocument();
    expect(screen.getByText('영상 길이: 확인 실패')).toBeInTheDocument();
    expect(
      screen.getByText(
        '예상 적용 결과: 내레이션 길이와 정확히 맞출 수 없어 이미지 장면 3초 적용',
      ),
    ).toBeInTheDocument();
  });

  it('cancels without applying and applies the calculated plan only on confirmation', async () => {
    const user = userEvent.setup();
    const project = createDialogProject();
    project.narration = null;
    const onCancel = vi.fn();
    const onApply = vi.fn(() => true);
    render(
      <AutoShortsDialog
        project={project}
        missingMediaIds={[]}
        narrationMissing={false}
        onCancel={onCancel}
        onApply={onApply}
      />,
    );

    await user.click(screen.getByRole('button', { name: '취소' }));
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onApply).not.toHaveBeenCalled();

    await user.type(
      screen.getByRole('textbox', { name: '대본 또는 자막' }),
      '자동 자막 1\n자동 자막 2',
    );
    await user.click(screen.getByRole('button', { name: '자동 구성 적용' }));
    expect(onApply).toHaveBeenCalledOnce();
    expect(onApply).toHaveBeenCalledWith(
      project,
      expect.arrayContaining([
        expect.objectContaining({ subtitle: '자동 자막 1' }),
        expect.objectContaining({ subtitle: '자동 자막 2' }),
      ]),
    );
  });

  it('keeps the dialog open and reports a stale project instead of applying it', async () => {
    const user = userEvent.setup();
    const project = createDialogProject();
    project.narration = null;
    render(
      <AutoShortsDialog
        project={project}
        missingMediaIds={['video-id']}
        narrationMissing={false}
        onCancel={vi.fn()}
        onApply={vi.fn(() => false)}
      />,
    );

    await user.click(screen.getByRole('button', { name: '자동 구성 적용' }));

    expect(screen.getByRole('alert')).toHaveTextContent(
      '프로젝트가 변경되어 자동 구성을 적용하지 못했습니다.',
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
