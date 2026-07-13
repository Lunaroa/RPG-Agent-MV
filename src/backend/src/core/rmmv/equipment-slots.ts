export const MV_DUAL_WIELD_TRAIT_CODE = 55;
export const MV_DUAL_WIELD_TRAIT_DATA_ID = 1;
export const MV_WEAPON_EQUIP_TYPE_ID = 1;

export function hasStandardDualWield(
  actor: Record<string, unknown> | null,
  classEntry: Record<string, unknown> | null,
): boolean {
  return hasStandardDualWieldTrait(actor?.traits) || hasStandardDualWieldTrait(classEntry?.traits);
}

export function hasStandardDualWieldTrait(value: unknown): boolean {
  return hasTrait(value, MV_DUAL_WIELD_TRAIT_CODE, MV_DUAL_WIELD_TRAIT_DATA_ID);
}

export function standardEquipSlotTypeIds(
  equipTypes: unknown,
  dualWield: boolean,
): number[] {
  if (!Array.isArray(equipTypes)) return [];
  const slots = Array.from({ length: Math.max(0, equipTypes.length - 1) }, (_, index) => index + 1);
  if (dualWield && slots.length >= 2) slots[1] = MV_WEAPON_EQUIP_TYPE_ID;
  return slots;
}

function hasTrait(value: unknown, code: number, dataId: number): boolean {
  return Array.isArray(value) && value.some((trait) => {
    if (!trait || typeof trait !== "object" || Array.isArray(trait)) return false;
    const record = trait as Record<string, unknown>;
    return record.code === code && record.dataId === dataId;
  });
}
