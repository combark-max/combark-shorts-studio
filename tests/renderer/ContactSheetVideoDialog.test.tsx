import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { compareContactSheetBoundary } from '../../src/shared/contactSheetVideo';
import { ContactSheetVideoDialog } from '../../src/renderer/components/ContactSheetVideoDialog';

const desktopApi = {
  openContactSheetImages: vi.fn(),
  analyzeContactSheets: vi.fn(),
  createContactSheetVideo: vi.fn(),
  cancelContactSheetVideo: vi.fn(),
  onContactSheetVideoProgress: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  desktopApi.openContactSheetImages.mockResolvedValue([]);
  desktopApi.analyzeContactSheets.mockResolvedValue([]);
  desktopApi.createContactSheetVideo.mockResolvedValue({ status: 'canceled' });
  desktopApi.cancelContactSheetVideo.mockResolvedValue(undefined);
  desktopApi.onContactSheetVideoProgress.mockReturnValue(vi.fn());
  Object.defineProperty(window, 'combarkDesktop', {
    configurable: true,
    value: desktopApi,
  });
});

afterEach(cleanup);

function selectedSheets(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: `sheet-${index + 1}`,
    sourcePath: `C:\\images\\sheet-${index + 1}.png`,
    fileName: `sheet-${index + 1}.png`,
  }));
}

