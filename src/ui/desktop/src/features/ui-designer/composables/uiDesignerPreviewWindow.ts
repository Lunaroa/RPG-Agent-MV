export const UI_DESIGNER_PREVIEW_WINDOW_NAME = 'rpg-agent-ui-designer-preview'
const UI_DESIGNER_PREVIEW_RELAY_CHANNEL = 'rpg-agent-ui-designer-preview-relay'
const UI_DESIGNER_PREVIEW_FRAME_ID = 'rpg-agent-ui-designer-preview-frame'

export interface UiDesignerPreviewWindowOptions {
  url: string
  title: string
  width: number
  height: number
  label: string
  onLoad: () => void
  onError: () => void
  onMessage: (event: MessageEvent) => void
  onClosed: () => void
}

export interface UiDesignerPreviewWindowHandle {
  readonly frame: HTMLIFrameElement
  readonly window: Window
  postMessage(message: unknown): boolean
  update(options: Pick<UiDesignerPreviewWindowOptions, 'url' | 'title' | 'width' | 'height' | 'label'>): void
  close(): void
}

export function uiDesignerPreviewWindowSize(
  sceneWidth: number,
  sceneHeight: number,
  availableWidth: number,
  availableHeight: number,
): { width: number; height: number } {
  const width = Math.max(1, Math.round(sceneWidth))
  const height = Math.max(1, Math.round(sceneHeight))
  return {
    width: Math.max(320, Math.min(width, Math.max(320, Math.round(availableWidth) - 48))),
    height: Math.max(240, Math.min(height, Math.max(240, Math.round(availableHeight) - 72))),
  }
}

export function openUiDesignerPreviewWindow(options: UiDesignerPreviewWindowOptions): UiDesignerPreviewWindowHandle {
  const size = uiDesignerPreviewWindowSize(options.width, options.height, window.screen.availWidth, window.screen.availHeight)
  const preview = window.open('about:blank', UI_DESIGNER_PREVIEW_WINDOW_NAME, `popup=yes,width=${size.width},height=${size.height}`)
  if (!preview) throw new Error('The editor preview window could not be opened.')

  const document = preview.document
  document.title = options.title
  document.documentElement.style.cssText = 'margin:0;min-width:100%;min-height:100%;overflow:auto;background:#090a0d;'
  document.body.replaceChildren()
  document.body.style.cssText = 'margin:0;width:max-content;min-width:100%;height:max-content;min-height:100%;overflow:visible;background:#090a0d;'
  const frame = document.createElement('iframe')
  const relayToken = crypto.randomUUID()
  frame.id = UI_DESIGNER_PREVIEW_FRAME_ID
  frame.title = options.label
  frame.setAttribute('sandbox', 'allow-scripts allow-same-origin')
  frame.style.cssText = 'display:block;border:0;background:transparent;'
  frame.style.width = `${Math.max(1, Math.round(options.width))}px`
  frame.style.height = `${Math.max(1, Math.round(options.height))}px`
  frame.src = options.url
  frame.addEventListener('load', options.onLoad)
  frame.addEventListener('error', options.onError)
  document.body.appendChild(frame)
  const relayScript = document.createElement('script')
  relayScript.textContent = `(() => {
    const channel = ${JSON.stringify(UI_DESIGNER_PREVIEW_RELAY_CHANNEL)};
    const token = ${JSON.stringify(relayToken)};
    window.addEventListener('message', (event) => {
      const envelope = event.data;
      if (event.source !== window.opener || !envelope || envelope.channel !== channel || envelope.token !== token) return;
      const target = document.getElementById(${JSON.stringify(UI_DESIGNER_PREVIEW_FRAME_ID)});
      if (target && target.contentWindow) target.contentWindow.postMessage(envelope.message, '*');
    });
  })();`
  document.head.appendChild(relayScript)
  relayScript.remove()
  preview.addEventListener('message', options.onMessage)

  let closed = false
  const notifyClosed = () => {
    if (closed) return
    closed = true
    options.onClosed()
  }
  preview.addEventListener('beforeunload', notifyClosed, { once: true })

  const update = (next: Pick<UiDesignerPreviewWindowOptions, 'url' | 'title' | 'width' | 'height' | 'label'>) => {
    if (preview.closed) return
    preview.document.title = next.title
    frame.title = next.label
    frame.style.width = `${Math.max(1, Math.round(next.width))}px`
    frame.style.height = `${Math.max(1, Math.round(next.height))}px`
    if (frame.src !== next.url) frame.src = next.url
  }
  preview.focus()

  return {
    frame,
    window: preview,
    postMessage(message) {
      if (closed || preview.closed) return false
      preview.postMessage({ channel: UI_DESIGNER_PREVIEW_RELAY_CHANNEL, token: relayToken, message }, '*')
      return true
    },
    update,
    close() {
      if (closed) return
      closed = true
      preview.removeEventListener('message', options.onMessage)
      frame.removeEventListener('load', options.onLoad)
      frame.removeEventListener('error', options.onError)
      if (!preview.closed) preview.close()
    },
  }
}
