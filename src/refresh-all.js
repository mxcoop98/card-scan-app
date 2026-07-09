// Run this on a schedule (cron / EAS Workflow / systemd timer) to
// snapshot every card's price. Each run adds one row per card per
// source, which is what powers the value-over-time chart.
//
//   node src/refresh-all.js
//
// Example crontab (daily at 6am):
//   0 6 * * * cd /path/to/backend && node src/refresh-all.js >> refresh.log 2>&1

import { query, pool } from './db.js';
import { fetchPrices } from './pricing.js';

async function main() {
  const { rows: cards } = await query('SELECT * FROM cards');
  console.log(`Refreshing ${cards.length} cards...`);
  let inserted = 0;
  let enriched = 0;
  for (const card of cards) {
    try {
      const fetched = await fetchPrices(card);
      for (const p of fetched.prices) {
        await query(
          `INSERT INTO price_history (card_id, source, price, currency, price_type)
           VALUES ($1,$2,$3,$4,$5)`,
          [card.id, p.source, p.price, p.currency ?? 'USD', p.price_type ?? null]
        );
        inserted++;
      }
      // Opportunistic image + external_ids backfill.
      const patches = [];
      const values = [];
      if (fetched.image_url && !card.image_url) {
        values.push(fetched.image_url);
        patches.push(`image_url = $${values.length}`);
      }
      if (fetched.external_ids) {
        const merged = { ...(card.external_ids ?? {}), ...fetched.external_ids };
        if (JSON.stringify(merged) !== JSON.stringify(card.external_ids ?? {})) {
          values.push(merged);
          patches.push(`external_ids = $${values.length}`);
        }
      }
      if (patches.length > 0) {
        values.push(card.id);
        await query(`UPDATE cards SET ${patches.join(', ')}, updated_at = now() WHERE id = $${values.length}`, values);
        enriched++;
      }
    } catch (e) {
      console.error(`card ${card.id} failed:`, e.message);
    }
    // be polite to free APIs
    await new Promise((r) => setTimeout(r, 300));
  }
  console.log(`Done. Inserted ${inserted} price rows; enriched ${enriched} cards.`);
  await pool.end();
}

// Railway cron: the process MUST exit when finished, or the next
// scheduled run is skipped. Exit explicitly with a status code.
main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('refresh-all failed:', err);
    process.exit(1);
  });
