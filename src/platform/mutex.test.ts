import { expect, it } from 'vitest';
import { Mutex } from './utils.js';

it('hands ownership to queued work in order without allowing another caller to jump ahead', async () => {
  const mutex = new Mutex();
  const release = await mutex.acquire();
  const order: number[] = [];
  const second = mutex.runExclusive(async () => {
    expect(mutex.isLocked).toBe(true);
    order.push(2);
  });
  const third = mutex.runExclusive(async () => {
    order.push(3);
  });
  release();
  const fourth = mutex.runExclusive(async () => {
    order.push(4);
  });
  await Promise.all([second, third, fourth]);
  expect(order).toEqual([2, 3, 4]);
  expect(mutex.isLocked).toBe(false);
});
