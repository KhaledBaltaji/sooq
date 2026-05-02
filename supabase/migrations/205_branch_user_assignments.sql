-- ============================================================
-- 205: S2 Branch System — branch_user_assignments
--
-- Links users to branches. A user can be assigned to one branch.
-- agent_id is nullable (not all branch users come through an agent).
-- ============================================================

CREATE TABLE branch_user_assignments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id),
  branch_id   UUID NOT NULL REFERENCES branches(id),
  agent_id    UUID REFERENCES branch_agents(id),
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT branch_user_unique UNIQUE (user_id, branch_id)
);

CREATE INDEX idx_branch_user_assignments_user ON branch_user_assignments(user_id);
CREATE INDEX idx_branch_user_assignments_branch ON branch_user_assignments(branch_id);
CREATE INDEX idx_branch_user_assignments_agent ON branch_user_assignments(agent_id);
