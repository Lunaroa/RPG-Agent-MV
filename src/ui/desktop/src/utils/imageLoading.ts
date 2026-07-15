export interface LoadableImage {
  crossOrigin: string | null;
  onload: GlobalEventHandlers['onload'];
  onerror: GlobalEventHandlers['onerror'];
  src: string;
}

export function loadImageElement(url: string): Promise<HTMLImageElement | null>;
export function loadImageElement<T extends LoadableImage>(
  url: string,
  createImage: () => T,
): Promise<T | null>;
export function loadImageElement(
  url: string,
  createImage: () => LoadableImage = () => new Image(),
): Promise<LoadableImage | null> {
  return new Promise((resolve) => {
    const image = createImage();
    if (url.startsWith('rmmv-asset://')) image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = url;
  });
}
