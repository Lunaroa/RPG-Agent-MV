export function rotateHuePixelsLikeMv(pixels: Uint8ClampedArray, offset: number): void {
  const normalizedOffset = ((offset % 360) + 360) % 360;
  if (!normalizedOffset) return;
  for (let index = 0; index < pixels.length; index += 4) {
    const [hue, saturation, lightness] = rgbToHsl(pixels[index], pixels[index + 1], pixels[index + 2]);
    const [red, green, blue] = hslToRgb((hue + normalizedOffset) % 360, saturation, lightness);
    pixels[index] = red;
    pixels[index + 1] = green;
    pixels[index + 2] = blue;
  }
}

function rgbToHsl(red: number, green: number, blue: number): [number, number, number] {
  const minimum = Math.min(red, green, blue);
  const maximum = Math.max(red, green, blue);
  let hue = 0;
  let saturation = 0;
  const lightness = (minimum + maximum) / 2;
  const delta = maximum - minimum;
  if (delta > 0) {
    if (red === maximum) hue = 60 * (((green - blue) / delta + 6) % 6);
    else if (green === maximum) hue = 60 * ((blue - red) / delta + 2);
    else hue = 60 * ((red - green) / delta + 4);
    saturation = delta / (255 - Math.abs(2 * lightness - 255));
  }
  return [hue, saturation, lightness];
}

function hslToRgb(hue: number, saturation: number, lightness: number): [number, number, number] {
  const chroma = (255 - Math.abs(2 * lightness - 255)) * saturation;
  const x = chroma * (1 - Math.abs((hue / 60) % 2 - 1));
  const m = lightness - chroma / 2;
  const c = chroma + m;
  const xm = x + m;
  if (hue < 60) return [c, xm, m];
  if (hue < 120) return [xm, c, m];
  if (hue < 180) return [m, c, xm];
  if (hue < 240) return [m, xm, c];
  if (hue < 300) return [xm, m, c];
  return [c, m, xm];
}
