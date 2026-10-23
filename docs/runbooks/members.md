# Members, invitations and guest contractors (ADM-02, ADM-17)

Applies to ST-ADM-006 (web part) and ST-ADM-007 (`apps/api/src/modules/adm/members.controller.ts`,
`guest-contractor.controller.ts`, `contract-picker.controller.ts`, `packages/db/src/member-store.ts`,
`apps/web/src/screens/adm/MembersScreen.tsx`, `GuestContractorsScreen.tsx` and `members/`).

## What the screens do

- ADM-02 lists the memberships of the units the caller's `membership.read` grants reach. It invites a member
  (`inviteMember`: unit, optional initial role over that unit, optional end of validity), and suspends, reactivates or ends
  one (`suspendMembership`, `reactivateMembership`, `endMembership`) with a reason of at least ten characters and the
  `version` of the row as `If-Match`. A stale version is answered with a reload, never with a blind retry. No control is shown
  on the row of the signed-in user, on a row whose status does not allow the command, to a user without `iam.member.invite`
  or `iam.member.manage`, or in a suspended (READ_ONLY) tenant. The server decides every request again.
- ADM-17 lists the guest contractors (`get_resources_membership?membership_type=GUEST_CONTRACTOR`) and invites one
  (`inviteGuestContractor`, needs `iam.guest.invite` and `iam.role.grant` over the contracts; the role must be `guest_allowed`
  and held by the caller with every permission, BR-IAM-05). The contract picker reads `get_resources_contract`: the contracts
  whose owner unit lies in the scope of the caller's `contract.read` grants, in force (SIGNED, ACTIVE, SUSPENDED, COMPLETED),
  of one contractor. `valid_until` is required, in the future and at most 365 days after the latest `completion_due` of the
  chosen contracts (counted from today when none has one or the latest has passed). The screen shows the bound as a hint; the
  server answers 422 `VALIDATION_FAILED` with the field `valid_until` when it is broken.
- The guest membership belongs to the owner unit of the first contract (by id) and its CONTRACT grant ends at `valid_until`.

## Development acceptance data

An invitation mail goes through the `InvitationMailer` port; the only adapter is the in-memory MOCK one. In a development
session of the web (no sign-in status, a development build) the screen, after an invitation, asks the stack for the newest
message to the address (`GET /__dev/mailbox?email=`, a route of the end-to-end stack only; the application has none) and shows
the invitation id and the one-time token. A real sign-in (OIDC) never asks and never shows them, and the production bundle
does not contain the code (`production-bundle.test.ts`). Accepting needs an identity bound to the invited address
(`POST /memberships/invitations/{id}/accept`); that path is tested against the API (`members.test.ts`,
`guest-contractors.test.ts`), the browser flow stops at the stored invitation.

## Checks

```bash
npm test -w @machvon/web                                  # MembersScreen, GuestContractorsScreen, members logic
npm run test:lane -- db npm test -w @machvon/db -- member-store
npm run test:lane -- db npm test -w @machvon/api -- guest-contractors
npx playwright test e2e/members-flows.spec.ts             # under apps/web/e2e/.run-lock, one browser run at a time
npx playwright test e2e/visual.spec.ts -g "ADM-02|ADM-17"
```

The flows run as `owner`, `unitAdmin` and `auditor` of tenant A. The stack seeds one extra member (`lifecycleMembershipId` of
`e2e-fixtures.json`), a contractor and two contracts of unit 2 for them.

## Visual regression of ADM-02 and ADM-17: what is compared

Both mockups are the generic prototype list with four sample rows and a filter bar; the application shows the real memberships.
`e2e/visual.spec.ts` gates the shell frame (sidebar with the screen's active item, top bar with its breadcrumb) and the page
heading at the 0.001 ratio against `ADM-02.png` and `ADM-17.png`. Not compared: the heading actions (the mockup's generic
"Xuất" and "Tạo mới" are replaced by the invitation button), the filter card and the rows. The whole-page ratio is printed as
an informational annotation.
