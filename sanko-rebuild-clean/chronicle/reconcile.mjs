import {isDay, normalizePost} from './normalize.mjs';

const byId = posts => {
  const result = new Map();
  for (const p of posts) {
    if (!p || typeof p.id !== 'string' || !p.contentHash) throw new TypeError('invalid_prior_snapshot');
    if (result.has(p.id)) throw new TypeError('duplicate_prior_id');
    result.set(p.id, p);
  }
  return result;
};

/**
 * Read-only evidence reconciliation: changes are returned, never written.
 * Every missing source id stays untouched: a partial query is not a deletion.
 */
export async function reconcileChronicle({rows, previous = [], checkedAt, sourceStatus = 'ok'} = {}) {
  if (!Array.isArray(rows) || !Array.isArray(previous)) throw new TypeError('invalid_rows');
  if (typeof checkedAt !== 'string' || Number.isNaN(Date.parse(checkedAt)))
    throw new TypeError('invalid_checked_at');
  if (!['ok', 'partial', 'error'].includes(sourceStatus)) throw new TypeError('invalid_source_status');
  const previousById = byId(previous);
  if (sourceStatus === 'error') {
    // On failure the read is NOT a valid new snapshot, even if a partial body arrived.
    const saved = [...previousById.values()];
    return {checkedAt, checkedDayMsk: new Date(Date.parse(checkedAt) + 3 * 3600_000)
      .toISOString().slice(0, 10), status: 'error', sourceStatus,
      received: rows.length, accepted: 0, invalid: [],
      changeCounts: {new: 0, textRevision: 0, metadataRevision: 0, unchanged: 0},
      changes: [], previousAbsentFromBatch: [], snapshots: saved,
      latestKnownDay: saved.reduce((best,p) => p.publishedDayMsk > best ? p.publishedDayMsk : best, ''),
      hasPostPublishedToday: null, safeToPublish: false,
      completeness: 'unverified_source_error'};
  }
  const accepted = new Map();
  const invalid = [];
  for (let i = 0; i < rows.length; i++) {
    let post;
    try { post = await normalizePost(rows[i]); }
    catch (err) { invalid.push({rowIndex: i, reason: err?.message || 'invalid_post'}); continue; }
    if (accepted.has(post.id)) {
      const earlier = accepted.get(post.id);
      // Never silently choose between two different versions returned for one id.
      invalid.push({rowIndex: i, reason: earlier.contentHash === post.contentHash &&
        earlier.metaSignature === post.metaSignature ? 'duplicate_post' : 'conflicting_duplicate_post'});
      continue;
    }
    accepted.set(post.id, post);
  }
  const changes = [];
  for (const post of accepted.values()) {
    const prior = previousById.get(post.id);
    const changeType = !prior ? 'new' :
      post.contentHash !== prior.contentHash ? 'text_revision' :
      post.metaSignature !== prior.metaSignature ? 'metadata_revision' : 'unchanged';
    changes.push({id: post.id, changeType, post});
  }
  const untouched = [...previousById.keys()].filter(id => !accepted.has(id));
  const next = new Map(previousById);
  for (const change of changes) next.set(change.id, change.post);
  const checkedDayMsk = new Date(Date.parse(checkedAt) + 3 * 3600_000).toISOString().slice(0, 10);
  if (!isDay(checkedDayMsk)) throw new TypeError('invalid_checked_day');
  const safeToPublish = sourceStatus === 'ok' && invalid.length === 0 &&
    ![...accepted.values()].some(p => p.anomalies.length);
  const published = safeToPublish ? next : previousById;
  const latestKnownDay = [...published.values()].reduce((best, p) =>
    p.publishedDayMsk > best ? p.publishedDayMsk : best, '');
  return {
    checkedAt, checkedDayMsk,
    status: sourceStatus === 'partial' || invalid.length > 0 ||
      [...accepted.values()].some(p => p.anomalies.length) ? 'partial' : 'ok',
    sourceStatus,
    safeToPublish,
    received: rows.length, accepted: accepted.size,
    invalid,
    changeCounts: {
      new: changes.filter(c => c.changeType === 'new').length,
      textRevision: changes.filter(c => c.changeType === 'text_revision').length,
      metadataRevision: changes.filter(c => c.changeType === 'metadata_revision').length,
      unchanged: changes.filter(c => c.changeType === 'unchanged').length
    },
    changes,
    previousAbsentFromBatch: untouched,
    // Unsafe/partial batches never overwrite the last accepted snapshot.
    snapshots: [...published.values()].sort((a, b) => a.publishedAtEpoch - b.publishedAtEpoch || a.postId - b.postId),
    candidateSnapshots: safeToPublish ? undefined : [...next.values()],
    latestKnownDay,
    // A successful check without today's publication is NOT evidence that nothing happened today.
    hasPostPublishedToday: [...published.values()].some(p => p.publishedDayMsk === checkedDayMsk && !p.excluded),
    completeness: 'unknown_without_authoritative_source_total'
  };
}
