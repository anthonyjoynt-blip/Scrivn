/**
 * Every piece of claim state is either saved or documented as deliberately not saved.
 *
 * The failure this prevents is silent in both directions and invisible in review:
 *
 *   - A field added to the page but not to `SavedClaimState` is never written. Nothing errors. The
 *     PM fills it in, comes back tomorrow, and it is blank — and the only clue is that one field.
 *   - A field added to `SavedClaimState` but never applied on load is written and then ignored,
 *     which looks identical from the outside.
 *
 * This is the same shape as the two guards already in this suite — `resetRule.mjs`, which checks
 * every state is cleared by `reset()`, and the fixture-completeness check, which caught a new field
 * silently disabling its own question. All three exist because a list maintained by hand drifts from
 * the source it describes, and none of that drift shows up until somebody loses work.
 */

/** `const [x, setX] = useState...` — the same parse `resetRule.mjs` uses, for the same reason. */
export function declaredState(source) {
  const names = [];
  const re = /const \[(\w+), set(\w+)\] = useState/g;
  let m;
  while ((m = re.exec(source))) names.push({ name: m[1], setter: `set${m[2]}` });
  return names;
}

/** The keys `SAVED_CLAIM_KEYS` lists, read out of lib/claimState.ts rather than imported. */
export function savedKeys(claimStateSource) {
  const block = /export const SAVED_CLAIM_KEYS = \[([\s\S]*?)\] as const/.exec(claimStateSource);
  if (!block) return null;
  return [...block[1].matchAll(/"(\w+)"/g)].map((m) => m[1]);
}

/** The names `NOT_PERSISTED` documents, with their stated reasons. */
export function notPersisted(claimStateSource) {
  const block = /export const NOT_PERSISTED: Record<string, string> = \{([\s\S]*?)\n\};/.exec(claimStateSource);
  if (!block) return null;
  return [...block[1].matchAll(/^\s*(\w+):/gm)].map((m) => m[1]);
}

/**
 * The setters `applyLoadedClaim` calls.
 *
 * A key that is saved but never applied is written to the database and then thrown away on load —
 * so the saved list and the applied list have to match, not merely overlap.
 */
export function appliedSetters(source) {
  const fn = /const applyLoadedClaim = useCallback\(\(loaded: SavedClaimState\) => \{([\s\S]*?)\n  \}, \[\]\);/.exec(source);
  if (!fn) return null;
  return [...fn[1].matchAll(/(set\w+)\(/g)].map((m) => m[1]);
}
