import { ElMessageBox, type ElMessageBoxOptions } from 'element-plus';
import { LAYER_Z } from '../constants/layerZIndex';

type ConfirmAboveModalOptions = ElMessageBoxOptions & { zIndex?: number };

export function confirmAboveModal(
  message: string,
  title: string,
  options?: ConfirmAboveModalOptions,
) {
  return ElMessageBox.confirm(message, title, {
    type: 'warning',
    zIndex: LAYER_Z.messageBox,
    ...options,
  } as ElMessageBoxOptions);
}
