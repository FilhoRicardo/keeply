-- RF-357: MiniMax BYO credentials are retired. The table only ever allowed provider='minimax',
-- so drop it rather than leave an empty MiniMax-only store. Apply via the normal migration path
-- (reviewable SQL); do not treat this file as a production dashboard runbook by itself.
drop table if exists public.ai_credentials;
