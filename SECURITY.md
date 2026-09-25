# Reporting security issues

Found a vulnerability? Please report it privately rather than opening a public
issue: contact the repository owner directly.

Include a description, reproduction steps, and affected area
(auth / rooms / chat / media / content pipeline / realtime).

Scope notes:
- Reports about the local development defaults (ephemeral dev secrets without
  `.env.local`) are out of scope by design; production startup fails closed.
- The password-reset flow logs tokens server-side when SMTP is not configured;
  this is a documented limitation (docs/SECURITY.md §4), not a vulnerability.

We aim to acknowledge reports within a week. Thank you for helping keep
players' conversations safe.
