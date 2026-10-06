import { useState } from 'react';

import type { RecentProject } from '../../shared/project/types';

interface RecentProjectsProps {
  projects: RecentProject[];
  loading: boolean;
  listFailed: boolean;
  openError: 'missing' | 'open' | null;
  onRetry: () => void | Promise<void>;
  onOpen: (filePath: string) => void | Promise<void>;
  onRemove: (filePath: string) => void | Promise<void>;
  removeError: boolean;
  defaultCompact?: boolean;
}

function getFileName(filePath: string): string {
  return filePath.split(/[\\/]/).at(-1) ?? filePath;
}

export function RecentProjects({
  projects,
  loading,
  listFailed,
  openError,
  onRetry,
  onOpen,
  onRemove,
  removeError,
  defaultCompact = false,
}: RecentProjectsProps) {
  const [compact, setCompact] = useState(defaultCompact);
  const hasVisibleError =
    listFailed || removeError || openError !== null;
  const expanded = !compact || hasVisibleError;

  return (
    <section
      className={
        expanded
          ? 'panel recent-projects'
          : 'panel recent-projects recent-projects-compact'
      }
      aria-labelledby="recent-projects-heading"
    >
      <div className="recent-projects-header">
        <h2 id="recent-projects-heading">최근 프로젝트</h2>
        {!expanded ? (
          <span className="recent-projects-summary">
            {loading ? '불러오는 중' : `${projects.length}개`}
          </span>
        ) : null}
        {!hasVisibleError ? (
          <button
            aria-expanded={expanded}
            aria-label={
              expanded ? '최근 프로젝트 접기' : '최근 프로젝트 펼치기'
            }
            type="button"
            onClick={() => setCompact(expanded)}
          >
            {expanded ? '접기' : '펼치기'}
          </button>
        ) : null}
      </div>
      {expanded && loading ? <p>최근 프로젝트를 불러오는 중...</p> : null}
      {expanded && !loading && listFailed ? (
        <div role="alert">
          <span>최근 프로젝트를 불러오지 못했습니다.</span>
          <button
            type="button"
            onClick={() => {
              void onRetry();
            }}
          >
            다시 시도
          </button>
        </div>
      ) : null}
      {expanded && !loading && !listFailed && projects.length === 0 ? (
        <p>최근 프로젝트가 없습니다.</p>
      ) : null}
      {expanded && !loading && !listFailed && projects.length > 0 ? (
        <ul className="recent-project-list">
          {projects.map((project) => (
            <li key={project.projectId}>
              <button
                className="recent-project-open"
                type="button"
                onClick={() => {
                  void onOpen(project.filePath);
                }}
              >
                <strong>{getFileName(project.filePath)}</strong>
              </button>
              <button
                className="recent-project-remove"
                type="button"
                aria-label={`${getFileName(project.filePath)} 목록에서 제거`}
                onClick={() => {
                  void onRemove(project.filePath);
                }}
              >
                목록에서 제거
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {expanded && removeError ? (
        <p role="alert">최근 프로젝트를 목록에서 제거하지 못했습니다.</p>
      ) : null}
      {expanded && openError === 'missing' ? (
        <p role="alert">파일을 찾을 수 없어 최근 목록에서 제거했습니다.</p>
      ) : null}
      {expanded && openError === 'open' ? (
        <p role="alert">최근 프로젝트를 열지 못했습니다.</p>
      ) : null}
    </section>
  );
}
