/**
 * Rate-limited HTTP client for legislation.gov.au
 *
 * Fetches legislation from the Federal Register of Legislation using a two-step process:
 * 1. OData API (api.prod.legislation.gov.au/v1) to get title metadata and version dates
 * 2. EPUB XHTML endpoint to get the actual legislation text
 *
 * The SPA at legislation.gov.au renders legislation by fetching EPUB files that are
 * served at predictable URLs derived from the version metadata. The EPUB contains
 * XHTML files with well-structured CSS classes for sections, parts, etc.
 *
 * URL pattern for EPUB HTML:
 *   /{titleId}/{start}/{retrospectiveStart}/text/original/epub/OEBPS/document_1/document_1.html
 *
 * - 500ms minimum delay between requests (be respectful to government servers)
 * - User-Agent header identifying the MCP
 * - No auth needed (CC BY 4.0)
 */

const USER_AGENT = 'Australian-Law-MCP/1.0 (https://github.com/Ansvar-Systems/australian-law-mcp; hello@ansvar.ai)';
const MIN_DELAY_MS = 500;
const API_BASE = 'https://api.prod.legislation.gov.au/v1';
const WWW_BASE = 'https://www.legislation.gov.au';

let lastRequestTime = 0;

async function rateLimit(): Promise<void> {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < MIN_DELAY_MS) {
    await new Promise(resolve => setTimeout(resolve, MIN_DELAY_MS - elapsed));
  }
  lastRequestTime = Date.now();
}

export interface FetchResult {
  status: number;
  body: string;
  contentType: string;
}

export interface VersionInfo {
  titleId: string;
  name: string;
  status: string;
  registerId: string;
  start: string;         // ISO date e.g. "2025-06-10T00:00:00"
  retrospectiveStart: string;
  compilationNumber: string;
  isLatest: boolean;
  isCurrent: boolean;
  makingDate?: string;    // From title metadata
}

/**
 * Fetch a URL with rate limiting and proper headers.
 * Retries up to 3 times on 429/5xx errors with exponential backoff.
 */
export async function fetchWithRateLimit(url: string, accept = 'text/html, application/xhtml+xml, application/xml, */*', maxRetries = 3): Promise<FetchResult> {
  await rateLimit();

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': accept,
      },
    });

    if (response.status === 429 || response.status >= 500) {
      if (attempt < maxRetries) {
        const backoff = Math.pow(2, attempt + 1) * 1000;
        console.log(`  HTTP ${response.status} for ${url}, retrying in ${backoff}ms...`);
        await new Promise(resolve => setTimeout(resolve, backoff));
        continue;
      }
    }

    const body = await response.text();
    return {
      status: response.status,
      body,
      contentType: response.headers.get('content-type') ?? '',
    };
  }

  throw new Error(`Failed to fetch ${url} after ${maxRetries} retries`);
}

/**
 * Fetch version info for a title from the OData API.
 * Returns the latest version metadata including dates needed for the EPUB URL.
 */
export async function fetchVersionInfo(titleId: string): Promise<VersionInfo | null> {
  // Step 1: Get version info
  const versionUrl = `${API_BASE}/versions/find(titleId='${titleId}',asAtSpecification='latest')`;
  const versionResult = await fetchWithRateLimit(versionUrl, 'application/json');

  if (versionResult.status !== 200) {
    console.log(`  Version API returned HTTP ${versionResult.status} for ${titleId}`);
    return null;
  }

  const versionData = JSON.parse(versionResult.body);

  // Step 2: Get title metadata for makingDate
  const titleUrl = `${API_BASE}/titles('${titleId}')`;
  const titleResult = await fetchWithRateLimit(titleUrl, 'application/json');

  let makingDate: string | undefined;
  if (titleResult.status === 200) {
    const titleData = JSON.parse(titleResult.body);
    makingDate = titleData.makingDate;
  }

  return {
    titleId: versionData.titleId,
    name: versionData.name,
    status: versionData.status,
    registerId: versionData.registerId,
    start: versionData.start,
    retrospectiveStart: versionData.retrospectiveStart,
    compilationNumber: versionData.compilationNumber,
    isLatest: versionData.isLatest,
    isCurrent: versionData.isCurrent,
    makingDate,
  };
}

/**
 * Format an ISO datetime string to a date-only string (YYYY-MM-DD).
 */
function formatDate(isoDateTime: string): string {
  return isoDateTime.split('T')[0];
}

/**
 * Construct the EPUB XHTML URL for a given title and version.
 *
 * The Federal Register of Legislation serves EPUB files at:
 *   /{titleId}/{start}/{retrospectiveStart}/text/original/epub/OEBPS/document_1/document_1.html
 */
function buildEpubHtmlUrl(titleId: string, start: string, retrospectiveStart: string): string {
  const startDate = formatDate(start);
  const retroDate = formatDate(retrospectiveStart);
  return `${WWW_BASE}/${titleId}/${startDate}/${retroDate}/text/original/epub/OEBPS/document_1/document_1.html`;
}

/**
 * Fetch the actual legislation XHTML from the EPUB endpoint.
 *
 * Flow:
 * 1. Call the OData API to get version metadata (dates)
 * 2. Construct the EPUB XHTML URL from the version dates
 * 3. Fetch and return the full XHTML
 */
export async function fetchLegislationHtml(titleId: string): Promise<FetchResult & { versionInfo: VersionInfo | null }> {
  // Step 1: Get version metadata
  const versionInfo = await fetchVersionInfo(titleId);

  if (!versionInfo) {
    return {
      status: 404,
      body: '',
      contentType: '',
      versionInfo: null,
    };
  }

  // Step 2: Build the EPUB HTML URL and fetch
  const epubUrl = buildEpubHtmlUrl(
    versionInfo.titleId,
    versionInfo.start,
    versionInfo.retrospectiveStart,
  );

  const result = await fetchWithRateLimit(epubUrl);

  // Verify we got XHTML content (not the Angular SPA shell)
  if (result.status === 200 && result.body.includes('<!DOCTYPE html><html lang="en"')) {
    // This is the SPA shell, not actual legislation content
    console.log(`  WARNING: Got SPA shell instead of EPUB content for ${titleId}`);
    return {
      status: 404,
      body: '',
      contentType: '',
      versionInfo,
    };
  }

  return {
    ...result,
    versionInfo,
  };
}
