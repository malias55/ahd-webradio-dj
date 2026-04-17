# Logto Auth Guide for AHD Apps

How to add Logto authentication to a new Next.js App Router project in the AHD family. All AHD apps share the same Logto tenant (`duxpom.logto.app`), which gives you **SSO for free** — a user logged into one app is automatically logged into all others without seeing the login screen again.

---

## 1. Create a Logto application

1. Open `https://duxpom.logto.app/` (Logto admin console)
2. Go to **Applications** > **Create application**
3. Choose **Traditional web** (or "Next.js")
4. Name it after your app (e.g. "AHD Inseratsapp", "AHD Preisbewertung")
5. Note down:
   - **App ID** (21 chars, e.g. `abc123def456ghi789xyz`)
   - **App Secret** (32+ chars)
6. Under **Redirect URIs**, add:
   ```
   https://your-domain.doerrschuck.de/callback
   ```
7. Under **Post sign-out redirect URIs**, add:
   ```
   https://your-domain.doerrschuck.de/
   ```
8. (Optional) Under **Backchannel logout URI**, add:
   ```
   https://your-domain.doerrschuck.de/backchannel_logout
   ```

Each app gets its own Logto application. Never reuse App ID/Secret across apps — Logto uses them for session isolation and redirect validation.

---

## 2. Install dependencies

```bash
pnpm add @logto/next jose
```

- `@logto/next` — Logto's official Next.js SDK (server actions, session handling via iron-session)
- `jose` — only needed if you implement backchannel logout (JWT verification)

---

## 3. Environment variables

Add to `.env.local` (local dev) and Railway (production):

```env
LOGTO_ENDPOINT=https://duxpom.logto.app/
LOGTO_APP_ID=<from step 1>
LOGTO_APP_SECRET=<from step 1>
LOGTO_COOKIE_SECRET=<random 32+ char string, e.g. openssl rand -base64 32>
LOGTO_BASE_URL=https://your-domain.doerrschuck.de

# Local dev only — bypasses all auth checks
SKIP_AUTH=true
```

| Variable | What it does |
|---|---|
| `LOGTO_ENDPOINT` | Logto tenant URL. Same for all AHD apps. |
| `LOGTO_APP_ID` | Identifies this app to Logto |
| `LOGTO_APP_SECRET` | Authenticates this app during token exchange |
| `LOGTO_COOKIE_SECRET` | Encrypts the session cookie (iron-session AES-GCM). Must be 32+ chars. |
| `LOGTO_BASE_URL` | Public URL of your app. Used for redirect URLs. Falls back to `RAILWAY_PUBLIC_DOMAIN` then `localhost:3000`. |
| `SKIP_AUTH` | Set to `true` in local dev only. Bypasses middleware, page auth gate, and periodic re-checks. **Never set in production.** |

---

## 4. File structure

```
app/
  logto.ts                          # Logto config (reads env vars)
  callback/route.ts                 # Handles OIDC callback after Logto redirects back
  backchannel_logout/route.ts       # (Optional) Receives logout signals from Logto
  api/auth/clear-session/route.ts   # Deletes session cookie + redirects to /
  actions/auth.ts                   # Server action: checkAuthStatus()
  page.tsx                          # Auth gate — renders login page or app
components/
  logto-login-page.tsx              # Login card UI
  logto-sign-in.tsx                 # Sign-in button (form action)
  logto-sign-out.tsx                # Sign-out button (form action)
middleware.ts                       # API route auth gate
```

---

## 5. Core files — copy and adapt

### `app/logto.ts` — Config

```ts
const getBaseUrl = () => {
  if (process.env.LOGTO_BASE_URL) return process.env.LOGTO_BASE_URL
  if (process.env.RAILWAY_PUBLIC_DOMAIN) return `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
  return 'http://localhost:3000'
}

export const logtoConfig = {
  endpoint: process.env.LOGTO_ENDPOINT || 'https://duxpom.logto.app/',
  appId: process.env.LOGTO_APP_ID || '',
  appSecret: process.env.LOGTO_APP_SECRET || '',
  baseUrl: getBaseUrl(),
  cookieSecret: process.env.LOGTO_COOKIE_SECRET || '',
  cookieSecure: process.env.NODE_ENV === 'production',
  scopes: ['email'],   // Add 'profile', 'phone', etc. if needed
}
```

### `app/callback/route.ts` — OIDC callback

```ts
import { handleSignIn } from '@logto/next/server-actions'
import { NextRequest, NextResponse } from 'next/server'
import { logtoConfig } from '../logto'

