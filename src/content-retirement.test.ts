import { describe, expect, it } from 'vitest';
import source from './content.tsx?raw';
describe('content feature wiring', () => {
  it('keeps temporary actions, delayed blocking, QT Peek and post actions wired', () => {
    for (const retained of [
      'CREATE_TEMP_ACTION',
      'SCHEDULE_DELAYED_BLOCK',
      'injectPeekOption(menu)',
      'injectSweepQuotesOption(menu)',
    ])
      expect(source).toContain(retained);
  });
  it('contains no repost-filter or automatic-context capture entry points', () => {
    for (const removed of [
      'initFeedFilter',
      'injectRepostFilterOption',
      'buildPostContext',
      'capturePostContext',
      'currentEngagementContext',
      'capturedNotificationInfo',
    ])
      expect(source).not.toContain(removed);
  });
});
