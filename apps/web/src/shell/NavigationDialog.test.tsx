import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { NavigationDialog } from './NavigationDialog';

function Harness({ onClose }: { onClose: () => void }) {
  return (
    <NavigationDialog className="navigation-modal" onClose={onClose}>
      <section role="dialog" aria-label="panel">
        <button type="button">first</button>
        <input aria-label="query" />
        <button type="button">last</button>
      </section>
    </NavigationDialog>
  );
}

describe('NavigationDialog', () => {
  it('focuses the first field on open and keeps Tab and Shift+Tab inside', async () => {
    render(<Harness onClose={() => undefined} />);
    expect(screen.getByRole('textbox', { name: 'query' })).toHaveFocus();
    await userEvent.tab();
    expect(screen.getByRole('button', { name: 'last' })).toHaveFocus();
    await userEvent.tab();
    expect(screen.getByRole('button', { name: 'first' })).toHaveFocus();
    await userEvent.tab({ shift: true });
    expect(screen.getByRole('button', { name: 'last' })).toHaveFocus();
  });

  it('closes on Escape and on a press on the backdrop only', async () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('dialog', { name: 'panel' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    await userEvent.click(document.querySelector('.navigation-modal') as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('gives focus back to the element that had it before it opened', () => {
    const host = render(<button type="button">opener</button>);
    const opener = screen.getByRole('button', { name: 'opener' });
    opener.focus();
    const dialog = render(
      <NavigationDialog className="x" onClose={() => undefined}>
        <button type="button">inner</button>
      </NavigationDialog>,
    );
    expect(screen.getByRole('button', { name: 'inner' })).toHaveFocus();
    dialog.unmount();
    expect(opener).toHaveFocus();
    host.unmount();
  });
});
