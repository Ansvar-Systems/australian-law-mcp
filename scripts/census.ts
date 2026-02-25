#!/usr/bin/env tsx
/**
 * Australian Law MCP — Census Script
 *
 * Enumerates ALL federal Acts from the Federal Register of Legislation
 * via the OData API at api.prod.legislation.gov.au/v1.
 *
 * Uses curl for HTTP requests (more reliable DNS/TLS than Node fetch in some envs).
 *
 * Outputs data/census.json in golden standard format.
 *
 * Strategy:
 *  - Enumerate all in-force principal Acts (the substantive laws) — classified as ingestable
 *  - Enumerate all in-force non-principal Acts (amending Acts) — classified as excluded
 *  - Optionally enumerate ceased/repealed Acts — classified as excluded
 *  - Total census covers every federal Act known to the register
 *
 * Usage:
 *   npx tsx scripts/census.ts
 *   npx tsx scripts/census.ts --include-repealed    # Also enumerate repealed Acts
 *   npx tsx scripts/census.ts --skip-non-principal   # Skip amending Acts
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const API_BASE = 'https://api.prod.legislation.gov.au/v1';
const CENSUS_PATH = path.resolve(__dirname, '../data/census.json');
const PAGE_SIZE = 100;
const MIN_DELAY_MS = 500;

interface ODataTitle {
  id: string;
  name: string;
  makingDate: string | null;
  year: number;
  number: number;
  status: string;
  isPrincipal: boolean;
}

interface ODataResponse {
  '@odata.count'?: number;
  value: ODataTitle[];
}

interface CensusLaw {
  id: string;
  title: string;
  identifier: string;
  url: string;
  year: number;
  number: number;
  status: 'in_force' | 'amended' | 'repealed';
  is_principal: boolean;
  category: string;
  classification: 'ingestable' | 'excluded' | 'inaccessible';
  ingested: boolean;
  provision_count: number | null;
  ingestion_date: string | null;
}

interface CensusFile {
  schema_version: string;
  jurisdiction: string;
  jurisdiction_name: string;
  portal: string;
  census_date: string;
  agent: string;
  summary: {
    total_laws: number;
    ingestable: number;
    ocr_needed: number;
    inaccessible: number;
    excluded: number;
  };
  laws: CensusLaw[];
}

let lastRequestTime = 0;

function sleep(ms: number): void {
  const end = Date.now() + ms;
  while (Date.now() < end) { /* busy wait for sync rate limiting */ }
}

function rateLimit(): void {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < MIN_DELAY_MS) {
    sleep(MIN_DELAY_MS - elapsed);
  }
  lastRequestTime = Date.now();
}

/**
 * Fetch a URL using curl (more reliable than Node.js fetch for this API).
 */
function curlFetch(url: string): string {
  rateLimit();
  const escaped = url.replace(/'/g, "'\\''");
  const result = execSync(
    `curl -s --connect-timeout 30 --max-time 120 -H "Accept: application/json" -H "User-Agent: Australian-Law-MCP/1.0 (https://github.com/Ansvar-Systems/australian-law-mcp; hello@ansvar.ai)" '${escaped}'`,
    { encoding: 'utf-8', maxBuffer: 50 * 1024 * 1024 },
  );
  return result;
}

function parseArgs(): { includeRepealed: boolean; skipNonPrincipal: boolean } {
  const args = process.argv.slice(2);
  let includeRepealed = false;
  let skipNonPrincipal = false;
  for (const arg of args) {
    if (arg === '--include-repealed') includeRepealed = true;
    if (arg === '--skip-non-principal') skipNonPrincipal = true;
  }
  return { includeRepealed, skipNonPrincipal };
}

/**
 * Map OData status to our internal status.
 */
function mapStatus(odataStatus: string): 'in_force' | 'amended' | 'repealed' {
  switch (odataStatus) {
    case 'InForce': return 'in_force';
    case 'Ceased': return 'repealed';
    case 'Repealed': return 'repealed';
    case 'NeverEffective': return 'repealed';
    default: return 'in_force';
  }
}

/**
 * Generate a URL-friendly slug from an act title.
 * e.g. "Privacy Act 1988" -> "privacy-act-1988"
 */
function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/['']/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 120);
}

/**
 * Fetch all titles matching a filter, handling OData pagination via $skip.
 */
function fetchAllTitles(filter: string): ODataTitle[] {
  const allTitles: ODataTitle[] = [];
  let skip = 0;
  let totalExpected: number | null = null;

  while (true) {
    const params = new URLSearchParams({
      '$filter': filter,
      '$select': 'id,name,makingDate,year,number,status,isPrincipal',
      '$orderby': 'name',
      '$top': String(PAGE_SIZE),
      '$skip': String(skip),
      '$count': 'true',
    });

    const url = `${API_BASE}/titles?${params.toString()}`;

    try {
      const body = curlFetch(url);
      const data: ODataResponse = JSON.parse(body);

      if (totalExpected === null && data['@odata.count'] !== undefined) {
        totalExpected = data['@odata.count'];
        console.log(`    Expected total: ${totalExpected}`);
      }

      if (!data.value || data.value.length === 0) {
        break;
      }

      allTitles.push(...data.value);

      if (allTitles.length % 500 === 0 || data.value.length < PAGE_SIZE) {
        console.log(`    Fetched ${allTitles.length}${totalExpected ? ` / ${totalExpected}` : ''}`);
      }

      if (data.value.length < PAGE_SIZE) {
        break; // Last page
      }

      skip += PAGE_SIZE;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.log(`    ERROR at skip=${skip}: ${msg.substring(0, 200)}`);
      // Retry once after a longer wait
      sleep(5000);
      try {
        const body = curlFetch(`${API_BASE}/titles?${params.toString()}`);
        const data: ODataResponse = JSON.parse(body);
        if (data.value && data.value.length > 0) {
          allTitles.push(...data.value);
          if (data.value.length < PAGE_SIZE) break;
          skip += PAGE_SIZE;
          continue;
        }
      } catch {
        console.log(`    FATAL: Retry failed at skip=${skip}. Stopping pagination.`);
        break;
      }
    }
  }

  return allTitles;
}

