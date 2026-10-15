// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { TabNav } from './TabNav.js';
import { currentTab } from '../../signals/manager.js';

afterEach(cleanup);
beforeEach(() => {
  currentTab.value = 'actions';
});

describe('manager navigation', () => {
  it('shows three primary tabs and keeps advanced tools collapsed', () => {
    const { container } = render(<TabNav />);
    expect(screen.getByRole('button', { name: 'Blocks & Mutes' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Post actions' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Settings' })).toBeTruthy();
    const advanced = container.querySelector('details');
    expect(advanced).toBeTruthy();
    expect(advanced?.open).toBe(false);
    expect(advanced?.textContent).toContain('Mass Ops');
    expect(advanced?.textContent).toContain('Copy User');
    for (const label of ['Amnesty', 'Blocklist Audit', 'Review Queue', 'Repost Filters']) {
      expect(screen.queryByText(label)).toBeNull();
    }
  });

  it('returns to Blocks & Mutes when Advanced is collapsed', () => {
    const { container } = render(<TabNav />);
    const advanced = container.querySelector('details')!;
    advanced.open = true;
    fireEvent.click(screen.getByRole('button', { name: 'Copy User' }));
    advanced.open = false;
    fireEvent(advanced, new Event('toggle'));
    expect(currentTab.value).toBe('actions');
  });

  it('allows returning from advanced tools to a primary tab', () => {
    const { container } = render(<TabNav />);
    const advanced = container.querySelector('details')!;
    advanced.open = true;
    fireEvent.click(screen.getByRole('button', { name: 'Mass Ops' }));
    expect(currentTab.value).toBe('mass-ops');
    fireEvent.click(screen.getByRole('button', { name: 'Post actions' }));
    expect(currentTab.value).toBe('quote-sweep');
    expect(advanced.open).toBe(false);
  });
});
