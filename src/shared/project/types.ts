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