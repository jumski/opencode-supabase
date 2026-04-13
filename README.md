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

If you hit auth or tool errors and need logs for an issue, collect the newest OpenCode session log from its default log directory:

- macOS/Linux: `~/.local/share/opencode/log/`
- Windows: `%USERPROFILE%\.local\share\opencode\log`

Run OpenCode with debug logging enabled while reproducing the problem:

```bash
opencode --log-level DEBUG --print-logs
```

Then share that newest session log file in the issue. In our testing, the session log file is more reliable than redirecting `stderr` with `2>` for capturing plugin activity.

## Available today

- **Connect** your Supabase account from OpenCode
- **List** organizations and projects
- **Get** project API keys
- **Create** new Supabase projects

## Reference

- Supabase Management API: https://supabase.com/docs/reference/api/introduction
