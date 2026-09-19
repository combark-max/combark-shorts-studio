import { useEffect, useState } from 'react';

import { AppHeader } from './components/AppHeader';
import { MediaSidebar } from './components/MediaSidebar';
import { PreviewPanel } from './components/PreviewPanel';
import { PropertiesPanel } from './components/PropertiesPanel';
import { TimelineShell } from './components/TimelineShell';

const noop = (): void => undefined;

export function App() {
  const [appVersion, setAppVersion] = useState('—');

  useEffect(() => {
    window.combarkDesktop
      .getAppVersion()
      .then((version) => setAppVersion(version))
      .catch(() => setAppVersion('—'));
  }, []);

  return (
    <div className="app-shell">
      <AppHeader
        onNewProject={noop}
        onOpenProject={noop}
        onSaveProject={noop}
        onSaveProjectAs={noop}
        onAutoShorts={noop}
        onExport={noop}
      />
      <main className="workspace">
        <MediaSidebar />
        <PreviewPanel />
        <PropertiesPanel />
      </main>
      <TimelineShell />
      <footer className="app-footer">v{appVersion}</footer>
    </div>
  );
}