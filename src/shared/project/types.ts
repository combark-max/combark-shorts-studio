export interface ProjectSettings {
  width: 1080;
  height: 1920;
  fps: 30;
}

export interface ProjectDocumentV1 {
  schemaVersion: 1;
  projectId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  settings: ProjectSettings;
}

export interface RecoveryCandidate {
  projectId: string;
  name: string;
  modifiedAt: string;
  project: ProjectDocumentV1;
}

export interface RecentProject {
  filePath: string;
  projectId: string;
  name: string;
  lastUsedAt: string;
}

export interface RecentProjectsStoreV1 {
  schemaVersion: 1;
  projects: RecentProject[];
}

export type OpenRecentProjectResult =
  | {
      status: 'opened';
      project: ProjectDocumentV1;
      filePath: string;
    }
  | {
      status: 'missing';
      recentProjects: RecentProject[];
    };
