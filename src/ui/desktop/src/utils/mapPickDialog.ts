import { h, ref } from 'vue'
import { ElMessageBox, ElOption, ElSelect } from 'element-plus'

export interface MapPickOption {
  id: number
  name: string
}

/** 多张地图时弹出轻量选择框；仅一张则直接返回 */
export async function promptMapSelection(maps: MapPickOption[]): Promise<number | null> {
  if (!maps.length) return null
  if (maps.length === 1) return maps[0].id

  const selected = ref(maps[0].id)
  try {
    await ElMessageBox({
      title: '选择目标地图',
      message: () => h(
        ElSelect,
        {
          modelValue: selected.value,
          'onUpdate:modelValue': (value: number) => { selected.value = value },
          style: 'width: 100%',
          placeholder: '选择地图',
        },
        () => maps.map((map) => h(ElOption, {
          key: map.id,
          label: `${map.name || '未命名'} (#${map.id})`,
          value: map.id,
        })),
      ),
      showCancelButton: true,
      confirmButtonText: '进入编排',
      cancelButtonText: '取消',
    })
    return selected.value
  } catch {
    return null
  }
}
