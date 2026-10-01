import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
      sheets,
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
        sheets,
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
