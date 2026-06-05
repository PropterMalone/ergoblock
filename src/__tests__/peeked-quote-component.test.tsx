import { describe, it, expect } from 'vitest';
import { render } from 'preact';
import { PeekedQuote } from '../ui/components/content/PeekedQuote';
import type { PeekedQuoteContent } from '../domains/qt-peek';

describe('PeekedQuote component', () => {
  it('should render with blocked concealment type', () => {
    const container = document.createElement('div');
    const content: PeekedQuoteContent = {
      uri: 'at://did:plc:user1/app.bsky.feed.post/abc123',
      text: 'This is the quoted post text',
      authorHandle: 'user.bsky.social',
      authorDid: 'did:plc:user1',
      authorDisplayName: 'User Name',
      createdAt: '2025-02-08T12:00:00.000Z',
      concealmentType: 'blocked',
    };

    render(<PeekedQuote content={content} />, container);

    const html = container.innerHTML;
    expect(html).toContain('This is the quoted post text');
    expect(html).toContain('User Name');
    expect(html).toContain('@user.bsky.social');
    expect(html).toContain('peeked · was blocked');
  });

  it('should render with detached concealment type', () => {
    const container = document.createElement('div');
    const content: PeekedQuoteContent = {
      uri: 'at://did:plc:user2/app.bsky.feed.post/def456',
      text: 'Detached post text',
      authorHandle: 'author.bsky.social',
      authorDid: 'did:plc:user2',
      authorDisplayName: 'Author',
      createdAt: '2025-02-08T10:30:00.000Z',
      concealmentType: 'detached',
    };

    render(<PeekedQuote content={content} />, container);

    const html = container.innerHTML;
    expect(html).toContain('Detached post text');
    expect(html).toContain('peeked · was detached');
  });

  it('should render with not-found (deleted) concealment type', () => {
    const container = document.createElement('div');
    const content: PeekedQuoteContent = {
      uri: 'at://did:plc:user3/app.bsky.feed.post/ghi789',
      text: 'Deleted post text',
      authorHandle: 'author.bsky.social',
      authorDid: 'did:plc:user3',
      authorDisplayName: 'Author',
      createdAt: '2025-02-08T09:00:00.000Z',
      concealmentType: 'not-found',
    };

    render(<PeekedQuote content={content} />, container);

    const html = container.innerHTML;
    expect(html).toContain('Deleted post text');
    expect(html).toContain('peeked · was deleted');
  });

  it('should render with unknown concealment type as hidden', () => {
    const container = document.createElement('div');
    const content: PeekedQuoteContent = {
      uri: 'at://did:plc:user4/app.bsky.feed.post/jkl012',
      text: 'Hidden post text',
      authorHandle: 'author.bsky.social',
      authorDid: 'did:plc:user4',
      authorDisplayName: 'Author',
      createdAt: '2025-02-07T15:45:00.000Z',
      concealmentType: 'unknown',
    };

    render(<PeekedQuote content={content} />, container);

    const html = container.innerHTML;
    expect(html).toContain('Hidden post text');
    expect(html).toContain('peeked · was hidden');
  });

  it('should render author handle with @ symbol', () => {
    const container = document.createElement('div');
    const content: PeekedQuoteContent = {
      uri: 'at://did:plc:user5/app.bsky.feed.post/mno345',
      text: 'Test post',
      authorHandle: 'testuser.bsky.social',
      authorDid: 'did:plc:user5',
      authorDisplayName: 'Test User',
      createdAt: '2025-02-08T12:00:00.000Z',
      concealmentType: 'blocked',
    };

    render(<PeekedQuote content={content} />, container);

    const html = container.innerHTML;
    expect(html).toContain('@testuser.bsky.social');
  });

  it('should use author handle as display name when display name is empty', () => {
    const container = document.createElement('div');
    const content: PeekedQuoteContent = {
      uri: 'at://did:plc:user6/app.bsky.feed.post/pqr678',
      text: 'Test post',
      authorHandle: 'testuser.bsky.social',
      authorDid: 'did:plc:user6',
      authorDisplayName: '',
      createdAt: '2025-02-08T12:00:00.000Z',
      concealmentType: 'blocked',
    };

    render(<PeekedQuote content={content} />, container);

    const html = container.innerHTML;
    // The handle should appear once as the display name
    expect(html).toContain('testuser.bsky.social');
  });

  it('should format date correctly', () => {
    const container = document.createElement('div');
    const content: PeekedQuoteContent = {
      uri: 'at://did:plc:user7/app.bsky.feed.post/stu901',
      text: 'Test post',
      authorHandle: 'user.bsky.social',
      authorDid: 'did:plc:user7',
      authorDisplayName: 'User',
      createdAt: '2025-02-08T12:00:00.000Z',
      concealmentType: 'blocked',
    };

    render(<PeekedQuote content={content} />, container);

    const html = container.innerHTML;
    // Should contain date in format like "Feb 8, 2025" or similar locale format
    expect(html).toMatch(/Feb|02|2025/);
  });

  it('should include CSS styling', () => {
    const container = document.createElement('div');
    const content: PeekedQuoteContent = {
      uri: 'at://did:plc:user8/app.bsky.feed.post/vwx234',
      text: 'Styled post',
      authorHandle: 'user.bsky.social',
      authorDid: 'did:plc:user8',
      authorDisplayName: 'User',
      createdAt: '2025-02-08T12:00:00.000Z',
      concealmentType: 'blocked',
    };

    render(<PeekedQuote content={content} />, container);

    const html = container.innerHTML;
    // Verify style tag exists with CSS classes
    expect(html).toContain('<style>');
    expect(html).toContain('.peek-container');
    expect(html).toContain('.peek-author');
    expect(html).toContain('.peek-text');
    expect(html).toContain('.peek-meta');
    expect(html).toContain('.peek-badge');
  });

  it('should include dashed border styling', () => {
    const container = document.createElement('div');
    const content: PeekedQuoteContent = {
      uri: 'at://did:plc:user9/app.bsky.feed.post/yz567',
      text: 'Bordered post',
      authorHandle: 'user.bsky.social',
      authorDid: 'did:plc:user9',
      authorDisplayName: 'User',
      createdAt: '2025-02-08T12:00:00.000Z',
      concealmentType: 'blocked',
    };

    render(<PeekedQuote content={content} />, container);

    const html = container.innerHTML;
    expect(html).toContain('dashed');
  });

  it('should preserve whitespace in post text', () => {
    const container = document.createElement('div');
    const textWithWhitespace = 'Line 1\n\nLine 2\n  Indented line';
    const content: PeekedQuoteContent = {
      uri: 'at://did:plc:user10/app.bsky.feed.post/abc890',
      text: textWithWhitespace,
      authorHandle: 'user.bsky.social',
      authorDid: 'did:plc:user10',
      authorDisplayName: 'User',
      createdAt: '2025-02-08T12:00:00.000Z',
      concealmentType: 'blocked',
    };

    render(<PeekedQuote content={content} />, container);

    const html = container.innerHTML;
    // The text should be preserved (pre-wrap style should be applied)
    expect(html).toContain('Line 1');
    expect(html).toContain('Line 2');
    expect(html).toContain('white-space: pre-wrap');
  });
});
