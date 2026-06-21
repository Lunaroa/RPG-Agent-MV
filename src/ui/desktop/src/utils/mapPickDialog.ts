import { h, ref } from 'vue'
import { ElMessageBox, ElOption, ElSelect } from 'element-plus'
import type { ProductLanguage } from '@contract/types'
import { mapPickText } from './mapPickDialogLocalization'

export interface MapPickOption {
  id: number
  name: string
}

/** Opens a lightweight map picker when multiple maps are available; a single map returns directly. */
export async function promptMapSelection(maps: MapPickOption[], language?: ProductLanguage): Promise<number | null> {
  if (!maps.length) return null
  if (maps.length === 1) return maps[0].id

  const selected = ref(maps[0].id)
  try {
    await ElMessageBox({
      title: mapPickText(language, 'title'),
      message: () => h(
        ElSelect,
        {
          modelValue: selected.value,
          'onUpdate:modelValue': (value: number) => { selected.value = value },
          style: 'width: 100%',
          placeholder: mapPickText(language, 'placeholder'),
        },
        () => maps.map((map) => h(ElOption, {
          key: map.id,
          label: `${map.name || mapPickText(language, 'unnamed')} (#${map.id})`,
          value: map.id,
        })),
      ),
      showCancelButton: true,
      confirmButtonText: mapPickText(language, 'confirm'),
      cancelButtonText: mapPickText(language, 'cancel'),
    })
    return selected.value
  } catch {
    return null
  }
}
