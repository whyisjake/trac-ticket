# trac-ticket

Reads a core.trac.wordpress.org ticket from the command line. Trac sits behind a
JavaScript proof-of-work challenge that returns 403 to every plain HTTP client,
so this drives headless Chromium via Playwright.

## Setup

```
git clone https://github.com/whyisjake/trac-ticket.git
cd trac-ticket
npm install
npx playwright install chromium   # one-time browser download, about 95 MB
npm link                          # optional: puts `trac-ticket` on your PATH
```

## Usage

```
trac-ticket 66079
trac-ticket 66079 --json
```

Without `npm link`, run `npm run ticket -- 66079` from the clone instead. The
challenge cookie is cached in `~/.cache/trac-ticket`, so repeat runs take a few
seconds.

Also works for any `*.trac.wordpress.org` host by passing the full ticket URL:

```
trac-ticket https://meta.trac.wordpress.org/ticket/8202
```

Proof of concept for a proposed `grunt ticket:<n>` task in
[grunt-patch-wordpress](https://github.com/WordPress/grunt-patch-wordpress),
whose `grunt patch` is blocked by the same challenge
([#210](https://github.com/WordPress/grunt-patch-wordpress/issues/210)).
The durable fix is a Trac read API, see
[meta:#8202](https://meta.trac.wordpress.org/ticket/8202).

Not part of core; do not add it to a core checkout.