function main(): void {
  const { includeRepealed, skipNonPrincipal } = parseArgs();

  console.log('Australian Law MCP — Census');
  console.log('===========================\n');
  console.log(`  Source: Federal Register of Legislation (legislation.gov.au)`);
  console.log(`  API:    ${API_BASE}`);
  console.log(`  Include repealed: ${includeRepealed}`);
  console.log(`  Skip non-principal: ${skipNonPrincipal}\n`);

  const laws: CensusLaw[] = [];
  const seenIds = new Set<string>();

  // 1. In-force principal Acts — these are the ingestable ones
  console.log('Phase 1: In-force principal Acts...');
  const inForcePrincipal = fetchAllTitles("collection eq 'Act' and status eq 'InForce' and isPrincipal eq true");
  console.log(`  Found ${inForcePrincipal.length} in-force principal Acts\n`);

  for (const title of inForcePrincipal) {
    if (seenIds.has(title.id)) continue;
    seenIds.add(title.id);

    const slug = slugify(title.name);
    laws.push({
      id: slug,
      title: title.name,
      identifier: title.id,
      url: `https://www.legislation.gov.au/${title.id}/latest/text`,
      year: title.year,
      number: title.number,
      status: 'in_force',
      is_principal: true,
      category: 'principal',
      classification: 'ingestable',
      ingested: false,
      provision_count: null,
      ingestion_date: null,
    });
  }

  // 2. In-force non-principal Acts (amending Acts) — classified as excluded
  if (!skipNonPrincipal) {
    console.log('Phase 2: In-force non-principal Acts (amending)...');
    const inForceNonPrincipal = fetchAllTitles("collection eq 'Act' and status eq 'InForce' and isPrincipal eq false");
    console.log(`  Found ${inForceNonPrincipal.length} in-force non-principal Acts\n`);

    for (const title of inForceNonPrincipal) {
      if (seenIds.has(title.id)) continue;
      seenIds.add(title.id);

      const slug = slugify(title.name);
      laws.push({
        id: slug,
        title: title.name,
        identifier: title.id,
        url: `https://www.legislation.gov.au/${title.id}/latest/text`,
        year: title.year,
        number: title.number,
        status: 'in_force',
        is_principal: false,
        category: 'amending',
        classification: 'excluded',
        ingested: false,
        provision_count: null,
        ingestion_date: null,
      });
    }
  }

  // 3. Repealed/ceased Acts — classified as excluded
  if (includeRepealed) {
    console.log('Phase 3: Repealed/Ceased Acts...');
    const repealed = fetchAllTitles("collection eq 'Act' and (status eq 'Ceased' or status eq 'Repealed')");
    console.log(`  Found ${repealed.length} repealed/ceased Acts\n`);

    for (const title of repealed) {
      if (seenIds.has(title.id)) continue;
      seenIds.add(title.id);

      const slug = slugify(title.name);
      laws.push({
        id: slug,
        title: title.name,
        identifier: title.id,
        url: `https://www.legislation.gov.au/${title.id}/latest/text`,
        year: title.year,
        number: title.number,
        status: mapStatus(title.status),
        is_principal: title.isPrincipal,
        category: title.isPrincipal ? 'principal' : 'amending',
        classification: 'excluded',
        ingested: false,
        provision_count: null,
        ingestion_date: null,
      });
    }
  }

  // Sort by title
  laws.sort((a, b) => a.title.localeCompare(b.title));

  // Build summary
  const ingestable = laws.filter(l => l.classification === 'ingestable').length;
  const excluded = laws.filter(l => l.classification === 'excluded').length;
  const inaccessible = laws.filter(l => l.classification === 'inaccessible').length;

  const census: CensusFile = {
    schema_version: '1.0',
    jurisdiction: 'AU',
    jurisdiction_name: 'Australia',
    portal: 'legislation.gov.au',
    census_date: new Date().toISOString().split('T')[0],
    agent: 'scripts/census.ts',
    summary: {
      total_laws: laws.length,
      ingestable,
      ocr_needed: 0,
      inaccessible,
      excluded,
    },
    laws,
  };

  fs.mkdirSync(path.dirname(CENSUS_PATH), { recursive: true });
  fs.writeFileSync(CENSUS_PATH, JSON.stringify(census, null, 2));

  console.log('===========================');
  console.log('Census Complete');
  console.log('===========================\n');
  console.log(`  Total Acts enumerated: ${laws.length}`);
  console.log(`  Ingestable (in-force principal): ${ingestable}`);
  console.log(`  Excluded (amending/repealed):    ${excluded}`);
  console.log(`  Inaccessible:                    ${inaccessible}`);
  console.log(`  OCR needed:                      0`);
  console.log(`\n  Output: ${CENSUS_PATH}`);
}

main();
