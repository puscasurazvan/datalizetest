# Datalize Social Sign-In — Google and GitHub

Datalize supports Google and GitHub sign-in alongside email and password. The target user is an
ops/finance analyst at a small SaaS company; they already have a Google Workspace account, and the
people evaluating the product have GitHub. Making them invent another password is friction at exactly
the moment we are trying to get them to their first chart.

Email and password stays. Not every pilot user can use a social provider, and removing it would make
the sign-up flow depend on a third party during a demo.

---

## Configuration

Better Auth's `socialProviders` handles both. The `accounts` table already exists in the schema.

```ts
socialProviders: {
  google: {
    clientId: env().GOOGLE_CLIENT_ID,
    clientSecret: env().GOOGLE_CLIENT_SECRET,
  },
  github: {
    clientId: env().GITHUB_CLIENT_ID,
    clientSecret: env().GITHUB_CLIENT_SECRET,
  },
}
```

Four new environment variables. They are **optional** in `src/shared/env.ts`: a provider whose
credentials are absent is not offered in the UI, so a fresh clone runs with email and password alone
and a contributor is not blocked on registering OAuth applications. A provider configured with only
one of its two values is a configuration error and must fail at boot, not silently disable itself.

Callback URLs are `/api/auth/callback/google` and `/api/auth/callback/github`, already served by the
existing Better Auth route handler.

---

## Account linking — the part that is a security decision

A user signs up with `ana@acme.com` and a password. Later they click "Continue with Google" and Google
returns the same address. Do those become one account?

**Yes, but only when the provider asserts the email is verified.** Automatic linking on a matching
email address is an account-takeover vector when the provider does not verify: anyone who can create
an account at a provider claiming `ana@acme.com` would inherit Ana's workspace, her datasets, and her
role in them.

Google returns `email_verified`. GitHub's primary email is verified when the account is in good
standing, and the API reports it. Link only on a verified assertion; otherwise require the user to
sign in with their existing method first and link deliberately from account settings.

A social sign-in whose email does not match any existing user creates a new user, and the existing
signup path gives that user a personal Organization exactly once — the same rule as email and
password. Social sign-in must not become a second way to create Organizations.

---

## Email verification

An email address arriving verified from Google or GitHub does not need a Datalize verification mail.
An address from the email-and-password path still does. Record which one a user came in through, so
"verified" always means something specific rather than "we asked at some point".

---

## What the UI shows

Sign-in and sign-up both show the provider buttons above the email form, with a divider. Provider
buttons carry the provider's name in text — "Continue with Google" — not a bare icon, which is
unreadable to a screen reader and ambiguous to everyone else.

If a provider is not configured, its button is absent. It is never shown disabled: a button that
cannot work is worse than no button.

An error returned from the OAuth callback lands the user back on the sign-in page with a message that
says which provider failed and what to do, never a raw provider error string or an error code alone.

---

## Scope

This is Slice 0 work. It does not touch tenant isolation, the request context, or the permission
model — a session is a session regardless of how it was established, and `assertCan` never asks how
the user signed in.

Deferred, deliberately: Microsoft and other providers, enterprise SSO and SAML, SCIM provisioning,
and domain-based auto-join to an existing Organization. Domain auto-join in particular sounds
convenient and is a tenant-isolation decision in disguise — anyone with an `@acme.com` address
joining Acme's workspace automatically is a policy Acme must opt into, not a default.
