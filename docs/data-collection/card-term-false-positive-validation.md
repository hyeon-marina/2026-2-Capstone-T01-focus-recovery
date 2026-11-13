# Public card terminology false-positive correction

Validated on 2026-11-13, in `fix/public-card-term-detection`, separately from operating C. Runtime fix Commit: `0fedb3117b5b9f41c92adb29e51e37188714e7e4`.

## Problem and change

The public GitHub Pages HTTPS guide was quarantined because its safety explanation contains the term `credit card`. The old shared frontend regex and Backend `MetadataPage.publicText` treated the term itself as high-risk text. The live reproduction had no focused editable field, password/payment input, excluded layout, or sensitive title. Its body extractor raised `SENSITIVE_CONTENT`.

The correction removes this bare term from the body/title high-risk regex on both sides. It adds payment-value detection: normalized 13–19 digit candidates with Luhn checks, plus labelled card-number values that remain blocked even with a damaged checksum. Ordinary explanatory text passes; card-like values remain excluded. Normalization is only used for detection and does not rewrite the collected text.

Password, token, national-ID, contact, authentication/payment DOM, private URL, and other existing checks remain. Email and Korean mobile masking remain. The separate financial/medical **search-intent** rule remains; this change does not authorize financial searches or payment pages. This is a heuristic detector, not a complete anonymizer.

Runtime changes:

- `fe/src/shared/privacy.ts`
- `be/src/main/java/com/focusrecovery/domain/collection/MetadataPage.java`

No DB schema, API fields, IndexedDB format, or existing records are changed. The policy file and v6 SHA remain unchanged: `31db27f078c2c80223f3887e33d1853a378e6794098f32319769f01577c2c982`. The detector's behavior changes explicitly as described above; a passing policy-file validator does not itself validate this classifier change.

## Regression and build results

- Initial new FE regression: 12 failures, 2 passes before the fix. Expanded final card suite: 16 passes.
- Initial new Backend card regression: 3 failures, 2 passes before the fix. Final card cases and production-policy boundary checks pass.
- FE full suite: 973 passes, 2 existing skips.
- Backend full suite: 894 passes, 167 conditional skips (1,061 reported tests), no failures/errors.
- TypeScript, real-collection Extension build, Backend bootJar: PASS.
- Official v6 `checkLocalPolicy` with the pinned SHA: PASS.

Coverage includes bare explanatory terminology, synthetic payment test numbers (13/15/16/19 digits, spaces, hyphens, line breaks, fullwidth digits, and nonbreaking spaces), damaged labelled values, ordinary documentation numbers, checks before 5,000-character truncation, masking, credentials, excluded payment inputs, and actual Content Script signals.

The `individual-local` policy-boundary test uses the unmodified TEAM_POLICY, confirms the real-profile/page-content branch, accepts a valid explanatory Visit, and rejects a valid-shaped Visit containing a synthetic card value with `COLLECTION_POLICY_BLOCKED`. Its initial fixture was too short and stopped at the unrelated 50-character request contract; the fixture was corrected and `validateV2()` is now explicitly required before testing the privacy boundary. No validator or assertion was weakened.

## Actual public-page end-to-end result

The test uses a NEW synthetic MySQL, Source/Participant/Credential, loopback Backend and Chrome for Testing profile. It uses the repository's test-only SYNTHETIC exact-site release, not operating C's identity or human consent. Pages come from live public HTTPS sites; there is no HTML/network mocking or certificate-validation bypass. Therefore this is an automated technical result, not one of C's 53 human research sessions.

Before correction, Visits increased to 7 and the HTTPS guide then quarantined the session; the server considered all visits privacy-excluded. After correction, the same itinerary continued through the HTTPS guide to **12 actual-dwell Visits**, including DNS/TLS terminology and return to deployment documentation.

Final server/client result:

- `ENDED / CLEAR`
- `RAW_COLLECTED / AI NOT_RUN`
- 12 valid Visits, all measured for at least 5,000 ms
- Normal END ACK `acked`, pending POST/PATCH 0, storage error false
- 1 SYNTHETIC session; 0 PARTICIPANT actual sessions

The test Backend and MySQL were normally stopped afterward; MySQL exit=0, OOMKilled=false, Error empty. Test profiles, volumes, previous quarantined attempts, and evidence remain. No Export was executed.

## Operating C and rollout limit

Operating C remains at `432959e810ac6b7af1f928e7d3164e695fd44070`; this new frontend/backend fix is not deployed. Its latest PLAN-003 was read as ENDED/QUARANTINED with zero stored Visits. No C session, Queue, credential, consent, source, or browser was modified during this correction.

Historical C quarantines cannot be attributed to this exact term without trigger-stage evidence. Other conservative sensitive-topic and active-input rules remain. This result proves the reviewed live-page itinerary, not unrestricted collection of every page.

Deployment includes a new Backend binary, exceeding the previous FE-only rollout approval. Before installation, operating C's latest Queue/ACK and encrypted backups must be checked and approval for the FE + Backend rollout obtained. Existing quarantines must not be cleared; actual re-collection, consent and Export remain separate user decisions.