describe('ContactSheetVideoDialog', () => {
  it('reanalyzes one sheet after a grid change and updates its real-frame overlay', async () => {
    const user = userEvent.setup();
    const sheets = selectedSheets(1);
    const fourByFour = Array.from({ length: 16 }, (_, index) => ({
      x: index % 4 * 20, y: Math.floor(index / 4) * 18, width: 20, height: 18,
    }));
    const fourBySix = Array.from({ length: 24 }, (_, index) => ({
      x: index % 6 * 20, y: Math.floor(index / 6) * 18, width: 20, height: 18,
    }));
    desktopApi.openContactSheetImages.mockResolvedValue(sheets);
    desktopApi.analyzeContactSheets
      .mockResolvedValueOnce([{
        id: sheets[0].id, status: 'recognized', rows: 4, columns: 4,
        frameCount: 16, width: 80, height: 72, frames: fourByFour,
      }])
      .mockResolvedValueOnce([{
        id: sheets[0].id, status: 'recognized', rows: 4, columns: 6,
        frameCount: 24, width: 120, height: 72, frames: fourBySix,
      }]);
    render(<ContactSheetVideoDialog generalExportInProgress={false} onClose={vi.fn()} onBusyChange={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Contact sheet 이미지 추가' }));
    expect(await screen.findByText('4행 × 4열 / 총 16프레임')).toBeInTheDocument();
    expect(screen.getAllByTestId('contact-sheet-frame')).toHaveLength(16);

    fireEvent.change(screen.getByRole('spinbutton', { name: 'sheet-1.png 열' }), {
      target: { value: '6' },
    });

    expect(await screen.findByText('4행 × 6열 / 총 24프레임')).toBeInTheDocument();
    expect(screen.getAllByTestId('contact-sheet-frame')).toHaveLength(24);
    expect(desktopApi.analyzeContactSheets).toHaveBeenLastCalledWith([
      { ...sheets[0], rows: 4, columns: 6 },
    ]);
    expect(screen.getByText('원본 24프레임 → 출력 24프레임 / 예상 3.0초')).toBeInTheDocument();
  });

  it('ignores an older analysis result after the grid changes', async () => {
    const sheets = selectedSheets(1);
    let resolveInitial!: (value: unknown[]) => void;
    let resolveGrid!: (value: unknown[]) => void;
    desktopApi.openContactSheetImages.mockResolvedValue(sheets);
    desktopApi.analyzeContactSheets
      .mockReturnValueOnce(new Promise((resolve) => { resolveInitial = resolve; }))
      .mockReturnValueOnce(new Promise((resolve) => { resolveGrid = resolve; }));
    render(<ContactSheetVideoDialog generalExportInProgress={false} onClose={vi.fn()} onBusyChange={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Contact sheet 이미지 추가' }));
    const columns = await screen.findByRole('spinbutton', { name: 'sheet-1.png 열' });
    fireEvent.change(columns, { target: { value: '6' } });
    await act(async () => resolveGrid([{
      id: sheets[0].id, status: 'recognized', rows: 4, columns: 6,
      frameCount: 24, width: 120, height: 72, frames: [],
    }]));
    expect(screen.getByText('4행 × 6열 / 총 24프레임')).toBeInTheDocument();

    await act(async () => resolveInitial([{
      id: sheets[0].id, status: 'recognized', rows: 4, columns: 4,
      frameCount: 16, width: 80, height: 72, frames: [],
    }]));
    expect(screen.getByText('4행 × 6열 / 총 24프레임')).toBeInTheDocument();
  });

  it('ignores an older analysis failure after the grid changes', async () => {
    const sheets = selectedSheets(1);
    let rejectInitial!: (reason: Error) => void;
    desktopApi.openContactSheetImages.mockResolvedValue(sheets);
    desktopApi.analyzeContactSheets
      .mockReturnValueOnce(new Promise((_resolve, reject) => { rejectInitial = reject; }))
      .mockResolvedValueOnce([{
        id: sheets[0].id, status: 'recognized', rows: 4, columns: 6,
        frameCount: 24, width: 120, height: 72, frames: [],
      }]);
    render(<ContactSheetVideoDialog generalExportInProgress={false} onClose={vi.fn()} onBusyChange={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Contact sheet 이미지 추가' }));
    fireEvent.change(await screen.findByRole('spinbutton', { name: 'sheet-1.png 열' }), {
      target: { value: '6' },
    });
    expect(await screen.findByText('24프레임 인식')).toBeInTheDocument();

    await act(async () => rejectInitial(new Error('old failure')));
    expect(screen.getByText('24프레임 인식')).toBeInTheDocument();
    expect(screen.queryByText('인식 실패')).not.toBeInTheDocument();
  });

  it('keeps interpolation off by default and omits it from the create request', async () => {
    const user = userEvent.setup();
    const sheets = selectedSheets(1);
    desktopApi.openContactSheetImages.mockResolvedValue(sheets);
    desktopApi.analyzeContactSheets.mockResolvedValue([
      { id: sheets[0].id, status: 'recognized', frameCount: 16 },
    ]);
    render(
      <ContactSheetVideoDialog
        generalExportInProgress={false}
        onClose={vi.fn()}
        onBusyChange={vi.fn()}
      />,
    );

    const checkbox = screen.getByRole('checkbox', {
      name: '부드러운 미세 동작',
    });
    expect(checkbox).not.toBeChecked();
    expect(screen.getByText('예상 출력 해상도: 분석 정보 없음')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: '강도' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Contact sheet 이미지 추가' }));
    await screen.findByText('16프레임 인식');
    expect(screen.getByText('원본 16프레임 → 출력 16프레임 / 예상 2.0초'))
      .toBeInTheDocument();

    await user.click(checkbox);
    expect(screen.getByRole('combobox', { name: '강도' })).toHaveValue('medium');
    await user.click(checkbox);

    await user.click(screen.getByRole('button', { name: '영상 만들기' }));
    expect(desktopApi.createContactSheetVideo).toHaveBeenCalledWith({
      sheets: sheets.map((sheet) => ({ ...sheet, rows: 4, columns: 4 })),
      fps: 8,
    });
  });

  it.each([
    ['light', '약하게', 32, '4.0'],
    ['medium', '보통', 48, '6.0'],
    ['strong', '많이', 64, '8.0'],
  ] as const)(
    'shows %s interpolation output and duration',
    async (interpolation, label, outputFrames, duration) => {
      const user = userEvent.setup();
      const sheets = selectedSheets(1);
      desktopApi.openContactSheetImages.mockResolvedValue(sheets);
      desktopApi.analyzeContactSheets.mockResolvedValue([
        { id: sheets[0].id, status: 'recognized', frameCount: 16 },
      ]);
      render(
        <ContactSheetVideoDialog
          generalExportInProgress={false}
          onClose={vi.fn()}
          onBusyChange={vi.fn()}
        />,
      );

      await user.click(screen.getByRole('button', { name: 'Contact sheet 이미지 추가' }));
      await screen.findByText('16프레임 인식');
      await user.click(screen.getByRole('checkbox', { name: '부드러운 미세 동작' }));
      const strength = screen.getByRole('combobox', { name: '강도' });
      expect(strength).toHaveValue('medium');
      await user.selectOptions(strength, interpolation);
      expect(screen.getByRole('option', { name: label })).toBeInTheDocument();
      expect(screen.getByText(
        `원본 16프레임 → 출력 ${outputFrames}프레임 / 예상 ${duration}초`,
      )).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: '영상 만들기' }));
      expect(desktopApi.createContactSheetVideo).toHaveBeenCalledWith({
        sheets: sheets.map((sheet) => ({ ...sheet, rows: 4, columns: 4 })),
        fps: 8,
        interpolation,
      });
    },
  );

  it('analyzes added sheets, shows a 48-frame 8fps summary, and changes order', async () => {
    const user = userEvent.setup();
    const sheets = selectedSheets(3);
    desktopApi.openContactSheetImages.mockResolvedValue(sheets);
    desktopApi.analyzeContactSheets.mockResolvedValue(
      sheets.map((sheet) => ({
        id: sheet.id,
        status: 'recognized',
        frameCount: 16,
      })),
    );
    render(
      <ContactSheetVideoDialog
        generalExportInProgress={false}
        onClose={vi.fn()}
        onBusyChange={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Contact sheet 이미지 추가' }));

    expect(await screen.findByText('이미지 3장')).toBeInTheDocument();
    expect(screen.getByText('원본 48프레임 → 출력 48프레임 / 예상 6.0초'))
      .toBeInTheDocument();
    expect(screen.getAllByText('16프레임 인식')).toHaveLength(3);
    const items = screen.getAllByRole('listitem');
    expect(within(items[0]).getByText('sheet-1.png')).toBeInTheDocument();

    await user.click(
      within(items[1]).getByRole('button', { name: 'sheet-2.png 위로' }),
    );
    expect(within(screen.getAllByRole('listitem')[0]).getByText('sheet-2.png'))
      .toBeInTheDocument();

    await user.selectOptions(screen.getByRole('combobox', { name: 'FPS' }), '16');
    expect(screen.getByText('원본 48프레임 → 출력 48프레임 / 예상 3.0초'))
      .toBeInTheDocument();
  });

  it('keeps video creation disabled when any sheet analysis fails', async () => {
    const user = userEvent.setup();
    const sheets = selectedSheets(2);
    desktopApi.openContactSheetImages.mockResolvedValue(sheets);
    desktopApi.analyzeContactSheets.mockResolvedValue([
      { id: sheets[0].id, status: 'recognized', frameCount: 16 },
      { id: sheets[1].id, status: 'failed', message: 'separator missing' },
    ]);
    render(
      <ContactSheetVideoDialog
        generalExportInProgress={false}
        onClose={vi.fn()}
        onBusyChange={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Contact sheet 이미지 추가' }));

    expect(await screen.findByText('인식 실패')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '영상 만들기' })).toBeDisabled();
  });

  it('reports busy state, displays progress, and cancels the active job', async () => {
    const user = userEvent.setup();
    const sheets = selectedSheets(1);
    const onBusyChange = vi.fn();
    let progressListener: ((progress: { stage: string }) => void) | undefined;
    let finish: ((result: { status: 'canceled' }) => void) | undefined;
    desktopApi.openContactSheetImages.mockResolvedValue(sheets);
    desktopApi.analyzeContactSheets.mockResolvedValue([
      { id: sheets[0].id, status: 'recognized', frameCount: 16 },
    ]);
    desktopApi.onContactSheetVideoProgress.mockImplementation((listener) => {
      progressListener = listener;
      return vi.fn();
    });
    desktopApi.createContactSheetVideo.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    render(
      <ContactSheetVideoDialog
        generalExportInProgress={false}
        onClose={vi.fn()}
        onBusyChange={onBusyChange}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Contact sheet 이미지 추가' }));
    await screen.findByText('16프레임 인식');
    await user.click(screen.getByRole('checkbox', { name: '부드러운 미세 동작' }));

    await user.click(screen.getByRole('button', { name: '영상 만들기' }));
    expect(onBusyChange).toHaveBeenLastCalledWith(true);
    expect(screen.getByRole('checkbox', { name: '부드러운 미세 동작' }))
      .toBeDisabled();
    expect(screen.getByRole('combobox', { name: '강도' })).toBeDisabled();
    act(() => progressListener?.({ stage: 'encoding' }));
    expect(screen.getByRole('status')).toHaveTextContent('MP4 인코딩 중');

    await user.click(screen.getByRole('button', { name: '작업 취소' }));
    expect(desktopApi.cancelContactSheetVideo).toHaveBeenCalledOnce();
    finish?.({ status: 'canceled' });
    expect(await screen.findByRole('button', { name: '영상 만들기' })).toBeEnabled();
    expect(onBusyChange).toHaveBeenLastCalledWith(false);
  });

  it('disables creation while the general MP4 export is in progress', async () => {
    const user = userEvent.setup();
    const sheets = selectedSheets(1);
    desktopApi.openContactSheetImages.mockResolvedValue(sheets);
    desktopApi.analyzeContactSheets.mockResolvedValue([
      { id: sheets[0].id, status: 'recognized', frameCount: 16 },
    ]);
    const { rerender } = render(
      <ContactSheetVideoDialog
        generalExportInProgress={false}
        onClose={vi.fn()}
        onBusyChange={vi.fn()}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Contact sheet 이미지 추가' }));
    await screen.findByText('16프레임 인식');

    rerender(
      <ContactSheetVideoDialog
        generalExportInProgress
        onClose={vi.fn()}
        onBusyChange={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: '영상 만들기' })).toBeDisabled();
  });
});


describe('phase 1 contact-sheet options', () => {
  async function openWithDetails(values: Array<number | null>) {
    const sheets = selectedSheets(values.length);
    desktopApi.openContactSheetImages.mockResolvedValue(sheets);
    desktopApi.analyzeContactSheets.mockResolvedValue(sheets.map((sheet, index) => ({
      id: sheet.id, status: 'recognized', frameCount: 16,
      details: { width: 320 - index * 2, height: 240, ...(values[index] === null ? {} : { boundary: { first: Array(768).fill(values[index]), last: Array(768).fill(values[index]) } }) },
    })));
    render(<ContactSheetVideoDialog generalExportInProgress={false} onClose={vi.fn()} onBusyChange={vi.fn()} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Contact sheet 이미지 추가' }));
    await screen.findAllByText('16프레임 인식');
    return { user, sheets };
  }
  it.each([24, 30])('preserves two seconds at %i fps and forwards center crop', async (outputFps) => {
    const { user, sheets } = await openWithDetails([0]);
    const smooth = screen.getByRole('checkbox', { name: '동작 속도 유지 · 부드러운 영상' });
    expect(smooth).not.toBeChecked();
    expect(screen.getByRole('combobox', { name: '출력 FPS' })).toHaveValue('24');
    expect(screen.getByRole('combobox', { name: '크롭 기준' })).toHaveValue('top-left');
    await user.click(screen.getByRole('checkbox', { name: '부드러운 미세 동작' }));
    await user.click(smooth);
    expect(screen.getByRole('checkbox', { name: '부드러운 미세 동작' })).not.toBeChecked();
    await user.selectOptions(screen.getByRole('combobox', { name: '출력 FPS' }), String(outputFps));
    await user.selectOptions(screen.getByRole('combobox', { name: '크롭 기준' }), 'center');
    expect(screen.getByText('원본 16프레임 → 출력 ' + outputFps * 2 + '프레임 / 예상 2.0초')).toBeInTheDocument();
    expect(screen.getByText('원본 FPS 8 / 출력 FPS ' + outputFps)).toBeInTheDocument();
    expect(screen.getByText('예상 출력 해상도 320 × 240')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '영상 만들기' }));
    expect(desktopApi.createContactSheetVideo).toHaveBeenCalledWith({ sheets: sheets.map((sheet) => ({ ...sheet, rows: 4, columns: 4 })), fps: 8, outputFps, cropMode: 'center' });
  });
  it('switches back to the unchanged slow-motion mode', async () => {
    const { user } = await openWithDetails([0]);
    await user.click(screen.getByRole('checkbox', { name: '동작 속도 유지 · 부드러운 영상' }));
    await user.click(screen.getByRole('checkbox', { name: '부드러운 미세 동작' }));
    expect(screen.getByRole('checkbox', { name: '동작 속도 유지 · 부드러운 영상' })).not.toBeChecked();
    expect(screen.getByText('원본 16프레임 → 출력 48프레임 / 예상 6.0초')).toBeInTheDocument();
  });
  it('warns without blocking and recalculates boundaries after reorder/removal', async () => {
    const { user } = await openWithDetails([0, 0, 255]);
    expect(screen.getByText(/연결부 2 → 3: 픽셀 변화가 큽니다/)).toBeInTheDocument();
    expect(screen.getByText('예상 출력 해상도 316 × 240')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '영상 만들기' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'sheet-3.png 위로' }));
    expect(screen.getByText(/연결부 1 → 2: 픽셀 변화가 큽니다/)).toBeInTheDocument();
    expect(screen.getByText(/연결부 2 → 3: 픽셀 변화가 큽니다/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'sheet-3.png 제거' }));
    expect(screen.queryByText(/픽셀 변화가 큽니다/)).not.toBeInTheDocument();
    expect(screen.getByText(/연결부 1 → 2: 큰 픽셀 변화가 감지되지 않았습니다/)).toBeInTheDocument();
  });
  it('does not block generation when optional diagnostics are unavailable', async () => {
    await openWithDetails([0, null]);
    expect(screen.getByText(/연결부 1 → 2: 진단하지 못했습니다/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '영상 만들기' })).toBeEnabled();
  });
});

describe('lightweight boundary comparison', () => {
  const details = (first: number, last: number) => ({
    width: 20, height: 20,
    boundary: { first: Array(768).fill(first), last: Array(768).fill(last) },
  });
  it('compares the previous last cell with the next first cell', () => {
    expect(compareContactSheetBoundary(details(255, 0), details(0, 255))).toBe('normal');
    expect(compareContactSheetBoundary(details(0, 255), details(0, 255))).toBe('warning');
  });
  it('uses a fixed normalized absolute pixel difference threshold of 0.25', () => {
    expect(compareContactSheetBoundary(details(0, 0), details(63, 0))).toBe('normal');
    expect(compareContactSheetBoundary(details(0, 0), details(64, 0))).toBe('warning');
  });
  it('returns unavailable for missing or malformed samples', () => {
    expect(compareContactSheetBoundary(undefined, details(0, 0))).toBe('unavailable');
    for (const values of [[0], Array(768).fill(NaN), Array(768).fill(256)]) {
      expect(compareContactSheetBoundary({ width: 20, height: 20, boundary: { first: [], last: values } }, details(0, 0))).toBe('unavailable');
    }
  });
});
