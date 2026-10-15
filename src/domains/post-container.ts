/** Find the containing post for menu targeting and QT Peek. */
export function findPostContainer(element: HTMLElement | null): HTMLElement | null {
  if (!element) return null;
  for (const selector of [
    '[data-testid*="feedItem"]',
    '[data-testid*="postThreadItem"]',
    '[data-testid*="notification"]',
    'article',
    '[data-testid*="post"]',
  ]) {
    const container = element.closest<HTMLElement>(selector);
    if (container) return container;
  }
  return null;
}
