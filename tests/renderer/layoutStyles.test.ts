import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

afterEach(() => {
  document.head.innerHTML = '';
  document.body.innerHTML = '';
});

describe('compact editor layout styles', () => {
  it('keeps timeline controls compact without shrinking track interaction geometry', () => {
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
    const track = getComputedStyle(document.querySelector('.timeline-track') as Element);
    const clip = getComputedStyle(document.querySelector('.timeline-clip') as Element);
    const handle = getComputedStyle(document.querySelector('.timeline-resize-handle') as Element);

    expect(shell.paddingTop).toBe('5px');
    expect(shell.paddingBottom).toBe('5px');
    expect(timeline.marginTop).toBe('3px');
    expect(toolbarButton.paddingTop).toBe('4px');
    expect(toolbarButton.paddingBottom).toBe('4px');
    expect(ruler.height).toBe('26px');
    expect(track.height).toBe('32px');
    expect(clip.height).toBe('26px');
    expect(handle.width).toBe('12px');
  });

  it('defines bounded wide and output preview frames with minimum-window safeguards', () => {
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
            <div class="preview-controls"></div>
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

    expect(stage.gridTemplateColumns).toContain('minmax(0, 1fr)');
    expect(wide.aspectRatio).toBe('16 / 9');
    expect(wide.maxWidth).toBe('100%');
    expect(output.aspectRatio).toBe('9 / 16');
    expect(media.objectFit).toBe('contain');
    expect(subtitle.fontSize).toBe('2.34375cqw');

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
  });
});
