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
}: RecentProjectsProps) {
  return (
    <section
      className="panel recent-projects"
      aria-labelledby="recent-projects-heading"
    >
      <h2 id="recent-projects-heading">최근 프로젝트</h2>
      {loading ? <p>최근 프로젝트를 불러오는 중...</p> : null}
      {!loading && listFailed ? (
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
      {!loading && !listFailed && projects.length === 0 ? (
        <p>최근 프로젝트가 없습니다.</p>
      ) : null}
      {!loading && !listFailed && projects.length > 0 ? (
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
      {removeError ? (
        <p role="alert">최근 프로젝트를 목록에서 제거하지 못했습니다.</p>
      ) : null}
      {openError === 'missing' ? (
        <p role="alert">파일을 찾을 수 없어 최근 목록에서 제거했습니다.</p>
      ) : null}
      {openError === 'open' ? (
        <p role="alert">최근 프로젝트를 열지 못했습니다.</p>
      ) : null}
    </section>
  );
}
