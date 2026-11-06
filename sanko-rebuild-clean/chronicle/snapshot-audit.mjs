/** Read a local JSON export and print *metadata only*. No online API. */
import {readFile} from 'node:fs/promises';
import {reconcileChronicle} from './reconcile.mjs';
const path = process.argv[2];
if (!path) {
  console.error('Usage: node chronicle/snapshot-audit.mjs <local-json-file>');
  process.exitCode = 2;
} else {
  const payload = JSON.parse(await readFile(path, 'utf8'));
  if (payload.synthetic_only !== true) {
    console.error('Use this CLI on explicit synthetic fixtures only; live data uses a separate private audit route.');
    process.exitCode = 2;
  } else {
    const r = await reconcileChronicle({rows: payload.rows, checkedAt: payload.checkedAt});
    console.log(JSON.stringify({status: r.status, checkedDayMsk: r.checkedDayMsk,
      accepted: r.accepted, invalid: r.invalid, changes: r.changeCounts,
      latestKnownDay: r.latestKnownDay, hasPostPublishedToday: r.hasPostPublishedToday,
      eventExtractionPerformed: false, currentDayStoryKnown: false}, null, 2));
  }
}
