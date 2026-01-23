import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/preact';
import { Tooltip } from '../components/shared/Tooltip';

describe('Tooltip Component', () => {
  describe('rendering', () => {
    it('renders children content', () => {
      const { container } = render(
        <Tooltip text="Test tooltip">
          <button>Hover me</button>
        </Tooltip>
      );

      const button = container.querySelector('button');
      expect(button).not.toBeNull();
      expect(button?.textContent).toBe('Hover me');
    });

    it('renders tooltip text', () => {
      const { container } = render(
        <Tooltip text="Explanatory text">
          <span>Label</span>
        </Tooltip>
      );

      const tooltipContent = container.querySelector('.tooltip-content');
      expect(tooltipContent).not.toBeNull();
      expect(tooltipContent?.textContent).toBe('Explanatory text');
    });
  });

  describe('positioning', () => {
    it('applies correct position data attribute with default position', () => {
      const { container } = render(
        <Tooltip text="Tooltip">
          <span>Content</span>
        </Tooltip>
      );

      const wrapper = container.querySelector('.tooltip-wrapper');
      expect(wrapper?.getAttribute('data-tooltip-position')).toBe('top');
    });

    it('applies correct position data attribute when position="bottom"', () => {
      const { container } = render(
        <Tooltip text="Tooltip" position="bottom">
          <span>Content</span>
        </Tooltip>
      );

      const wrapper = container.querySelector('.tooltip-wrapper');
      expect(wrapper?.getAttribute('data-tooltip-position')).toBe('bottom');
    });

    it('applies correct position data attribute when position="left"', () => {
      const { container } = render(
        <Tooltip text="Tooltip" position="left">
          <span>Content</span>
        </Tooltip>
      );

      const wrapper = container.querySelector('.tooltip-wrapper');
      expect(wrapper?.getAttribute('data-tooltip-position')).toBe('left');
    });

    it('applies correct position data attribute when position="right"', () => {
      const { container } = render(
        <Tooltip text="Tooltip" position="right">
          <span>Content</span>
        </Tooltip>
      );

      const wrapper = container.querySelector('.tooltip-wrapper');
      expect(wrapper?.getAttribute('data-tooltip-position')).toBe('right');
    });
  });

  describe('accessibility', () => {
    it('sets up aria-describedby relationship', () => {
      const { container } = render(
        <Tooltip text="Description of button">
          <button>Click me</button>
        </Tooltip>
      );

      const trigger = container.querySelector('.tooltip-trigger');
      const tooltipContent = container.querySelector('.tooltip-content');

      const triggerId = trigger?.getAttribute('aria-describedby');
      const contentId = tooltipContent?.getAttribute('id');

      expect(triggerId).toBeTruthy();
      expect(contentId).toBeTruthy();
      expect(triggerId).toBe(contentId);
    });

    it('assigns tooltip role to tooltip content', () => {
      const { container } = render(
        <Tooltip text="Tooltip text">
          <span>Content</span>
        </Tooltip>
      );

      const tooltipContent = container.querySelector('.tooltip-content');
      expect(tooltipContent?.getAttribute('role')).toBe('tooltip');
    });

    it('generates unique IDs for multiple tooltips', () => {
      const { container } = render(
        <>
          <Tooltip text="First tooltip">
            <span>First</span>
          </Tooltip>
          <Tooltip text="Second tooltip">
            <span>Second</span>
          </Tooltip>
        </>
      );

      const triggers = container.querySelectorAll('.tooltip-trigger');
      const contents = container.querySelectorAll('.tooltip-content');

      const firstTriggerId = triggers[0]?.getAttribute('aria-describedby');
      const secondTriggerId = triggers[1]?.getAttribute('aria-describedby');
      const firstContentId = contents[0]?.getAttribute('id');
      const secondContentId = contents[1]?.getAttribute('id');

      expect(firstTriggerId).toBe(firstContentId);
      expect(secondTriggerId).toBe(secondContentId);
      expect(firstTriggerId).not.toBe(secondTriggerId);
    });
  });

  describe('custom className', () => {
    it('applies custom className to wrapper when provided', () => {
      const { container } = render(
        <Tooltip text="Tooltip" class="custom-class">
          <span>Content</span>
        </Tooltip>
      );

      const wrapper = container.querySelector('.tooltip-wrapper');
      expect(wrapper?.classList.contains('custom-class')).toBe(true);
    });

    it('does not apply custom class when not provided', () => {
      const { container } = render(
        <Tooltip text="Tooltip">
          <span>Content</span>
        </Tooltip>
      );

      const wrapper = container.querySelector('.tooltip-wrapper');
      // Should have tooltip-wrapper class and empty string for custom class
      expect(wrapper?.className).toBe('tooltip-wrapper ');
    });

    it('applies multiple space-separated classes', () => {
      const { container } = render(
        <Tooltip text="Tooltip" class="class1 class2 class3">
          <span>Content</span>
        </Tooltip>
      );

      const wrapper = container.querySelector('.tooltip-wrapper');
      expect(wrapper?.classList.contains('class1')).toBe(true);
      expect(wrapper?.classList.contains('class2')).toBe(true);
      expect(wrapper?.classList.contains('class3')).toBe(true);
    });
  });

  describe('CSS classes', () => {
    it('renders with tooltip-wrapper class', () => {
      const { container } = render(
        <Tooltip text="Tooltip">
          <span>Content</span>
        </Tooltip>
      );

      const wrapper = container.querySelector('.tooltip-wrapper');
      expect(wrapper).not.toBeNull();
    });

    it('renders with tooltip-trigger class', () => {
      const { container } = render(
        <Tooltip text="Tooltip">
          <span>Content</span>
        </Tooltip>
      );

      const trigger = container.querySelector('.tooltip-trigger');
      expect(trigger).not.toBeNull();
    });

    it('renders with tooltip-content class', () => {
      const { container } = render(
        <Tooltip text="Tooltip">
          <span>Content</span>
        </Tooltip>
      );

      const content = container.querySelector('.tooltip-content');
      expect(content).not.toBeNull();
    });
  });

  describe('complex children', () => {
    it('supports complex child elements', () => {
      const { container } = render(
        <Tooltip text="Complex tooltip">
          <div>
            <strong>Bold text</strong> <em>italic text</em>
          </div>
        </Tooltip>
      );

      const strong = container.querySelector('strong');
      const em = container.querySelector('em');

      expect(strong).not.toBeNull();
      expect(em).not.toBeNull();
    });

    it('works with button children', () => {
      const { container } = render(
        <Tooltip text="Button tooltip" position="bottom">
          <button class="my-button">Click</button>
        </Tooltip>
      );

      const button = container.querySelector('.my-button');
      expect(button).not.toBeNull();
      expect(button?.textContent).toBe('Click');
    });
  });
});
