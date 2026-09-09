import assert from 'node:assert/strict';
import test from 'node:test';

const APP_TITLEBAR_HEIGHT = 38;

(globalThis as Record<string, unknown>).getComputedStyle = () => ({
  getPropertyValue: () => `${APP_TITLEBAR_HEIGHT}px`,
});
(globalThis as Record<string, unknown>).document = { documentElement: {} };

const { installEditorModalDrag } = await import('./editor-modal-drag.ts');

class FakeClassList {
  private readonly values = new Set<string>();
  add(value: string): void { this.values.add(value); }
  remove(value: string): void { this.values.delete(value); }
  contains(value: string): boolean { return this.values.has(value); }
}

class FakeElement {
  readonly tagName: string;
  readonly classList = new FakeClassList();
  readonly style: Record<string, string> = {};
  parent: FakeElement | null = null;
  private rect = { left: 100, top: 80, width: 400, height: 300 };

  constructor(tagName: string, classNames: string[] = []) {
    this.tagName = tagName.toUpperCase();
    for (const name of classNames) this.classList.add(name);
  }

  matches(selector: string): boolean {
    const cls = selector.replace('.', '');
    if (selector === 'button') return this.tagName === 'BUTTON';
    return this.classList.contains(cls);
  }

  closest(selector: string): FakeElement | null {
    if (selector.includes(',')) {
      return selector.split(',').some((part) => this.closest(part.trim())) ? this : this.parent?.closest(selector) ?? null;
    }
    if (this.matches(selector)) return this;
    return this.parent ? this.parent.closest(selector) : null;
  }

  getBoundingClientRect() {
    const marginLeft = parseFloat(this.style.marginLeft) || 0;
    const marginRight = parseFloat(this.style.marginRight) || 0;
    const marginTop = parseFloat(this.style.marginTop) || 0;
    const marginBottom = parseFloat(this.style.marginBottom) || 0;
    const transform = /translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)/.exec(this.style.transform || '');
    const translateX = transform ? Number(transform[1]) : 0;
    const translateY = transform ? Number(transform[2]) : 0;
    // A centered flex item moves by half the difference between its opposing
    // margins. Equal-and-opposite pairs therefore preserve a 1:1 visual drag.
    const left = this.rect.left + (marginLeft - marginRight) / 2 + translateX;
    const top = this.rect.top + (marginTop - marginBottom) / 2 + translateY;
    return { left, top, width: this.rect.width, height: this.rect.height, right: left + this.rect.width, bottom: top + this.rect.height };
  }

  get ownerDocument(): FakeDocument {
    return fakeDocument;
  }
}

type Listener = (event: FakePointerEvent) => void;

class FakeDocument {
  readonly defaultView = { innerWidth: 1280, innerHeight: 800 };
  private listeners = new Map<string, Listener[]>();

  addEventListener(type: string, listener: Listener): void {
    const list = this.listeners.get(type) || [];
    list.push(listener);
    this.listeners.set(type, list);
  }

  removeEventListener(type: string, listener: Listener): void {
    this.listeners.set(type, (this.listeners.get(type) || []).filter((entry) => entry !== listener));
  }

  dispatch(type: string, event: FakePointerEvent): void {
    for (const listener of this.listeners.get(type) || []) listener(event);
  }
}

interface FakePointerEvent {
  button: number;
  pointerId: number;
  clientX: number;
  clientY: number;
  target: FakeElement;
  prevented: boolean;
  preventDefault(): void;
}

const fakeDocument = new FakeDocument();

function pointerEvent(target: FakeElement, clientX: number, clientY: number, button = 0): FakePointerEvent {
  return {
    button,
    pointerId: 7,
    clientX,
    clientY,
    target,
    prevented: false,
    preventDefault() { this.prevented = true; },
  };
}

interface Harness {
  shell: FakeElement;
  header: FakeElement;
  closeButton: FakeElement;
  cleanup: () => void;
  down(target: FakeElement, x: number, y: number, button?: number): FakePointerEvent;
  move(target: FakeElement, x: number, y: number): void;
  up(target: FakeElement, x: number, y: number): void;
}

function createHarness(kind: 'editor' | 'element-plus' = 'editor'): Harness {
  const editor = kind === 'editor';
  const overlay = new FakeElement('div', [editor ? 'editor-modal-overlay' : 'el-overlay']);
  const shell = new FakeElement('section', [editor ? 'editor-modal-shell' : 'el-dialog']);
  const header = new FakeElement('header', [editor ? 'editor-modal-header' : 'el-dialog__header']);
  const title = new FakeElement('strong', ['editor-modal-title']);
  const closeButton = new FakeElement('button', ['editor-modal-close']);
  overlay.parent = null;
  shell.parent = overlay;
  header.parent = shell;
  title.parent = header;
  closeButton.parent = header;
  const cleanup = installEditorModalDrag(fakeDocument as unknown as Document);
  return {
    shell,
    header,
    closeButton,
    cleanup,
    down(target, x, y, button = 0) {
      const event = pointerEvent(target, x, y, button);
      fakeDocument.dispatch('pointerdown', event);
      return event;
    },
    move(target, x, y) {
      fakeDocument.dispatch('pointermove', pointerEvent(target, x, y));
    },
    up(target, x, y) {
      fakeDocument.dispatch('pointerup', pointerEvent(target, x, y));
    },
  };
}

