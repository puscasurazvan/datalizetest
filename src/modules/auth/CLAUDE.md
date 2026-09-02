# src/modules/auth

Better Auth owns identity and membership; this module owns authorization only.

## Ownership boundary (docs/decisions/06 #13-14)

- Better Auth owns `users`, `sessions`, `accounts`, `verifications`,
  `organizations`, `organization_members`, `invitations` — never build a
  second membership system alongside it.
- Datalize services own ALL resource-level authorization; Better Auth has no
  opinion on what a role may do to a dataset, query, or visualization.
- `assertCan(context, permission, resource)` is the sole authorization
  gate. Never branch on a role string (`if (role === 'admin')`) in code.

## Session trust — re-verify, never assume (docs/decisions/06 #14)

- Better Auth stores `activeOrganizationId` on the session, and its own
  endpoints let a client change it — the session value is client-influenced,
  not a trusted grant. Membership MUST be re-verified against
  `organization_members` on every request.
- A session naming an organization the user is no longer a member of is
  refused with `FORBIDDEN` and cleared — never silently switched.
- A user signing up with no organization gets a personal one and becomes
  its owner.

## Role → permission matrix (docs/decisions/06 #13)

| Permission                                       | owner | admin | editor | viewer |
| ------------------------------------------------ | ----- | ----- | ------ | ------ |
| `dataset:read`, `query:execute`                  | ✓     | ✓     | ✓      | ✓      |
| `dataset:create`, `dataset:manage`, `query:save` | ✓     | ✓     | ✓      |        |
| `organization:update`, `member:manage`           | ✓     | ✓     |        |        |
| `organization:delete`                            | ✓     |       |        |        |
