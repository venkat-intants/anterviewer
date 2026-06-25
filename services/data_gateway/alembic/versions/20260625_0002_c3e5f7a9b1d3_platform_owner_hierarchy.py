"""platform_owner hierarchy (three-tier admin model)

Introduces the platform-owner tier above the (now company-scoped) super-admin:

    platform_owner   — the Intants core ("super super admin").
                       support@intants.com. company_id IS NULL. Creates &
                       manages companies and creates ONE super_admin per company.
    super_admin      — RE-SCOPED to a single company ("company super admin").
                       company_id IS NOT NULL. Created by a platform_owner;
                       creates HR managers for ITS OWN company only.
    hr_manager       — unchanged; runs the ATS / exam / interview workflow.

Changes:
  - Seed role 'platform_owner'.
  - Create/ensure support@intants.com as a platform_owner (default pw 12345678,
    NOT forced to change — it is the bootstrap owner credential).
  - Migrate every EXISTING platform-level super_admin (company_id IS NULL) to
    'platform_owner' and strip their now-misscoped 'super_admin' role. This
    covers admin@intants.com and any seeded platform super-admin.
  - Refresh role descriptions to match the new hierarchy.

Revision ID: c3e5f7a9b1d3
Revises:     b2d4f6a8c0e2
Create Date: 2026-06-25 00:02:00.000000
"""

from collections.abc import Sequence

import bcrypt
import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c3e5f7a9b1d3"
down_revision: str | None = "b2d4f6a8c0e2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Bootstrap platform-owner credential (see CLAUDE.md product spec).
_PLATFORM_OWNER_EMAIL = "support@intants.com"
_PLATFORM_OWNER_PASSWORD = "12345678"  # noqa: S105 — bootstrap default, owner-chosen


def upgrade() -> None:
    # --- 1. seed the new top-tier role + refresh descriptions ---
    op.execute(
        sa.text(
            "INSERT INTO roles (name, description) VALUES "
            "('platform_owner', 'Platform core — manages companies and their super admins') "
            "ON CONFLICT (name) DO NOTHING"
        )
    )
    op.execute(
        sa.text(
            "UPDATE roles SET description = "
            "'Company super admin — manages HR managers for one company' "
            "WHERE name = 'super_admin'"
        )
    )

    # --- 2. create/ensure the platform owner (support@intants.com) ---
    pw_hash = bcrypt.hashpw(
        _PLATFORM_OWNER_PASSWORD.encode(), bcrypt.gensalt(rounds=12)
    ).decode()
    op.execute(
        sa.text(
            "INSERT INTO users "
            "(id, email, password_hash, full_name, preferred_language, is_active, "
            " must_change_password, company_id, created_at, updated_at) "
            "VALUES (gen_random_uuid(), :email, :pw, 'Intants Platform Owner', 'en', "
            " true, false, NULL, now(), now()) "
            "ON CONFLICT (email) DO UPDATE SET "
            " password_hash = EXCLUDED.password_hash, "
            " full_name = EXCLUDED.full_name, "
            " is_active = true, must_change_password = false, company_id = NULL, "
            " deleted_at = NULL, updated_at = now()"
        ).bindparams(email=_PLATFORM_OWNER_EMAIL, pw=pw_hash)
    )
    # Grant platform_owner AND the existing 'admin' analytics role, so the core
    # owner is a "complete" super-super-admin (governance + platform analytics).
    op.execute(
        sa.text(
            "INSERT INTO user_roles (user_id, role_id, assigned_at) "
            "SELECT u.id, r.id, now() FROM users u CROSS JOIN roles r "
            "WHERE u.email = :email AND r.name IN ('platform_owner', 'admin') "
            "ON CONFLICT (user_id, role_id) DO NOTHING"
        ).bindparams(email=_PLATFORM_OWNER_EMAIL)
    )

    # --- 3. migrate existing platform-level super_admins -> platform_owner ---
    # Previously super_admin WAS the platform owner. Now super_admin is
    # company-scoped, so any super_admin without a company is a platform owner.
    op.execute(
        sa.text(
            "INSERT INTO user_roles (user_id, role_id, assigned_at) "
            "SELECT u.id, pr.id, now() "
            "FROM users u "
            "JOIN user_roles ur ON ur.user_id = u.id "
            "JOIN roles sr ON sr.id = ur.role_id AND sr.name = 'super_admin' "
            "CROSS JOIN roles pr "
            "WHERE pr.name = 'platform_owner' AND u.company_id IS NULL "
            "ON CONFLICT (user_id, role_id) DO NOTHING"
        )
    )
    # Strip the now-misscoped super_admin role from those promoted users.
    op.execute(
        sa.text(
            "DELETE FROM user_roles ur "
            "USING roles sr, users u "
            "WHERE ur.role_id = sr.id AND sr.name = 'super_admin' "
            "AND ur.user_id = u.id AND u.company_id IS NULL"
        )
    )


def downgrade() -> None:
    # Reverse: demote platform-level platform_owners back to super_admin.
    op.execute(
        sa.text(
            "INSERT INTO user_roles (user_id, role_id, assigned_at) "
            "SELECT u.id, sr.id, now() "
            "FROM users u "
            "JOIN user_roles ur ON ur.user_id = u.id "
            "JOIN roles pr ON pr.id = ur.role_id AND pr.name = 'platform_owner' "
            "CROSS JOIN roles sr "
            "WHERE sr.name = 'super_admin' AND u.company_id IS NULL "
            "AND u.email <> :email "
            "ON CONFLICT (user_id, role_id) DO NOTHING"
        ).bindparams(email=_PLATFORM_OWNER_EMAIL)
    )
    # Revoke the 'admin' grant this migration added to the platform owner
    # (symmetric reversal — the upgrade granted both platform_owner and admin).
    op.execute(
        sa.text(
            "DELETE FROM user_roles ur USING users u, roles r "
            "WHERE ur.user_id = u.id AND ur.role_id = r.id "
            "AND u.email = :email AND r.name = 'admin'"
        ).bindparams(email=_PLATFORM_OWNER_EMAIL)
    )
    # Remove platform_owner role assignments and the role itself.
    op.execute(
        sa.text(
            "DELETE FROM user_roles WHERE role_id IN "
            "(SELECT id FROM roles WHERE name = 'platform_owner')"
        )
    )
    op.execute(
        sa.text(
            "UPDATE roles SET description = "
            "'Platform owner — manages companies and HR managers' "
            "WHERE name = 'super_admin'"
        )
    )
    op.execute(sa.text("DELETE FROM roles WHERE name = 'platform_owner'"))
    # NOTE: the support@intants.com user row is intentionally left in place on
    # downgrade (removing a login on a schema rollback is more surprising than
    # leaving it). Both role grants this migration added (platform_owner + admin)
    # are revoked above, so no privilege residue remains.
