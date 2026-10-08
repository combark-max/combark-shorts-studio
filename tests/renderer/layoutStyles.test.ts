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
});
