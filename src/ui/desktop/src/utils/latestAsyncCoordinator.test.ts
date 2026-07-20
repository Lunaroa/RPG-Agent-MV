import assert from 'node:assert/strict';
import test from 'node:test';
import { LatestAsyncCoordinator } from './latestAsyncCoordinator';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

test('a slower preparation cannot commit after a later selection', async () => {
  const coordinator = new LatestAsyncCoordinator<number>();
  const slow = deferred();
  const commits: number[] = [];
  const first = coordinator.begin(1);
  const firstPreparation = slow.promise.then(() => coordinator.runExclusive(first, () => { commits.push(1); }));

  const second = coordinator.begin(2);
  const secondResult = await coordinator.runExclusive(second, () => { commits.push(2); });
  slow.resolve();

  assert.equal(secondResult, 'completed');
  assert.equal(await firstPreparation, 'superseded');
  assert.deepEqual(commits, [2]);
});

test('three rapid selections only commit the final selection', async () => {
  const coordinator = new LatestAsyncCoordinator<number>();
  const commits: number[] = [];
  const first = coordinator.begin(1);
  const second = coordinator.begin(2);
  const third = coordinator.begin(3);

  const results = await Promise.all([
    coordinator.runExclusive(first, () => { commits.push(1); }),
    coordinator.runExclusive(second, () => { commits.push(2); }),
    coordinator.runExclusive(third, () => { commits.push(3); }),
  ]);

  assert.deepEqual(results, ['superseded', 'superseded', 'completed']);
  assert.deepEqual(commits, [3]);
});

test('an obsolete failure cannot publish an editor error', async () => {
  const coordinator = new LatestAsyncCoordinator<number>();
  const errors: number[] = [];
  const first = coordinator.begin(1);
  const second = coordinator.begin(2);

  if (coordinator.isCurrent(first)) errors.push(1);
  await coordinator.runExclusive(second, () => undefined);

  assert.deepEqual(errors, []);
});

test('a mode change invalidates a running preview result before it publishes', async () => {
  const coordinator = new LatestAsyncCoordinator<'preview' | 'event'>();
  const resumed = deferred();
  const published: string[] = [];
  const preview = coordinator.begin('preview');
  const resumeTask = coordinator.runExclusive(preview, async ({ isCurrent }) => {
    await resumed.promise;
    if (isCurrent()) published.push('frame');
  });

  const event = coordinator.begin('event');
  const suspendTask = coordinator.runExclusive(event, () => { published.push('suspended'); });
  resumed.resolve();

  assert.equal(await resumeTask, 'superseded');
  assert.equal(await suspendTask, 'completed');
  assert.deepEqual(published, ['suspended']);
});

test('restart work obeys the map selected while stop is pending', async () => {
  const coordinator = new LatestAsyncCoordinator<number>();
  const stopped = deferred();
  const stopStarted = deferred();
  const actions: string[] = [];
  const original = coordinator.begin(1);
  const restart = coordinator.runExclusive(original, async ({ isCurrent }) => {
    actions.push('stop');
    stopStarted.resolve();
    await stopped.promise;
    if (isCurrent()) actions.push('start:1');
  });

  await stopStarted.promise;
  const latest = coordinator.begin(2);
  const latestStart = coordinator.runExclusive(latest, () => { actions.push('start:2'); });
  stopped.resolve();

  assert.equal(await restart, 'superseded');
  assert.equal(await latestStart, 'completed');
  assert.deepEqual(actions, ['stop', 'start:2']);
});
