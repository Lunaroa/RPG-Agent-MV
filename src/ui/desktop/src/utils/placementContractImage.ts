export interface ContractPageImage {
  characterName?: string;
  characterIndex?: number;
  tileId?: number;
  direction?: number;
  pattern?: number;
}

/** First page image from an event contract implementation (abstract or MV-shaped pages). */
export function extractContractPageImage(contract: Record<string, unknown>): ContractPageImage | null {
  const impl = contract.implementation;
  if (!impl || typeof impl !== 'object' || Array.isArray(impl)) return null;
  const pages = (impl as Record<string, unknown>).pages;
  if (!Array.isArray(pages)) return null;
  for (const page of pages) {
    if (!page || typeof page !== 'object' || Array.isArray(page)) continue;
    const image = (page as Record<string, unknown>).image;
    if (!image || typeof image !== 'object' || Array.isArray(image)) continue;
    const record = image as ContractPageImage;
    if (record.characterName || Number(record.tileId) > 0) return record;
  }
  return null;
}
