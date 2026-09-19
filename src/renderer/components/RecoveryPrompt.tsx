import type { RecoveryCandidate } from '../../shared/project/types';

interface RecoveryPromptProps {
  candidates: RecoveryCandidate[];
  discardFailedProjectId: string | null;
  onRecover: (candidate: RecoveryCandidate) => void;
  onDiscard: (projectId: string) => void | Promise<void>;
}

export function RecoveryPrompt({
  candidates,
  discardFailedProjectId,
  onRecover,
  onDiscard,
}: RecoveryPromptProps) {
  return (
    <dialog open aria-labelledby="recovery-prompt-title">
      <h2 id="recovery-prompt-title">복구 가능한 프로젝트</h2>
      <p>저장되지 않은 프로젝트 복구본을 선택해 복구하거나 버릴 수 있습니다.</p>
      <ul>
        {candidates.map((candidate) => (
          <li key={candidate.projectId}>
            <strong>{candidate.name}</strong>
            <time dateTime={candidate.modifiedAt}>{candidate.modifiedAt}</time>
            <button type="button" onClick={() => onRecover(candidate)}>
              복구
            </button>
            <button type="button" onClick={() => onDiscard(candidate.projectId)}>
              버리기
            </button>
            {discardFailedProjectId === candidate.projectId ? (
              <p role="alert">
                복구 파일을 삭제하지 못했습니다. 다시 시도해 주세요.
              </p>
            ) : null}
          </li>
        ))}
      </ul>
    </dialog>
  );
}
