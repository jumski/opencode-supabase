# Supabase OAuth Broker Contract

**Goal:** Define the smallest confidential server contract that lets the public `opencode-supabase` plugin complete Supabase Management API OAuth without shipping `client_secret` or asking users to bring their own OAuth app.

**Architecture:** The plugin owns browser authorization start, public `client_id`, PKCE generation, `state` validation, the local callback server, and local token storage. The broker owns only the confidential token operations against `https://api.supabase.com/v1/oauth/token` using the Supabase OAuth App `client_secret`. The broker is deliberately stateless and implementation-agnostic; a Supabase Edge Function is a good first deployment target, but not part of the contract.

**Tech Stack:** HTTP JSON API, Supabase OAuth App, Supabase Management API, PKCE, local callback server, optional Supabase Edge Functions.

---

## Why this broker exists

Supabase's documented Management API OAuth App flow uses:

- `GET https://api.supabase.com/v1/oauth/authorize` with public parameters such as `client_id`, `redirect_uri`, `response_type=code`, `state`, and PKCE values
- `POST https://api.supabase.com/v1/oauth/token` for both code exchange and refresh
- confidential client authentication (`client_id` + `client_secret`) at token exchange time

That means a pure public desktop plugin cannot complete the documented flow on its own. Since `opencode-supabase` is public open source code, `client_secret` cannot live in the plugin repo or in shipped plugin code. A small hosted broker is therefore required if turnkey OAuth remains a goal and BYO credentials are out of scope.

## Scope and non-goals

The v1 broker is intentionally dumb:

- it exposes only `POST /exchange` and `POST /refresh`
- it stores no user access tokens or refresh tokens
- it does not own the browser redirect callback
- it does not mint sessions or login-init handshakes
- it does not proxy arbitrary Supabase Management API calls
- it does not expose a generic passthrough to `api.supabase.com`

## Trust boundaries

### Plugin responsibilities

The plugin owns:

- the public `client_id`
- building the authorize URL
- generating PKCE `code_verifier` and `code_challenge`
- generating and validating `state`
- running the local callback server
- exchanging `code` through the broker
- storing access and refresh tokens locally
- refreshing expired access tokens through the broker

### Broker responsibilities

The broker owns:

- holding the Supabase OAuth App `client_secret`
- exchanging authorization codes for tokens
- refreshing access tokens using refresh tokens
- applying narrow validation and abuse controls before calling Supabase

### Supabase responsibilities

Supabase remains:

- the OAuth authorization server for the authorize step
- the token issuer for exchange and refresh
- the Management API authority for tool calls made with returned access tokens

## End-to-end flow

### Initial login

1. The plugin generates `state`, PKCE `code_verifier`, and `code_challenge`.
2. The plugin starts a local callback listener such as `http://localhost:<port>/auth/callback`.
3. The plugin opens the browser to `https://api.supabase.com/v1/oauth/authorize` with:
   - `client_id`
   - `redirect_uri`
   - `response_type=code`
   - `state`
   - `code_challenge`
   - `code_challenge_method=S256`
4. Supabase redirects to the local plugin callback with `code` and `state`.
5. The plugin validates `state` and calls broker `POST /exchange` with:
   - `code`
   - `code_verifier`
   - `redirect_uri`
6. The broker calls Supabase `POST /v1/oauth/token` using confidential client auth.
7. The broker returns token payload JSON to the plugin.
8. The plugin stores the returned `access_token`, `refresh_token`, and expiry locally.

### Refresh

1. The plugin detects an expired or nearly expired access token.
2. The plugin calls broker `POST /refresh` with `refresh_token`.
3. The broker calls Supabase `POST /v1/oauth/token` with the refresh grant using confidential client auth.
4. The broker returns the refreshed token payload JSON to the plugin.
5. The plugin overwrites local token storage.

## Endpoint contract

### `POST /exchange`

Purpose: exchange a Supabase authorization code for an access token and refresh token.

Request JSON:

```json
{
  "code": "string",
  "code_verifier": "string",
  "redirect_uri": "http://localhost:14589/auth/callback"
}
```

Required validation:

- `code` must be a non-empty string
- `code_verifier` must be a non-empty string
- `redirect_uri` must be a non-empty string
- `redirect_uri` must match an allowlisted local callback pattern owned by the plugin
- reject unknown top-level fields if strict request validation is enabled

