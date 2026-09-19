import { useEffect, useState } from 'react';

import { AppHeader } from './components/AppHeader';
import { MediaSidebar } from './components/MediaSidebar';
import { PreviewPanel } from './components/PreviewPanel';
import { PropertiesPanel } from './components/PropertiesPanel';
import { TimelineShell } from './components/TimelineShell';
import { useProjectController } from './project/useProjectController';

const noop = (): void => undefined;

export function App() {
  const [appVersion, setAppVersion] = useState('—');
  const {
    state,
    newProject,
    openProject,
    saveProject,
    saveProjectAs,
  } = useProjectController();

  useEffect(() => {
    window.combarkDesktop
      .getAppVersion()
      .then((version) => setAppVersion(version))
      .catch(() => setAppVersion('—'));
  }, []);

  return (
    <div className="app-shell">
      <AppHeader
        onNewProject={newProject}
        onOpenProject={openProject}
        onSaveProject={saveProject}
        onSaveProjectAs={saveProjectAs}
        onAutoShorts={noop}
        onExport={noop}
      />
      <main className="workspace">
        <MediaSidebar />
        <PreviewPanel />
        <PropertiesPanel />
      </main>
      <TimelineShell />
      <footer className="app-footer">
        <span>{state.project.name}</span>
        <span>{state.dirty ? '저장 필요' : '저장됨'}</span>
        <span>v{appVersion}</span>
      </footer>
    </div>
  );
}