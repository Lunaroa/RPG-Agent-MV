export interface BackgroundCaptureImage {
  isEmpty(): boolean;
  getSize(): { width: number; height: number };
  toBitmap(): Buffer;
  toPNG(): Buffer;
}

export interface BackgroundCaptureWindow {
  isDestroyed(): boolean;
  isVisible(): boolean;
  isFocused(): boolean;
  webContents: {
    beginFrameSubscription(callback: (image: BackgroundCaptureImage, dirtyRect: unknown) => void): void;
    endFrameSubscription(): void;
    invalidate(): void;
  };
  capturePage: (...args: any[]) => Promise<BackgroundCaptureImage>;
}

export function assertBackgroundWindowState(win: BackgroundCaptureWindow): void {
  if (win.isDestroyed()) throw new Error('Electron background validation window is not available.');
  if (win.isVisible()) throw new Error('UI control refused to use a visible Electron window.');
  if (win.isFocused()) throw new Error('UI control refused to use a focused Electron window.');
}

export async function captureBackgroundPage(
  win: BackgroundCaptureWindow,
): Promise<{ image: BackgroundCaptureImage; png: Buffer }> {
  assertBackgroundWindowState(win);
  await waitForBackgroundFrame(win);
  assertBackgroundWindowState(win);
  const image = await win.capturePage(undefined, { stayHidden: true });
  assertBackgroundWindowState(win);
  const png = validateBackgroundCapture(image);
  return { image, png };
}

async function waitForBackgroundFrame(win: BackgroundCaptureWindow): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      win.webContents.endFrameSubscription();
      if (error) reject(error);
      else resolve();
    };
    const timeout = setTimeout(() => {
      finish(new Error('Electron background renderer did not present a frame before capture.'));
    }, 2000);
    win.webContents.beginFrameSubscription(() => finish());
    win.webContents.invalidate();
  });
}

export function validateBackgroundCapture(image: BackgroundCaptureImage): Buffer {
  if (image.isEmpty()) throw new Error('Electron background capture produced an empty image.');
  const size = image.getSize();
  if (!Number.isInteger(size.width) || !Number.isInteger(size.height) || size.width < 1 || size.height < 1) {
    throw new Error('Electron background capture produced invalid image dimensions.');
  }
  const bitmap = image.toBitmap();
  const expectedBytes = size.width * size.height * 4;
  if (bitmap.length < expectedBytes) throw new Error('Electron background capture produced an incomplete bitmap.');
  let visiblePixel = false;
  for (let alphaIndex = 3; alphaIndex < expectedBytes; alphaIndex += 4) {
    if (bitmap[alphaIndex] !== 0) {
      visiblePixel = true;
      break;
    }
  }
  if (!visiblePixel) throw new Error('Electron background capture produced a fully transparent image.');
  const png = image.toPNG();
  if (!png.length) throw new Error('Electron background capture produced an empty PNG.');
  return png;
}
