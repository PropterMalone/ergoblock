import type { JSX } from 'preact';
import type { PeekedQuoteContent } from '../../../domains/qt-peek.js';

interface PeekedQuoteProps {
  content: PeekedQuoteContent;
}

/**
 * Renders a peeked (revealed) quoted post inline.
 * Designed to be rendered inside a Shadow DOM for style isolation.
 */
export function PeekedQuote({ content }: PeekedQuoteProps): JSX.Element {
  const date = new Date(content.createdAt);
  const dateStr = date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });

  const concealLabel =
    content.concealmentType === 'blocked'
      ? 'blocked'
      : content.concealmentType === 'detached'
        ? 'detached'
        : content.concealmentType === 'not-found'
          ? 'deleted'
          : 'hidden';

  return (
    <div>
      <style>{`
        .peek-container {
          padding: 12px 16px;
          border: 1px dashed rgba(128, 128, 128, 0.4);
          border-radius: 8px;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          font-size: 14px;
          line-height: 1.4;
          color: inherit;
          background: transparent;
          max-width: 100%;
          box-sizing: border-box;
        }
        .peek-author {
          display: flex;
          align-items: baseline;
          gap: 4px;
          margin-bottom: 4px;
          flex-wrap: wrap;
        }
        .peek-author-name {
          font-weight: 600;
          color: inherit;
        }
        .peek-author-handle {
          color: rgba(128, 128, 128, 0.8);
          font-size: 13px;
        }
        .peek-text {
          white-space: pre-wrap;
          word-break: break-word;
          color: inherit;
          margin: 4px 0;
        }
        .peek-meta {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-top: 8px;
          font-size: 12px;
          color: rgba(128, 128, 128, 0.7);
        }
        .peek-badge {
          display: inline-flex;
          align-items: center;
          gap: 3px;
          padding: 1px 6px;
          border-radius: 4px;
          background: rgba(128, 128, 128, 0.1);
          font-size: 11px;
          color: rgba(128, 128, 128, 0.7);
        }
      `}</style>
      <div class="peek-container">
        <div class="peek-author">
          <span class="peek-author-name">{content.authorDisplayName || content.authorHandle}</span>
          <span class="peek-author-handle">@{content.authorHandle}</span>
        </div>
        <div class="peek-text">{content.text}</div>
        <div class="peek-meta">
          <span>{dateStr}</span>
          <span class="peek-badge">peeked · was {concealLabel}</span>
        </div>
      </div>
    </div>
  );
}
