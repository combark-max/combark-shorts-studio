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

export interface MediaAsset {
  id: string;
  kind: 'image' | 'video';
  sourcePath: string;
  fileName: string;
}

export interface ProjectDocumentV2 {
  schemaVersion: 2;
  projectId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  settings: ProjectSettings;
  media: MediaAsset[];
}

export interface SceneV3 {
  mediaId: string;
  durationMs: number | null;
}

export interface ProjectDocumentV3 {
  schemaVersion: 3;
  projectId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  settings: ProjectSettings;
  media: MediaAsset[];
  scenes: SceneV3[];
}

export interface Scene extends SceneV3 {
  subtitle: string;
}

export interface ProjectDocumentV4 {
  schemaVersion: 4;
  projectId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  settings: ProjectSettings;
  media: MediaAsset[];
  scenes: Scene[];
}

export interface NarrationAsset {
  sourcePath: string;
  fileName: string;
}

export interface ProjectDocumentV5 {
  schemaVersion: 5;
  projectId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  settings: ProjectSettings;
  media: MediaAsset[];
  scenes: Scene[];
  narration: NarrationAsset | null;
}

export type ProjectDocument = ProjectDocumentV5;

export interface RecoveryCandidate {
  projectId: string;
  name: string;
  modifiedAt: string;
  project: ProjectDocument;
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
      project: ProjectDocument;
      filePath: string;
    }
  | {
      status: 'missing';
      recentProjects: RecentProject[];
    };
