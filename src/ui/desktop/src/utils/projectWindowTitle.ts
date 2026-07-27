export const PRODUCT_WINDOW_TITLE = 'Luna RPG Agent';

export function projectWindowTitle(projectName: string | null | undefined): string {
  const normalizedName = typeof projectName === 'string' ? projectName.trim() : '';
  return normalizedName ? `${normalizedName} - ${PRODUCT_WINDOW_TITLE}` : PRODUCT_WINDOW_TITLE;
}
