import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  PROJECT_FILE_ERROR_CODES,
  ProjectFileError,
  readProjectFileVersion,
  resolveProjectFileForRead,
  writeProjectFilesAtomically,
  writeProjectJson,
} from './project-file-service.ts';

test('project file writes create, replace, and delete files in one committed transaction', () => {
  const fixture = createFixture();
  try {
    writeProjectJson(fixture.workflowRoot, fixture.project, 'data/System.json', { title: 'Before' }, null);
    const before = readProjectFileVersion(fixture.project, 'data/System.json');
    assert.equal(before.exists, true);

    writeProjectFilesAtomically(fixture.workflowRoot, fixture.project, [
      {
        relativePath: 'data/System.json',
        content: Buffer.from('{"title":"After"}\n', 'utf8'),
        expectedSourceHash: before.sha256,
      },
      {
        relativePath: 'data/Actors.json',
        content: Buffer.from('[null]\n', 'utf8'),
        expectedSourceHash: null,
      },
    ]);

    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(fixture.project, 'data', 'System.json'), 'utf8')), {
      title: 'After',
    });
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(fixture.project, 'data', 'Actors.json'), 'utf8')), [null]);

    const actors = readProjectFileVersion(fixture.project, 'data/Actors.json');
    writeProjectFilesAtomically(fixture.workflowRoot, fixture.project, [{
      relativePath: 'data/Actors.json',
      delete: true,
      expectedSourceHash: actors.sha256,
    }]);
    assert.equal(fs.existsSync(path.join(fixture.project, 'data', 'Actors.json')), false);
    assertNoTransactionFiles(fixture.project);
  } finally {
    fixture.cleanup();
  }
});

test('project file writes reject an external edit made after the caller read the file', () => {
  const fixture = createFixture();
  try {
    const target = path.join(fixture.project, 'data', 'System.json');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, '{"title":"Opened"}\n', 'utf8');
    const opened = readProjectFileVersion(fixture.project, 'data/System.json');
    fs.writeFileSync(target, '{"title":"External"}\n', 'utf8');

    assert.throws(
      () => writeProjectFilesAtomically(fixture.workflowRoot, fixture.project, [{
        relativePath: 'data/System.json',
        content: Buffer.from('{"title":"Editor"}\n', 'utf8'),
        expectedSourceHash: opened.sha256,
      }]),
      (error: unknown) => error instanceof ProjectFileError
        && error.code === PROJECT_FILE_ERROR_CODES.conflict,
    );
    assert.equal(fs.readFileSync(target, 'utf8'), '{"title":"External"}\n');
    assertNoTransactionFiles(fixture.project);
  } finally {
    fixture.cleanup();
  }
});

test('a failed multi-file commit restores every source file and removes transaction artifacts', () => {
  const fixture = createFixture();
  try {
    const first = path.join(fixture.project, 'data', 'Actors.json');
    const second = path.join(fixture.project, 'data', 'Classes.json');
    fs.mkdirSync(path.dirname(first), { recursive: true });
    fs.writeFileSync(first, '["actors-before"]\n', 'utf8');
    fs.writeFileSync(second, '["classes-before"]\n', 'utf8');

    assert.throws(
      () => writeProjectFilesAtomically(
        fixture.workflowRoot,
        fixture.project,
        [
          { relativePath: 'data/Actors.json', content: Buffer.from('["actors-after"]\n', 'utf8') },
          { relativePath: 'data/Classes.json', content: Buffer.from('["classes-after"]\n', 'utf8') },
        ],
        {
          beforeReplace: (entry) => {
            if (entry.index === 1) throw new Error('injected replacement failure');
          },
        },
      ),
      /injected replacement failure/,
    );

    assert.equal(fs.readFileSync(first, 'utf8'), '["actors-before"]\n');
    assert.equal(fs.readFileSync(second, 'utf8'), '["classes-before"]\n');
    assertNoTransactionFiles(fixture.project);
  } finally {
    fixture.cleanup();
  }
});

test('project file paths cannot escape the project or target a symbolic link', (t) => {
  const fixture = createFixture();
  try {
    assert.throws(
      () => writeProjectFilesAtomically(fixture.workflowRoot, fixture.project, [{
        relativePath: '../outside.json',
        content: Buffer.from('{}\n', 'utf8'),
      }]),
      (error: unknown) => error instanceof ProjectFileError
        && error.code === PROJECT_FILE_ERROR_CODES.unsafePath,
    );

    const outside = path.join(fixture.root, 'outside');
    const link = path.join(fixture.project, 'linked');
    fs.mkdirSync(outside, { recursive: true });
    try {
      fs.symlinkSync(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'EPERM' || code === 'EACCES') {
        t.skip('symbolic link creation is not available in this test environment');
        return;
      }
      throw error;
    }
    assert.throws(
      () => resolveProjectFileForRead(fixture.project, 'linked/file.json'),
      (error: unknown) => error instanceof ProjectFileError
        && error.code === PROJECT_FILE_ERROR_CODES.unsafePath,
    );
  } finally {
    fixture.cleanup();
  }
});

function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rpg-agent-project-file-'));
  const workflowRoot = path.join(root, 'workspace');
  const project = path.join(root, 'project');
  fs.mkdirSync(workflowRoot, { recursive: true });
  fs.mkdirSync(project, { recursive: true });
  return {
    root,
    workflowRoot,
    project,
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

function assertNoTransactionFiles(project: string): void {
  const unexpected: string[] = [];
  const visit = (directory: string) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.name.includes('.rpg-agent-write-')) unexpected.push(absolute);
    }
  };
  visit(project);
  assert.deepEqual(unexpected, []);
}
