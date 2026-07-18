# C00-02 Platform consumer status

This branch consumes the published `@bairui/contracts` `v2.3.0-rc.1` release
from the immutable codeload tag URL. The annotated tag resolves to merge commit
`52b4e19043c5e5a8ce45ddefcde6768c06df9151`; `package-lock.json` records the
downloaded archive integrity.

Canonical control delivery uses `LeaseRequestEnvelope`, `LeaseEnvelope`, and
`ReceiptEnvelope`. Every mutation carries the generated owner scope, revision,
sequence, timestamp, nonce-independent embedded signature, and is also sent
under the existing timestamp/nonce/body transport HMAC.

The embedded HMAC uses the same per-server derived machine key. Its canonical
input is recursively key-sorted JSON for the full mutation, with
`signature.algorithm`, `signature.key_id`, and `signature.signed_at` included
and only `signature.value` omitted. Platform-issued leases use the target
`server_id` as `key_id`, allowing the Server Agent to verify the response with
its existing machine credential. This rule is part of the C00-03 integration
contract and must not be silently changed by either consumer.

New canonical traffic cannot issue or lease `config.apply-user`, cannot contain
raw secret or configuration documents, and cannot report final `succeeded` in
an executor receipt. Executor completion is `completion_candidate`; final
success belongs to an Authority-derived `command.verified` event.

The existing PostgreSQL and memory repositories still implement the legacy
delivery model. This consumer task does not modify those repositories or their
migrations. Canonical HTTP routes therefore require an injected C00-03 Control
Authority and fail closed while that service is absent.

This is a cross-repository consumer candidate, not a `GATE-C00` result.