test('dragging the header moves a centered shell 1:1 with the pointer', () => {
  const h = createHarness();
  try {
    const before = h.shell.getBoundingClientRect();
    const down = h.down(h.header, 300, 90);
    assert.ok(down.prevented);
    h.move(h.header, 400, 150);
    h.up(h.header, 400, 150);
    const after = h.shell.getBoundingClientRect();
    assert.equal(after.left - before.left, 100);
    assert.equal(after.top - before.top, 60);
    assert.equal(h.shell.style.marginLeft, '100px');
    assert.equal(h.shell.style.marginRight, '-100px');
    assert.equal(h.shell.style.marginTop, '60px');
    assert.equal(h.shell.style.marginBottom, '-60px');
    assert.ok(!h.shell.classList.contains('editor-modal-shell-dragging'));
  } finally {
    h.cleanup();
  }
});

test('successive drags preserve 1:1 movement in both directions', () => {
  const h = createHarness();
  try {
    const before = h.shell.getBoundingClientRect();
    h.down(h.header, 300, 90);
    h.move(h.header, 360, 130);
    h.up(h.header, 360, 130);
    const afterFirstDrag = h.shell.getBoundingClientRect();
    assert.equal(afterFirstDrag.left - before.left, 60);
    assert.equal(afterFirstDrag.top - before.top, 40);

    h.down(h.header, 360, 130);
    h.move(h.header, 335, 115);
    h.up(h.header, 335, 115);
    const afterSecondDrag = h.shell.getBoundingClientRect();
    assert.equal(afterSecondDrag.left - afterFirstDrag.left, -25);
    assert.equal(afterSecondDrag.top - afterFirstDrag.top, -15);
    assert.equal(afterSecondDrag.left - before.left, 35);
    assert.equal(afterSecondDrag.top - before.top, 25);
  } finally {
    h.cleanup();
  }
});

test('Element Plus dialogs keep their translate-based 1:1 drag', () => {
  const h = createHarness('element-plus');
  try {
    const before = h.shell.getBoundingClientRect();
    h.down(h.header, 300, 90);
    h.move(h.header, 400, 150);
    h.up(h.header, 400, 150);
    const after = h.shell.getBoundingClientRect();
    assert.equal(after.left - before.left, 100);
    assert.equal(after.top - before.top, 60);
    assert.equal(h.shell.style.transform, 'translate(100px, 60px)');
  } finally {
    h.cleanup();
  }
});

test('sub-threshold movement does not move the shell', () => {
  const h = createHarness();
  try {
    h.down(h.header, 300, 90);
    h.move(h.header, 302, 91);
    h.up(h.header, 302, 91);
    assert.equal(h.shell.style.marginLeft ?? '', '');
  } finally {
    h.cleanup();
  }
});

test('pressing the close button never starts a drag', () => {
  const h = createHarness();
  try {
    const down = h.down(h.closeButton, 470, 90);
    h.move(h.closeButton, 500, 120);
    h.up(h.closeButton, 500, 120);
    assert.equal(down.prevented, false);
    assert.equal(h.shell.style.marginLeft ?? '', '');
  } finally {
    h.cleanup();
  }
});

test('shells with their own transform drag are left alone', () => {
  const h = createHarness();
  try {
    h.shell.style.transform = 'translate(10px, 10px)';
    const down = h.down(h.header, 300, 90);
    h.move(h.header, 360, 140);
    h.up(h.header, 360, 140);
    assert.equal(down.prevented, false);
    assert.equal(h.shell.style.marginLeft ?? '', '');
  } finally {
    h.cleanup();
  }
});

test('the centered shell remains reachable at every viewport edge', () => {
  const h = createHarness();
  try {
    h.down(h.header, 300, 90);
    h.move(h.header, -4000, -4000);
    h.up(h.header, -4000, -4000);
    const topLeft = h.shell.getBoundingClientRect();
    assert.equal(topLeft.left, 48 - topLeft.width);
    assert.equal(topLeft.top, APP_TITLEBAR_HEIGHT);
  } finally {
    h.cleanup();
  }

  const h2 = createHarness();
  try {
    h2.down(h2.header, 300, 90);
    h2.move(h2.header, 4000, 4000);
    h2.up(h2.header, 4000, 4000);
    const bottomRight = h2.shell.getBoundingClientRect();
    assert.equal(bottomRight.left, fakeDocument.defaultView.innerWidth - 48);
    assert.equal(bottomRight.top, fakeDocument.defaultView.innerHeight - 48);
  } finally {
    h2.cleanup();
  }
});

test('uninstall removes the listeners', () => {
  const h = createHarness();
  h.cleanup();
  h.down(h.header, 300, 90);
  h.move(h.header, 360, 140);
  h.up(h.header, 360, 140);
  assert.equal(h.shell.style.marginLeft ?? '', '');
});
