import type { UiAnimationConfig, UiDesignerDocument, UiDesignerNodeType, UiEventAction } from '@contract/ui-designer'
import { createDefaultNode, createUiDocument, findNode } from './document'

/** Stable ids for the twelve shipped node-combination templates (§17.1). */
export const UI_DESIGNER_BUILT_IN_TEMPLATES = [
  'builtin:title',
  'builtin:menu',
  'builtin:dialog',
  'builtin:scrolling-credits',
  'builtin:portrait-frame',
  'builtin:status-bars',
  'builtin:game-over',
  'builtin:save-slots',
  'builtin:hud-bars',
  'builtin:item-tooltip',
  'builtin:choice-menu',
  'builtin:logo-animation',
] as const
export type UiDesignerBuiltInTemplate = typeof UI_DESIGNER_BUILT_IN_TEMPLATES[number]

const addNode = (document: UiDesignerDocument, type: UiDesignerNodeType, options: Parameters<typeof createDefaultNode>[1] & { id: string; name: string; parentId: string | null }) => {
  const node = createDefaultNode(type, options)
  document.nodes.push(node)
  const parent = findNode(document, options.parentId ?? '')
  if (parent?.type === 'container') parent.children.push(node.id)
  else if (node.parentId === null) document.zOrder.push(node.id)
}

const setAnimation = (document: UiDesignerDocument, id: string, key: 'enterAnim' | 'exitAnim', type: UiAnimationConfig['type'], duration = 300, easing: UiAnimationConfig['easing'] = 'EaseOut') => {
  const node = document.nodes.find((candidate) => candidate.id === id)
  if (node) node[key] = { type, duration, easing }
}

const setButtonAction = (document: UiDesignerDocument, id: string, action: UiEventAction) => {
  const node = document.nodes.find((candidate) => candidate.id === id)
  if (node?.type === 'button') node.events.onClick = { actions: [action] }
}

export function isBuiltInUiDesignerTemplate(name: string): name is UiDesignerBuiltInTemplate {
  return (UI_DESIGNER_BUILT_IN_TEMPLATES as readonly string[]).includes(name)
}

export function uiDesignerBuiltInTemplateSceneName(name: UiDesignerBuiltInTemplate): string {
  return `Scene_${name.slice('builtin:'.length).split('-').map((part) => part[0].toUpperCase() + part.slice(1)).join('')}`
}