Broker behavior:

1. Validate request shape.
2. Validate `redirect_uri` against an allowlist such as loopback-only callback URLs.
3. Send `POST https://api.supabase.com/v1/oauth/token` with content type `application/x-www-form-urlencoded`.
4. Use form values:
   - `grant_type=authorization_code`
   - `code=<code>`
   - `redirect_uri=<redirect_uri>`
   - `code_verifier=<code_verifier>`
5. Authenticate to Supabase with Basic auth using server-held `client_id:client_secret`.
6. Return only normalized JSON to the plugin.

Success response JSON:

```json
{
  "access_token": "string",
  "refresh_token": "string",
  "expires_in": 3600,
  "token_type": "bearer"
}
```

### `POST /refresh`

Purpose: refresh an expired or expiring Supabase access token.

Request JSON:

```json
{
  "refresh_token": "string"
}
```

Required validation:

- `refresh_token` must be a non-empty string
- reject unknown top-level fields if strict request validation is enabled

Broker behavior:

1. Validate request shape.
2. Send `POST https://api.supabase.com/v1/oauth/token` with content type `application/x-www-form-urlencoded`.
3. Use form values:
   - `grant_type=refresh_token`
   - `refresh_token=<refresh_token>`
4. Authenticate to Supabase with Basic auth using server-held `client_id:client_secret`.
5. Return only normalized JSON to the plugin.

Success response JSON:

```json
{
  "access_token": "string",
  "refresh_token": "string",
  "expires_in": 3600,
  "token_type": "bearer"
}
```

## Error contract

Both endpoints should return structured JSON errors:

```json
{
  "error": {
    "code": "invalid_request",
    "message": "redirect_uri must use the local plugin callback pattern"
  }
}
```

Recommended error code set:

- `invalid_request` for missing or malformed input
- `unauthorized` for rejected or revoked refresh/token flows
- `upstream_error` for non-auth Supabase failures or malformed upstream responses
- `rate_limited` if broker throttling applies

Recommended status mapping:

- `400` for invalid request
- `401` for upstream auth rejection
- `429` for rate limiting
- `502` for upstream transport or malformed upstream response problems

The broker should never return raw HTML or opaque passthrough responses to the plugin.

## Required security properties

- Keep `client_secret` server-side only.
- Require PKCE on `/exchange` by requiring `code_verifier`.
- Allow only `authorization_code` and `refresh_token` flows.
- Validate `redirect_uri` against a narrow allowlist.
- Rate limit `POST /exchange` and `POST /refresh`.
- Avoid logging sensitive values such as `code`, `code_verifier`, access tokens, and refresh tokens.
- Do not persist user tokens, auth codes, or PKCE material.
- Do not expose generic upstream passthrough behavior.

## Suggested redirect URI policy

The broker should accept only local plugin callback URLs. Recommended patterns:

- `http://localhost:<port>/auth/callback`
- optionally `http://localhost:<port>/auth/callback` if the plugin intentionally supports it

The broker should reject:

- non-loopback hosts
- HTTPS hosts it does not control
- arbitrary custom paths
- callback URLs that do not match the plugin contract

## Suggested implementation as a Supabase Edge Function

This contract can be implemented as one or two Supabase Edge Function routes. Suggested deployment characteristics:

- store `client_id` and `client_secret` in Edge Function secrets
- do not require a database for v1
- use the Edge Function only for `/exchange` and `/refresh`
- call `https://api.supabase.com/v1/oauth/token` directly from the function

Important: Supabase Edge Functions are a deployment option, not a protocol requirement. The plugin must depend only on the HTTP contract above.

## Plugin-side implications

The plugin plan should assume:

- direct token exchange against Supabase from the plugin is no longer valid
- direct refresh against Supabase from the plugin is no longer valid
- a broker client helper should replace local confidential token logic
- plugin-owned auth persistence remains required because tool handlers still need local access to tokens
- host auth should still be synchronized when the plugin receives or refreshes valid tokens

## Future hardening intentionally deferred

These are explicitly out of scope for v1:

- broker-issued login-init handshake
- broker-owned auth sessions
- broker-side refresh-token storage
- broker-side revoke endpoint
- broker-side Management API proxying

If abuse patterns or redirect spoofing concerns later justify extra hardening, a signed login-init token carried inside plugin `state` is the next reasonable step. It is not required for the initial broker rollout.
