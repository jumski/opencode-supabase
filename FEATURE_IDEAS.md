# Feature Ideas

## Ship Supabase Agent Skill via the Plugin

The [Supabase Agent Skills](https://supabase.com/blog/supabase-agent-skills) project provides an open-source skill that teaches AI coding agents how to build on Supabase correctly — covering docs access, security/RLS, tooling workflow, and schema management. Currently users must manually install it (`npx skills add supabase/agent-skills`). The plugin should make this skill available to users automatically or with minimal friction.

### Why

- Agents know *about* Supabase but often use it incorrectly (missing RLS policies, hallucinated CLI commands, insecure defaults, outdated training data)
- The Supabase Agent Skill already solves this, but requires manual installation separate from the plugin
- Plugin users who get MCP tool access still miss the *best-practice guidance* layer
- The skill and the plugin are complementary — tools give agents capability, skills give agents correctness
