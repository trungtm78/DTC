import { Fragment } from 'react';

/** The permission patterns of a grant or a delegation, one chip each; a space between chips lets a long list break over lines instead of widening the page. */
export function PermissionChips({ permissions }: { permissions: readonly string[] }) {
  return (
    <>
      {permissions.map((permission, index) => (
        <Fragment key={permission}>
          {index === 0 ? null : ' '}
          <code className="chip">{permission}</code>
        </Fragment>
      ))}
    </>
  );
}
