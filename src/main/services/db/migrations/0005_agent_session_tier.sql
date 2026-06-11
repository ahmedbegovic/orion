-- Per-session model tier: the Agent/Code composers restore it on session
-- switch instead of resetting to the feature default (v2 feedback).
ALTER TABLE agent_sessions ADD COLUMN tier TEXT;
