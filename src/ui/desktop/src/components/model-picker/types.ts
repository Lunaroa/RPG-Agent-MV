export interface ModelPickerModel {
  id: string
  label: string
}

export interface ModelPickerProvider {
  id: string
  label: string
  models: ModelPickerModel[]
}

export type ModelPickerVariant = 'field' | 'chip'

export interface ModelPickerValue {
  providerId: string
  modelId: string
}
