import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RecoveryPrompt } from '../../src/renderer/components/RecoveryPrompt';
import { createNewProject } from '../../src/shared/project/createProject';
import type { RecoveryCandidate } from '../../src/shared/project/types';

afterEach(() => {
  cleanup();
});

function createCandidate(
  name: string,
  modifiedAt: string,
): RecoveryCandidate {
  const project = createNewProject(name);

  return {
    projectId: project.projectId,
    name,
    modifiedAt,
    project,
  };
}

describe('RecoveryPrompt', () => {
  it('shows every recovery candidate with its name and modified time', () => {
    const firstCandidate = createCandidate(
      '최신 복구',
      '2026-09-19T02:00:00.000Z',
    );
    const secondCandidate = createCandidate(
      '이전 복구',
      '2026-09-19T01:00:00.000Z',
    );

    render(
      <RecoveryPrompt
        candidates={[firstCandidate, secondCandidate]}
        discardFailedProjectId={null}
        onRecover={vi.fn()}
        onDiscard={vi.fn()}
      />,
    );

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('최신 복구')).toBeInTheDocument();
    expect(screen.getByText('2026-09-19T02:00:00.000Z')).toBeInTheDocument();
    expect(screen.getByText('이전 복구')).toBeInTheDocument();
    expect(screen.getByText('2026-09-19T01:00:00.000Z')).toBeInTheDocument();
  });

  it('invokes recover and discard for the selected candidate', async () => {
    const user = userEvent.setup();
    const candidate = createCandidate(
      '선택할 복구',
      '2026-09-19T02:00:00.000Z',
    );
    const onRecover = vi.fn();
    const onDiscard = vi.fn();
    render(
      <RecoveryPrompt
        candidates={[candidate]}
        discardFailedProjectId={null}
        onRecover={onRecover}
        onDiscard={onDiscard}
      />,
    );
    const item = screen.getByRole('listitem');

    await user.click(within(item).getByRole('button', { name: '복구' }));
    await user.click(within(item).getByRole('button', { name: '버리기' }));

    expect(onRecover).toHaveBeenCalledWith(candidate);
    expect(onDiscard).toHaveBeenCalledWith(candidate.projectId);
  });

  it('shows a retryable discard error only for the failed candidate', () => {
    const failedCandidate = createCandidate(
      '삭제 실패 복구',
      '2026-09-19T02:00:00.000Z',
    );
    const otherCandidate = createCandidate(
      '다른 복구',
      '2026-09-19T01:00:00.000Z',
    );
    render(
      <RecoveryPrompt
        candidates={[failedCandidate, otherCandidate]}
        discardFailedProjectId={failedCandidate.projectId}
        onRecover={vi.fn()}
        onDiscard={vi.fn()}
      />,
    );

    expect(
      screen.getByText('복구 파일을 삭제하지 못했습니다. 다시 시도해 주세요.'),
    ).toBeInTheDocument();
  });
});
