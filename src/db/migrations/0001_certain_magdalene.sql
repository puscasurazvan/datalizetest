-- De-duplicate existing organization_members rows before the unique index
-- below can be created. Better Auth's membership writes are check-then-insert
-- with no transaction (crud-members.mjs: findMemberByEmail then createMember),
-- so two rows for the same (organization_id, user_id) can already exist --
-- e.g. from a double-clicked or double-tabbed accept-invitation call.
-- Where duplicates exist, keep the most privileged role -- losing a role
-- upgrade is safer to recover from than silently dropping someone's owner
-- or admin row -- tie-broken by the newest created_at, then by id.
WITH ranked AS (
	SELECT
		id,
		row_number() OVER (
			PARTITION BY organization_id, user_id
			ORDER BY
				CASE role
					WHEN 'owner' THEN 1
					WHEN 'admin' THEN 2
					WHEN 'editor' THEN 3
					WHEN 'viewer' THEN 4
					ELSE 5
				END,
				created_at DESC,
				id
		) AS rn
	FROM "organization_members"
)
DELETE FROM "organization_members"
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);
--> statement-breakpoint
CREATE UNIQUE INDEX "organization_members_organization_user_idx" ON "organization_members" USING btree ("organization_id","user_id");