// Build redirect URLs from LOGTO_BASE_URL, not request.url — behind a proxy
// (Railway, Cloudflare, etc.) request.url resolves to the internal container
// origin (e.g. http://0.0.0.0:8080).
function publicUrl(path: string): string {
  const base = logtoConfig.baseUrl.replace(/\/$/, '')
  return `${base}${path.startsWith('/') ? path : `/${path}`}`
}

export async function GET(request: NextRequest) {
  try {
    await handleSignIn(logtoConfig, request.nextUrl.searchParams)
  } catch (error) {
    console.error('[Auth callback] handleSignIn failed:', error)
    console.error('[Auth callback] config:', {
      endpoint: logtoConfig.endpoint,
      appIdLen: logtoConfig.appId.length,
      appSecretLen: logtoConfig.appSecret.length,
      cookieSecretLen: logtoConfig.cookieSecret.length,
      baseUrl: logtoConfig.baseUrl,
    })
    return NextResponse.redirect(publicUrl('/api/auth/clear-session'))
  }
  return NextResponse.redirect(publicUrl('/'))
}
```

### `app/api/auth/clear-session/route.ts` — Session cleanup

```ts
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { logtoConfig } from '@/app/logto'

const LOGTO_COOKIE_NAME = `logto_${logtoConfig.appId}`

export async function GET() {
  const cookieStore = await cookies()  // async in Next 15+
  cookieStore.delete(LOGTO_COOKIE_NAME)

  const origin = process.env.LOGTO_BASE_URL
    || (process.env.RAILWAY_PUBLIC_DOMAIN
      ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
      : 'http://localhost:3000')
  return NextResponse.redirect(new URL('/', origin))
}
```

### `middleware.ts` — API route protection

```ts
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

const LOGTO_COOKIE_NAME = `logto_${process.env.LOGTO_APP_ID || ''}`
const PUBLIC_PATHS = ['/api/auth/', '/api/health', '/backchannel_logout']

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next()
  }
  if (process.env.SKIP_AUTH === 'true') {
    return NextResponse.next()
  }

  const sessionCookie = request.cookies.get(LOGTO_COOKIE_NAME)
  if (!sessionCookie?.value) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return NextResponse.next()
}

export const config = { matcher: ['/api/:path*'] }
```

### `app/actions/auth.ts` — Periodic auth re-check

```ts
'use server'

import { getLogtoContext } from '@logto/next/server-actions'
import { logtoConfig } from '../logto'

export async function checkAuthStatus(): Promise<{ isAuthenticated: boolean }> {
  if (process.env.SKIP_AUTH === 'true') {
    return { isAuthenticated: true }
  }
  try {
    const { isAuthenticated } = await getLogtoContext(logtoConfig)
    return { isAuthenticated }
  } catch (error) {
    console.error('[Auth Check] Error:', error)
    return { isAuthenticated: false }
  }
}
```

---

## 6. Page-level auth gate

In your root `app/page.tsx` (or any server component):

```tsx
import { getLogtoContext, signIn, signOut } from '@logto/next/server-actions'
import { redirect } from 'next/navigation'
import { logtoConfig } from './logto'

export const dynamic = 'force-dynamic'

export default async function Home() {
  // Local dev bypass
  if (process.env.SKIP_AUTH === 'true') {
    return (
      <YourApp
        userInfo={{ name: 'Dev User' }}
        onSignOut={async () => { 'use server' }}
        skipAuthCheck
      />
    )
  }

  let isAuthenticated = false
  let claims: Record<string, unknown> | undefined

  try {
    const context = await getLogtoContext(logtoConfig, { fetchUserInfo: true })
    isAuthenticated = context.isAuthenticated
    claims = context.claims
  } catch (error) {
    console.error('[Auth] Failed:', (error as Error)?.message)
    redirect('/api/auth/clear-session')
  }

  if (!isAuthenticated) {
    return (
      <LoginPage
        onSignIn={async () => {
          'use server'
          await signIn(logtoConfig)
        }}
      />
    )
  }

  return (
    <YourApp
      userInfo={{
        name: claims?.name as string,
        email: claims?.email as string,
      }}
      onSignOut={async () => {
        'use server'
        await signOut(logtoConfig)
      }}
    />
  )
}
```

---

## 7. Sign-in / sign-out buttons

Use `<form action={serverAction}>`, **not** `onClick`. In Next 15+, server actions that call `redirect()` only work reliably when triggered by a form submission — `onClick` doesn't carry the redirect back to the browser.

```tsx
// Sign-in
<form action={onSignIn}>
  <Button type="submit">Anmelden</Button>