export function createBuiltInUiDesignerTemplate(name: UiDesignerBuiltInTemplate): UiDesignerDocument {
  const sceneName = uiDesignerBuiltInTemplateSceneName(name)
  const document = createUiDocument(sceneName)
  if (name === 'builtin:title') {
    addNode(document, 'text', { id: 'builtin_title_heading', name: 'TitleHeading', parentId: 'node_root', x: 208, y: 130, width: 400, height: 90 })
    const heading = document.nodes.find((node) => node.id === 'builtin_title_heading')
    if (heading?.type === 'text') heading.props.content = 'Title'
    addNode(document, 'text', { id: 'builtin_title_subtitle', name: 'Subtitle', parentId: 'node_root', x: 208, y: 225, width: 400, height: 42 })
    addNode(document, 'button', { id: 'builtin_title_start', name: 'StartButton', parentId: 'node_root', x: 308, y: 300, width: 200, height: 56 })
    setButtonAction(document, 'builtin_title_start', { type: 'newGame' })
  } else if (name === 'builtin:menu') {
    addNode(document, 'text', { id: 'builtin_menu_heading', name: 'MenuHeading', parentId: 'node_root', x: 80, y: 52, width: 656, height: 60 })
    for (const [index, label] of ['NewGame', 'Continue', 'Options', 'Exit'].entries()) {
      addNode(document, 'button', { id: `builtin_menu_${label.toLowerCase()}`, name: label, parentId: 'node_root', x: 308, y: 180 + index * 64, width: 200, height: 52 })
    }
    setButtonAction(document, 'builtin_menu_newgame', { type: 'newGame' })
    setButtonAction(document, 'builtin_menu_continue', { type: 'continue' })
    setButtonAction(document, 'builtin_menu_options', { type: 'options' })
    setButtonAction(document, 'builtin_menu_exit', { type: 'exit' })
  } else if (name === 'builtin:dialog') {
    addNode(document, 'overlay', { id: 'builtin_dialog_overlay', name: 'DialogOverlay', parentId: 'node_root', x: 0, y: 0, width: 816, height: 624 })
    addNode(document, 'nineSlice', { id: 'builtin_dialog_panel', name: 'DialogPanel', parentId: 'node_root', x: 158, y: 154, width: 500, height: 300 })
    addNode(document, 'text', { id: 'builtin_dialog_text', name: 'DialogText', parentId: 'node_root', x: 192, y: 194, width: 432, height: 120 })
    addNode(document, 'button', { id: 'builtin_dialog_confirm', name: 'ConfirmButton', parentId: 'node_root', x: 318, y: 350, width: 180, height: 52 })
    setButtonAction(document, 'builtin_dialog_confirm', { type: 'showMessage', message: '' })
  } else if (name === 'builtin:scrolling-credits') {
    addNode(document, 'text', { id: 'builtin_credits_text', name: 'CreditsText', parentId: 'node_root', x: 120, y: 640, width: 576, height: 900 })
    const credits = document.nodes.find((node) => node.id === 'builtin_credits_text')
    if (credits?.type === 'text') credits.props.content = 'Credits'
    setAnimation(document, 'builtin_credits_text', 'enterAnim', 'slideFromBottom', 900, 'EaseInOut')
  } else if (name === 'builtin:portrait-frame') {
    addNode(document, 'nineSlice', { id: 'builtin_portrait_frame', name: 'PortraitFrame', parentId: 'node_root', x: 80, y: 80, width: 220, height: 300 })
    addNode(document, 'sprite', { id: 'builtin_portrait_image', name: 'PortraitImage', parentId: 'node_root', x: 100, y: 100, width: 180, height: 260 })
  } else if (name === 'builtin:status-bars') {
    addNode(document, 'progressBar', { id: 'builtin_status_hp', name: 'HealthBar', parentId: 'node_root', x: 80, y: 80, width: 300, height: 24 })
    addNode(document, 'progressBar', { id: 'builtin_status_mp', name: 'ManaBar', parentId: 'node_root', x: 80, y: 116, width: 300, height: 24 })
    const health = document.nodes.find((node) => node.id === 'builtin_status_hp')
    const mana = document.nodes.find((node) => node.id === 'builtin_status_mp')
    if (health?.type === 'progressBar') { health.props.currentValue = 75; health.props.maxValue = 100; health.props.fillColor = '#45d483' }
    if (mana?.type === 'progressBar') { mana.props.currentValue = 40; mana.props.maxValue = 80; mana.props.fillColor = '#4b8cff' }
  } else if (name === 'builtin:game-over') {
    addNode(document, 'overlay', { id: 'builtin_gameover_overlay', name: 'GameOverOverlay', parentId: 'node_root', x: 0, y: 0, width: 816, height: 624 })
    addNode(document, 'text', { id: 'builtin_gameover_text', name: 'GameOverText', parentId: 'node_root', x: 208, y: 240, width: 400, height: 90 })
    addNode(document, 'button', { id: 'builtin_gameover_retry', name: 'RetryButton', parentId: 'node_root', x: 308, y: 370, width: 200, height: 52 })
    const gameOver = document.nodes.find((node) => node.id === 'builtin_gameover_text')
    if (gameOver?.type === 'text') gameOver.props.content = 'GAME OVER'
    setAnimation(document, 'builtin_gameover_text', 'enterAnim', 'fadeIn', 700, 'EaseOut')
    setButtonAction(document, 'builtin_gameover_retry', { type: 'newGame' })
  } else if (name === 'builtin:save-slots') {
    addNode(document, 'container', { id: 'builtin_slots_container', name: 'SaveSlots', parentId: 'node_root', x: 70, y: 80, width: 676, height: 420 })
    for (let index = 0; index < 3; index += 1) {
      // Node coordinates are absolute canvas coordinates in v10.  The
      // container origin is (70, 80), so the slot buttons must carry that
      // origin; the renderer derives their local offset when nested.
      addNode(document, 'button', { id: `builtin_slot_${index + 1}`, name: `SaveSlot${index + 1}`, parentId: 'builtin_slots_container', x: 94, y: 104 + index * 128, width: 628, height: 96 })
    }
  } else if (name === 'builtin:hud-bars') {
    addNode(document, 'text', { id: 'builtin_hud_name', name: 'ActorName', parentId: 'node_root', x: 24, y: 24, width: 180, height: 32 })
    addNode(document, 'progressBar', { id: 'builtin_hud_hp', name: 'HudHealth', parentId: 'node_root', x: 24, y: 64, width: 240, height: 20 })
    addNode(document, 'progressBar', { id: 'builtin_hud_mp', name: 'HudMana', parentId: 'node_root', x: 24, y: 94, width: 240, height: 20 })
  } else if (name === 'builtin:item-tooltip') {
    addNode(document, 'nineSlice', { id: 'builtin_item_panel', name: 'ItemPanel', parentId: 'node_root', x: 120, y: 120, width: 576, height: 260 })
    addNode(document, 'sprite', { id: 'builtin_item_icon', name: 'ItemIcon', parentId: 'node_root', x: 148, y: 150, width: 96, height: 96 })
    addNode(document, 'text', { id: 'builtin_item_name', name: 'ItemName', parentId: 'node_root', x: 270, y: 150, width: 380, height: 42 })
    addNode(document, 'text', { id: 'builtin_item_description', name: 'ItemDescription', parentId: 'node_root', x: 270, y: 202, width: 380, height: 120 })
  } else if (name === 'builtin:choice-menu') {
    addNode(document, 'text', { id: 'builtin_choice_prompt', name: 'ChoicePrompt', parentId: 'node_root', x: 100, y: 80, width: 616, height: 54 })
    for (let index = 0; index < 4; index += 1) {
      addNode(document, 'button', { id: `builtin_choice_${index + 1}`, name: `Choice${index + 1}`, parentId: 'node_root', x: 180, y: 170 + index * 60, width: 456, height: 48 })
      const choice = document.nodes.find((node) => node.id === `builtin_choice_${index + 1}`)
      if (choice?.type === 'button') choice.props.hoverTint = '#ffffff44'
    }
  } else if (name === 'builtin:logo-animation') {
    addNode(document, 'sprite', { id: 'builtin_logo_image', name: 'LogoImage', parentId: 'node_root', x: 208, y: 220, width: 400, height: 160 })
    addNode(document, 'frameAnimation', { id: 'builtin_logo_fade', name: 'LogoFade', parentId: 'node_root', x: 208, y: 220, width: 400, height: 160 })
    const logo = document.nodes.find((node) => node.id === 'builtin_logo_fade')
    if (logo?.type === 'frameAnimation') logo.props.frames = [
      { id: 'logo_frame_1', path: 'img/system/logo_01.png', duration: 250 },
      { id: 'logo_frame_2', path: 'img/system/logo_02.png', duration: 250 },
    ]
    setAnimation(document, 'builtin_logo_image', 'enterAnim', 'fadeIn', 500, 'EaseInOut')
    setAnimation(document, 'builtin_logo_image', 'exitAnim', 'fadeOut', 500, 'EaseInOut')
  }
  return document
}
