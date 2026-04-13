# opencode-supabase

Supabase plugin for OpenCode.

![opencode-supabase screenshot](assets/screenshot.png)

## Get started

Requires OpenCode `>= 1.3.4`.

```bash
opencode plugin opencode-supabase
```

Launch `opencode` in your project, then run:

```
/supabase
```

Connect your account and ask your agent about Supabase capabilities.

## Debug Logging

If you hit auth or tool errors and need logs for an issue, run OpenCode like this and share `opencode-supabase-debug.log`:

```bash
opencode --log-level DEBUG --print-logs 2>opencode-supabase-debug.log
```

Without `--print-logs`, OpenCode writes logs to its default log directory, documented as `~/.local/share/opencode/log/` on macOS/Linux and `%USERPROFILE%\.local\share\opencode\log` on Windows.

## Available today

- **Connect** your Supabase account from OpenCode
- **List** organizations and projects
- **Get** project API keys
- **Create** new Supabase projects

## Reference

- Supabase Management API: https://supabase.com/docs/reference/api/introduction
