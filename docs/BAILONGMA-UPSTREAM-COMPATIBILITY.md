# BaiLongma Upstream Compatibility Record

## Candidate audit

| Field | Current production pin | Candidate under test |
| --- | --- | --- |
| Repository | `xiaoyuanda666-ship-it/BaiLongma` | `xiaoyuanda666-ship-it/BaiLongma` |
| Branch | `main` | `main` |
| Commit | `0e243bc518cebbdb74f114e98b1189133abbda63` | `34d939eabe226c561550079cb810090015b49817` |
| Version | `2.1.479` | `2.1.515` |
| License | MIT | MIT |
| Drift | baseline | 37 commits ahead, 0 behind |
| Compare scope | n/a | 150 files changed |

The candidate contains broad changes in the upstream API, database modules,
media capabilities, runtime delivery, WebSocket security and Brain UI. It is
therefore evaluated as a compatibility candidate, not treated as a routine
patch release.

## BaiRui integration boundary

The Platform build must continue to:

1. Check out the upstream as a read-only gitlink.
2. Copy the upstream UI into a staging directory.
3. Apply only the explicit BaiRui build transforms for `brain-ui.html`,
   `app.js`, `app-shell.js`, `chat.js` and `voice-wake.js`.
4. Emit `.bairui-build.json` with source repository, source version and file
   hashes.
5. Serve only the verified build artifact.

No BaiRui behavior is committed inside the upstream submodule. A candidate
failure must leave the production pin unchanged.

## Acceptance decision

The candidate is accepted only when the GitHub Platform CI for the candidate
commit passes all of the following:

- upstream build and transform anchor checks;
- Platform verify and dependency/security checks;
- PostgreSQL and control-plane checks;
- remote BaiLongma browser acceptance on desktop and mobile;
- U00-03 vertical-slice evidence;
- container and distribution checks.

Until that CI result is recorded, the production decision is `hold` and the
current pin remains `0e243bc518cebbdb74f114e98b1189133abbda63`.
