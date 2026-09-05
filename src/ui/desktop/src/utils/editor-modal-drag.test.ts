import assert from 'node:assert/strict';
import test from 'node:test';

(globalThis as Record<string, unknown>).getComputedStyle = () => ({
  getPropertyValue: () => '0px',
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
    const left = this.rect.left;
    const top = this.rect.top;
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

function createHarness(): Harness {
  const overlay = new FakeElement('div', ['editor-modal-overlay']);
  const shell = new FakeElement('section', ['editor-modal-shell']);
  const header = new FakeElement('header', ['editor-modal-header']);
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

test('dragging the header offsets the shell via margins', () => {
  const h = createHarness();
  try {
    const down = h.down(h.header, 300, 90);
    assert.ok(down.prevented);
    h.move(h.header, 340, 120);
    h.up(h.header, 340, 120);
    assert.equal(h.shell.style.marginLeft, '40px');
    assert.equal(h.shell.style.marginTop, '30px');
    assert.ok(!h.shell.classList.contains('editor-modal-shell-dragging'));
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

test('the shell cannot be dragged above the app titlebar', () => {
  const h = createHarness();
  try {
    h.down(h.header, 300, 90);
    h.move(h.header, 300, -4000);
    h.up(h.header, 300, -4000);
    const top = 80 + (parseFloat(h.shell.style.marginTop) || 0);
    assert.ok(top >= 0, `shell top ${top} must stay inside the viewport`);
  } finally {
    h.cleanup();
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
