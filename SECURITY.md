# Security policy

## Reporting a vulnerability

Report privately, not through the public issue tracker:

- **Preferred:** GitHub's private vulnerability reporting, from the repository's
  [Security tab](https://github.com/libraz/libcantus/security/advisories/new).
- **Alternative:** email `libraz@libraz.net`.

Include the input that triggers it, what happened, the affected version, and a
minimal reproduction if you have one. Expect an acknowledgement within a few
days.

## Supported versions

Pre-1.0. Fixes land on the latest release only; older versions are not patched.

## What is in scope

libcantus parses chord symbols and note data supplied by whatever tool embeds
it, so the parsing path is the interesting surface. In scope:

- A chord symbol, note sequence or configuration object that causes a hang,
  unbounded recursion or unbounded memory growth in the analyser or the
  generator.
- Any path by which parsing input executes it — this is a pure-TypeScript
  library and evaluates nothing.
- Any file or network access. The library is meant to have none; a reachable
  call is a vulnerability even if it is benign.
- A dependency in the published package that pulls either of the above in.

## What is not in scope

- Wrong analysis. A Roman numeral, cadence or key estimate that disagrees with a
  human reading is an accuracy bug; report it as a normal issue.
- Documented limits behaving as documented. A limit that can be bypassed is in
  scope.
- Denial of service from an input a caller could trivially have validated, such
  as a several-megabyte chord symbol.
- Findings that require an attacker to already control the process embedding the
  library.