</form>

// Sign-out
<form action={onSignOut}>
  <Button type="submit" variant="outline">Abmelden</Button>
</form>
```

---

## 8. Client-side periodic re-check

If the Logto session expires or is revoked (via backchannel logout), the user should be bounced. Add this `useEffect` in your main client component:

```ts
useEffect(() => {
  if (skipAuthCheck) return    // Don't re-check in SKIP_AUTH mode
  const check = async () => {
    try {
      const { isAuthenticated } = await checkAuthStatus()
      if (!isAuthenticated) window.location.reload()
    } catch {
      window.location.reload()
    }
  }
  check()
  const id = setInterval(check, 2 * 60 * 1000)  // every 2 minutes
  return () => clearInterval(id)
}, [skipAuthCheck])
```

Pass `skipAuthCheck={true}` from the server page when `SKIP_AUTH` is on — this prevents the server action from firing at all (avoids CSRF issues in Codespaces and unnecessary server calls).

---

## 9. Backchannel logout (optional)

Allows Logto to notify your app when a user signs out from another app in the same tenant. Without it, the session cookie remains valid until it expires (iron-session default).

See `app/backchannel_logout/route.ts` in the Preisbewertung repo for a working implementation. Key parts:

1. Receives a `logout_token` JWT via POST from Logto
2. Verifies it against Logto's JWKS (`jose.jwtVerify`)
3. Stores the revoked `sub` in an in-memory Map (auto-cleaned after 1 hour)
4. `checkAuthStatus()` checks this map before returning `isAuthenticated: true`

Register the endpoint in Logto admin > your app > **Backchannel logout URI**.

---

## 10. SSO behavior

All AHD apps share the tenant `duxpom.logto.app`. When a user is already authenticated on one app:

1. Your app redirects to Logto's `/oidc/auth`
2. Logto sees an existing session cookie on `duxpom.logto.app`
3. Logto immediately redirects back with an auth code — **no login screen shown**
4. Your callback exchanges the code for tokens and sets the session cookie

This is automatic. No code needed beyond the standard sign-in flow.

---

## 11. Troubleshooting

| Error | Cause | Fix |
|---|---|---|
| `missing required parameter 'client_id'` | `LOGTO_APP_ID` is empty | Set it in env vars |
| `invalid_client` / "client authentication failed" | `LOGTO_APP_SECRET` doesn't match the app | Copy the correct secret from Logto admin for the matching App ID |
| `redirect_uri mismatch` | Callback URL not registered in Logto | Add `https://your-domain/callback` in Logto app settings |
| 500 on `/callback` with no logs | `LOGTO_COOKIE_SECRET` too short | Must be 32+ chars. Use `openssl rand -base64 32` |
| Redirect to `0.0.0.0:8080` after login | Using `request.url` behind a proxy | Build redirects from `LOGTO_BASE_URL`, not `request.url` |
| Login button does nothing | Using `onClick` with server action | Use `<form action={serverAction}>` (see section 7) |
| Page reloads in a loop (dev) | `checkAuthStatus` server action fails via CSRF in Codespaces | Pass `skipAuthCheck` prop when `SKIP_AUTH` is on |
| Signed in on App A but App B shows login | Different Logto tenant or `LOGTO_ENDPOINT` mismatch | Ensure both apps use `https://duxpom.logto.app/` |

---

## 12. Security checklist

- [ ] `LOGTO_APP_SECRET` is set via env var only — never committed to the repo
- [ ] `LOGTO_COOKIE_SECRET` is a unique random value per app, 32+ chars
- [ ] `.env.example` has placeholder values only (empty strings or `your-...-here`)
- [ ] `SKIP_AUTH` is **not** set in any production environment
- [ ] Callback and post-logout URIs in Logto match the actual production domain exactly
- [ ] Rotate `LOGTO_APP_SECRET` immediately if it ever touches a file in the repo
