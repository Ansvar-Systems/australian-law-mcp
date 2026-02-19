#!/usr/bin/env tsx
/**
 * Australian Law MCP — Ingestion Pipeline
 *
 * Fetches Australian federal legislation from legislation.gov.au using:
 * 1. OData API for metadata (version dates, register IDs)
 * 2. EPUB XHTML endpoint for actual legislation text
 *
 * Data is sourced under Creative Commons Attribution 4.0 International (CC BY 4.0).
 *
 * Usage:
 *   npm run ingest                    # Full ingestion
 *   npm run ingest -- --limit 5       # Test with 5 acts
 *   npm run ingest -- --skip-fetch    # Reuse cached pages
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { fetchLegislationHtml } from './lib/fetcher.js';
import { parseAustralianHtml, KEY_AUSTRALIAN_ACTS, type ActIndexEntry, type ParsedAct } from './lib/parser.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SOURCE_DIR = path.resolve(__dirname, '../data/source');
const SEED_DIR = path.resolve(__dirname, '../data/seed');

function parseArgs(): { limit: number | null; skipFetch: boolean } {
  const args = process.argv.slice(2);
  let limit: number | null = null;
  let skipFetch = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--limit' && args[i + 1]) {
      limit = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === '--skip-fetch') {
      skipFetch = true;
    }
  }

  return { limit, skipFetch };
}

async function fetchAndParseActs(acts: ActIndexEntry[], skipFetch: boolean): Promise<void> {
  console.log(`\nProcessing ${acts.length} federal acts...\n`);

  fs.mkdirSync(SOURCE_DIR, { recursive: true });
  fs.mkdirSync(SEED_DIR, { recursive: true });

  let processed = 0;
  let skipped = 0;
  let failed = 0;
  let totalProvisions = 0;
  const results: Array<{ act: string; provisions: number; status: string }> = [];

  for (const act of acts) {
    const sourceFile = path.join(SOURCE_DIR, `${act.id}.html`);
    const seedFile = path.join(SEED_DIR, `${act.id}.json`);

    // Skip if seed already exists and we're in skip-fetch mode
    if (skipFetch && fs.existsSync(seedFile)) {
      const existing = JSON.parse(fs.readFileSync(seedFile, 'utf-8'));
      const provCount = existing.provisions?.length ?? 0;
      console.log(`  SKIP ${act.title} (cached, ${provCount} provisions)`);
      totalProvisions += provCount;
      results.push({ act: act.title, provisions: provCount, status: 'cached' });
      skipped++;
      processed++;
      continue;
    }

    try {
      let html: string;
      let versionInfo = null;

      if (fs.existsSync(sourceFile) && skipFetch) {
        html = fs.readFileSync(sourceFile, 'utf-8');
      } else {
        process.stdout.write(`  Fetching ${act.title}...`);
        const result = await fetchLegislationHtml(act.titleId);
        versionInfo = result.versionInfo;

        if (result.status !== 200) {
          console.log(` HTTP ${result.status}`);
          results.push({ act: act.title, provisions: 0, status: `HTTP ${result.status}` });
          failed++;
          processed++;
          continue;
        }

        if (!result.body || result.body.length < 1000) {
          console.log(` Empty or too small response (${result.body?.length ?? 0} bytes)`);
          results.push({ act: act.title, provisions: 0, status: 'empty response' });
          failed++;
          processed++;
          continue;
        }

        html = result.body;
        fs.writeFileSync(sourceFile, html);
        console.log(` OK (${(html.length / 1024).toFixed(0)} KB)`);
      }

      const parsed = parseAustralianHtml(html, act, versionInfo);
      fs.writeFileSync(seedFile, JSON.stringify(parsed, null, 2));
      totalProvisions += parsed.provisions.length;
      console.log(`    -> ${parsed.provisions.length} provisions, ${parsed.definitions.length} definitions`);
      results.push({ act: act.title, provisions: parsed.provisions.length, status: 'ok' });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.log(`  ERROR ${act.title}: ${msg}`);
      results.push({ act: act.title, provisions: 0, status: `error: ${msg.substring(0, 80)}` });
      failed++;
    }

    processed++;
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`Ingestion Summary`);
  console.log(`${'='.repeat(60)}`);
  console.log(`  Processed: ${processed}`);
  console.log(`  Skipped (cached): ${skipped}`);
  console.log(`  Failed: ${failed}`);
  console.log(`  Total provisions: ${totalProvisions}`);
  console.log(`\nPer-act results:`);
  for (const r of results) {
    const provStr = r.provisions > 0 ? `${r.provisions} provisions` : 'FAILED';
    console.log(`  ${r.act.padEnd(50)} ${provStr.padEnd(20)} [${r.status}]`);
  }
}

async function main(): Promise<void> {
  const { limit, skipFetch } = parseArgs();

  console.log('Australian Law MCP — Ingestion Pipeline');
  console.log('========================================\n');
  console.log(`  Source: Federal Register of Legislation (legislation.gov.au)`);
  console.log(`  Method: OData API + EPUB XHTML endpoint`);
  console.log(`  License: CC BY 4.0`);

  if (limit) console.log(`  --limit ${limit}`);
  if (skipFetch) console.log(`  --skip-fetch`);

  const acts = limit ? KEY_AUSTRALIAN_ACTS.slice(0, limit) : KEY_AUSTRALIAN_ACTS;
  await fetchAndParseActs(acts, skipFetch);
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
