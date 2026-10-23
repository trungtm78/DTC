import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { PermissionChips } from './PermissionChips';

afterEach(cleanup);

describe('PermissionChips', () => {
  it('puts a breakable space between the chips, so a long list wraps instead of widening the page', () => {
    const { container } = render(
      <p>
        <PermissionChips permissions={['capital.*', 'change.*', 'contact.*']} />
      </p>,
    );
    expect(container.querySelectorAll('code.chip')).toHaveLength(3);
    expect(container.textContent).toBe('capital.* change.* contact.*');
  });

  it('renders nothing for no permission', () => {
    const { container } = render(
      <p>
        <PermissionChips permissions={[]} />
      </p>,
    );
    expect(container.textContent).toBe('');
  });
});
