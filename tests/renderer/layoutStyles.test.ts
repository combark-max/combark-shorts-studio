import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

afterEach(() => {
  document.head.innerHTML = '';
  document.body.innerHTML = '';
});

describe('compact editor layout styles', () => {
  it('keeps the timeline toolbar pinned while the shell content scrolls', () => {
    const style = document.createElement('style');
    style.textContent = readFileSync(
      join(process.cwd(), 'src', 'renderer', 'styles.css'),
      'utf8',
    );
    document.head.append(style);
    document.body.innerHTML = `
      <section class="timeline-shell">
        <h2>Timeline</h2>
        <div class="multi-track-timeline">
          <div class="timeline-toolbar">Toolbar</div>
          <div class="timeline-grid">Tracks</div>
        </div>
        <div class="selected-scene-detail">Detail</div>
      </section>
    `;

    const shell = getComputedStyle(
      document.querySelector('.timeline-shell') as Element,
    );
    const timeline = getComputedStyle(
      document.querySelector('.multi-track-timeline') as Element,
    );
    const toolbar = getComputedStyle(
      document.querySelector('.timeline-toolbar') as Element,
    );

    expect(shell.overflowY).toBe('auto');
    expect(timeline.display).toBe('contents');
    expect(toolbar.position).toBe('sticky');
    expect(toolbar.top).toBe('0px');
    expect(toolbar.zIndex).toBe('6');
    expect(toolbar.backgroundColor).toBe('rgb(25, 29, 36)');
    expect(toolbar.marginTop).toBe('3px');
    expect(toolbar.marginBottom).toBe('6px');
  });

  it('uses responsive timeline shell and shared track geometry', () => {
    const style = document.createElement('style');
    style.textContent = readFileSync(
      join(process.cwd(), 'src', 'renderer', 'styles.css'),
      'utf8',
    );
    document.head.append(style);
    document.body.innerHTML = `
      <section class="timeline-shell">
        <div class="multi-track-timeline">
          <div class="timeline-toolbar"><button type="button">추가</button></div>
          <div class="timeline-ruler"></div>
          <div class="timeline-track">
            <div class="timeline-clip">
              <button class="timeline-resize-handle" type="button"></button>
            </div>
          </div>
        </div>
      </section>
    `;

    const shell = getComputedStyle(document.querySelector('.timeline-shell') as Element);
    const timeline = getComputedStyle(document.querySelector('.multi-track-timeline') as Element);
    const toolbarButton = getComputedStyle(document.querySelector('.timeline-toolbar button') as Element);
    const ruler = getComputedStyle(document.querySelector('.timeline-ruler') as Element);
    const handle = getComputedStyle(document.querySelector('.timeline-resize-handle') as Element);
    const rules = Array.from((style.sheet as CSSStyleSheet).cssRules).filter(
      (rule): rule is CSSStyleRule => rule instanceof CSSStyleRule,
    );
    const ruleFor = (selector: string) =>
      rules.find((rule) => rule.selectorText === selector)?.style;
    const clipRule = rules.find(
      (rule) =>
        rule.selectorText.includes('.timeline-clip') &&
        rule.selectorText.includes('.timeline-audio-clip'),
    )?.style;

    expect(shell.paddingTop).toBe('5px');
    expect(shell.paddingBottom).toBe('5px');
    expect(timeline.display).toBe('contents');
    expect(toolbarButton.paddingTop).toBe('4px');
    expect(toolbarButton.paddingBottom).toBe('4px');
    expect(ruler.height).toBe('26px');
    expect(ruleFor('.timeline-shell')?.height).toBe(
      'clamp(180px, 22vh, 260px)',
    );
    expect(
      ruleFor('.timeline-shell')
        ?.getPropertyValue('--timeline-track-height')
        .split(' ')
        .join(''),
    ).toBe('clamp(32px,4vh,44px)');
    expect(ruleFor('.timeline-track-labels')?.gridTemplateRows).toBe(
      '26px repeat(3, var(--timeline-track-height))',
    );
    expect(ruleFor('.timeline-track')?.height).toBe(
      'var(--timeline-track-height)',
    );
    expect(clipRule?.height).toBe(
      'calc(var(--timeline-track-height) - 6px)',
    );
    expect(handle.width).toBe('12px');
  });

  it('stacks responsive preview controls below bounded wide and output frames', () => {
    const style = document.createElement('style');
    style.textContent = readFileSync(
      join(process.cwd(), 'src', 'renderer', 'styles.css'),
      'utf8',
    );
    document.head.append(style);
    document.body.innerHTML = `
      <main class="workspace">
        <section class="preview-panel">
          <div class="preview-stage">
            <div class="preview-frame preview-frame-wide">
              <img class="preview-media" alt="wide" />
              <p class="preview-subtitle preview-subtitle-large">subtitle</p>
            </div>
            <div class="preview-controls">
              <div class="preview-controls-primary">
                <div class="preview-frame-mode"><button type="button">wide</button></div>
                <div class="preview-buttons"><button type="button">play</button></div>
                <div class="preview-view-mode"><button type="button">fit</button></div>
              </div>
              <div class="preview-controls-secondary">
                <div class="preview-seek"><input type="range" /></div>
                <span class="preview-time">00:00 / 00:03</span>
              </div>
              <div class="preview-control-notes">
                <p class="preview-frame-note">note</p>
              </div>
            </div>
          </div>
        </section>
        <div class="preview-frame preview-frame-output"></div>
      </main>
    `;

    const stage = getComputedStyle(document.querySelector('.preview-stage') as Element);
    const wide = getComputedStyle(document.querySelector('.preview-frame-wide') as Element);
    const output = getComputedStyle(document.querySelector('.preview-frame-output') as Element);
    const media = getComputedStyle(document.querySelector('.preview-media') as Element);
    const subtitle = getComputedStyle(document.querySelector('.preview-subtitle') as Element);
    const controls = getComputedStyle(document.querySelector('.preview-controls') as Element);
    const primary = getComputedStyle(
      document.querySelector('.preview-controls-primary') as Element,
    );
    const secondary = getComputedStyle(
      document.querySelector('.preview-controls-secondary') as Element,
    );
    const notes = getComputedStyle(
      document.querySelector('.preview-control-notes') as Element,
    );
    const seek = getComputedStyle(document.querySelector('.preview-seek') as Element);
    const controlButton = getComputedStyle(
      document.querySelector('.preview-controls button') as Element,
    );

    expect(stage.gridTemplateColumns).toBe('minmax(0, 1fr)');
    expect(stage.gridTemplateRows).toBe('minmax(0, 1fr) auto');
    expect(stage.minWidth).toBe('0px');
    expect(wide.aspectRatio).toBe('16 / 9');
    expect(wide.maxWidth).toBe('100%');
    expect(wide.minWidth).toBe('0px');
    expect(output.aspectRatio).toBe('9 / 16');
    expect(media.objectFit).toBe('contain');
    expect(subtitle.fontSize).toBe('2.34375cqw');
    expect(controls.display).toBe('grid');
    expect(controls.width).toBe('100%');
    expect(primary.display).toBe('flex');
    expect(primary.flexWrap).toBe('nowrap');
    expect(secondary.display).toBe('grid');
    expect(secondary.gridTemplateColumns).toBe('minmax(0, 1fr) auto');
    expect(seek.minWidth).toBe('0px');
    expect(notes.display).toBe('flex');
    expect(controlButton.whiteSpace).toBe('nowrap');

    const minimumWindowRule = Array.from(
      (style.sheet as CSSStyleSheet).cssRules,
    ).find(
      (rule): rule is CSSMediaRule =>
        rule instanceof CSSMediaRule &&
        rule.conditionText.includes('max-width: 1180px'),
    );
    expect(minimumWindowRule).toBeDefined();
    expect(
      Array.from(minimumWindowRule?.cssRules ?? []).some(
        (rule) =>
          rule instanceof CSSStyleRule &&
          rule.selectorText === '.preview-controls' &&
          rule.style.padding === '8px',
      ),
    ).toBe(true);
    expect(
      Array.from(minimumWindowRule?.cssRules ?? []).some(
        (rule) =>
          rule instanceof CSSStyleRule &&
          rule.selectorText === '.preview-controls-primary' &&
          rule.style.flexWrap === 'wrap',
      ),
    ).toBe(true);
  });

  it('lays out a bounded media dock beside preview with only dock content scrolling', () => {
    const style = document.createElement('style');
    style.textContent = readFileSync(
      join(process.cwd(), 'src', 'renderer', 'styles.css'),
      'utf8',
    );
    document.head.append(style);
    document.body.innerHTML = `
      <main class="workspace">
        <aside class="panel media-sidebar media-dock">
          <div class="media-sidebar-header">
            <button class="media-sidebar-toggle" type="button">접기</button>
          </div>
          <div class="media-sidebar-content"></div>
        </aside>
        <section class="preview-panel"></section>
      </main>
      <aside class="panel media-sidebar media-dock media-sidebar-collapsed">
        <div class="media-sidebar-header">
          <button class="media-sidebar-toggle" type="button">열기</button>
        </div>
      </aside>
    `;

    const workspace = getComputedStyle(document.querySelector('.workspace') as Element);
    const dock = getComputedStyle(document.querySelector('.media-dock') as Element);
    const content = getComputedStyle(
      document.querySelector('.media-sidebar-content') as Element,
    );
    const collapsed = getComputedStyle(
      document.querySelector('.media-sidebar-collapsed') as Element,
    );
    const collapsedHeader = getComputedStyle(
      document.querySelector(
        '.media-sidebar-collapsed .media-sidebar-header',
      ) as Element,
    );
    const toggle = getComputedStyle(
      document.querySelector('.media-sidebar-toggle') as Element,
    );
    const selectors = Array.from((style.sheet as CSSStyleSheet).cssRules)
      .filter((rule): rule is CSSStyleRule => rule instanceof CSSStyleRule)
      .map((rule) => rule.selectorText);

    expect(workspace.gridTemplateColumns).toBe('auto minmax(0, 1fr)');
    expect(workspace.overflowX).toBe('hidden');
    expect(workspace.overflowY).toBe('hidden');
    expect(dock.position).toBe('static');
    expect(dock.minHeight).toBe('0px');
    expect(dock.overflowY).toBe('hidden');
    expect(content.minHeight).toBe('0px');
    expect(content.overflowY).toBe('auto');
    expect(collapsed.width).toBe('48px');
    expect(collapsedHeader.flexDirection).toBe('column');
    expect(toggle.whiteSpace).toBe('nowrap');
    expect(selectors).not.toContain('.media-drawer-backdrop');
    expect(selectors).not.toContain('.media-drawer-launcher');
  });

  it('wraps header actions by group and bounds the expanded recent-project list', () => {
    const style = document.createElement('style');
    style.textContent = readFileSync(
      join(process.cwd(), 'src', 'renderer', 'styles.css'),
      'utf8',
    );
    document.head.append(style);
    document.body.innerHTML = `
      <header class="app-header">
        <h1>Combark Shorts Studio</h1>
        <nav class="header-actions">
          <div class="header-action-group">
            <span class="header-action-group-label">프로젝트 관리</span>
            <button type="button">다른 이름으로 저장</button>
          </div>
          <div class="header-action-group header-action-group-export">
            <span class="header-action-group-label">내보내기</span>
            <button type="button">MP4 내보내기</button>
          </div>
        </nav>
      </header>
      <section class="panel recent-projects">
        <ul class="recent-project-list"><li>project</li></ul>
      </section>
    `;

    const header = getComputedStyle(document.querySelector('.app-header') as Element);
    const actions = getComputedStyle(document.querySelector('.header-actions') as Element);
    const group = getComputedStyle(document.querySelector('.header-action-group') as Element);
    const label = getComputedStyle(
      document.querySelector('.header-action-group-label') as Element,
    );
    const button = getComputedStyle(
      document.querySelector('.header-action-group button') as Element,
    );
    const exportGroup = getComputedStyle(
      document.querySelector('.header-action-group-export') as Element,
    );
    const recentList = getComputedStyle(
      document.querySelector('.recent-project-list') as Element,
    );

    expect(header.flexWrap).toBe('nowrap');
    expect(actions.flexWrap).toBe('wrap');
    expect(group.display).toBe('flex');
    expect(group.flexWrap).toBe('nowrap');
    expect(group.flexShrink).toBe('0');
    expect(label.whiteSpace).toBe('nowrap');
    expect(button.whiteSpace).toBe('nowrap');
    expect(exportGroup.borderLeftWidth).toBe('1px');
    expect(recentList.maxHeight).toBe('132px');
    expect(recentList.overflowX).toBe('hidden');
    expect(recentList.overflowY).toBe('auto');

    const minimumWindowRule = Array.from(
      (style.sheet as CSSStyleSheet).cssRules,
    ).find(
      (rule): rule is CSSMediaRule =>
        rule instanceof CSSMediaRule &&
        rule.conditionText.includes('max-width: 1180px'),
    );
    expect(minimumWindowRule).toBeDefined();
    expect(
      Array.from(minimumWindowRule?.cssRules ?? []).some(
        (rule) =>
          rule instanceof CSSStyleRule &&
          rule.selectorText === '.header-actions' &&
          rule.style.justifyContent === 'flex-start',
      ),
    ).toBe(true);
  });
});
