/**
 * XHTML parser for Australian legislation from legislation.gov.au EPUB endpoint.
 *
 * The Federal Register of Legislation serves legislation as EPUB files containing
 * XHTML with well-defined CSS classes:
 *
 *   ActHead1    - Chapter heading (e.g., "Chapter 1")
 *   ActHead2    - Part heading (e.g., "Part I—Preliminary")
 *   ActHead3    - Division heading
 *   ActHead4    - Subdivision heading
 *   ActHead5    - Section heading (e.g., "6  Interpretation")
 *   CharSectno  - Section number span within ActHead5
 *   subsection  - Subsection text (e.g., "(1) In this Act...")
 *   paragraph   - Paragraph text (e.g., "(a) means...")
 *   paragraphsub - Sub-paragraph text
 *   Definition  - Definition text
 *   Penalty     - Penalty clause
 *   notetext    - Note text
 *   SubsectionHead - Subsection heading
 *   Tabletext   - Text within tables
 *   SOText/SOPara/SOBullet - Supplementary text
 *
 * Each section starts with an ActHead5 element and includes all content until
 * the next ActHead5 (or higher-level heading).
 */

import type { VersionInfo } from './fetcher.js';

export interface ActIndexEntry {
  id: string;
  title: string;
  year: number;
  titleId: string;  // legislation.gov.au title ID (e.g., C2004A03712)
  url: string;
  status: 'in_force' | 'amended' | 'repealed' | 'not_yet_in_force';
}

export interface ParsedProvision {
  provision_ref: string;
  chapter?: string;
  section: string;
  title: string;
  content: string;
}

export interface ParsedDefinition {
  term: string;
  definition: string;
  source_provision?: string;
}

export interface ParsedAct {
  id: string;
  type: 'statute';
  title: string;
  title_en: string;
  short_name: string;
  status: 'in_force' | 'amended' | 'repealed' | 'not_yet_in_force';
  issued_date: string;
  in_force_date: string;
  url: string;
  description?: string;
  provisions: ParsedProvision[];
  definitions: ParsedDefinition[];
}

/**
 * Strip HTML/XML tags and decode common entities. Normalize whitespace.
 */
function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#xa0;/gi, ' ')
    .replace(/&#x2011;/gi, '-')
    .replace(/&#x2013;/gi, '\u2013')
    .replace(/&#x2014;/gi, '\u2014')
    .replace(/&#x2018;/gi, '\u2018')
    .replace(/&#x2019;/gi, '\u2019')
    .replace(/&#x201[cCdD];/gi, '"')
    .replace(/&#x\w+;/gi, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&rsquo;/g, '\u2019')
    .replace(/&lsquo;/g, '\u2018')
    .replace(/&rdquo;/g, '\u201D')
    .replace(/&ldquo;/g, '\u201C')
    .replace(/&mdash;/g, '\u2014')
    .replace(/&ndash;/g, '\u2013')
    .replace(/\s+/g, ' ')
    .trim();
}

// Content CSS classes that make up section body text
// Includes both modern (ActHead) and older (New/Heading) format classes
const CONTENT_CLASSES = [
  'subsection',
  'subsection2',
  'paragraph',
  'paragraphsub',
  'paragraphsub-sub',
  'Definition',
  'Penalty',
  'notetext',
  'notepara',
  'SubsectionHead',
  'Tabletext',
  'Tablea',
  'TableHeading',
  'SOText',
  'SOPara',
  'SOBullet',
  // Older format classes (used by amending acts like Cybercrime Act)
  'indenta',
  'indentii',
  'Item',
  'NewItem',
  'Emphasis',
];

// Heading classes that start a new structural unit
const HEADING_CLASSES = ['ActHead1', 'ActHead2', 'ActHead3', 'ActHead4', 'ActHead5'];

/**
 * Split XHTML into sections based on ActHead5 elements.
 * Each section contains the heading and all content until the next heading.
 */
function splitIntoSections(html: string): Array<{
  sectionNum: string;
  sectionTitle: string;
  bodyHtml: string;
  partContext: string | undefined;
  position: number;
}> {
  const sections: Array<{
    sectionNum: string;
    sectionTitle: string;
    bodyHtml: string;
    partContext: string | undefined;
    position: number;
  }> = [];

  // Track current part/division/chapter context
  let currentPart: string | undefined;
  let currentDivision: string | undefined;

  // Match all headings (ActHead1-5 and variant New1-5/Heading1-9 used by older legislation)
  const headingRegex = /<p[^>]*class="((?:ActHead|New|Heading)[1-9])"[^>]*>([\s\S]*?)<\/p>/gi;
  const headings: Array<{ class: string; text: string; index: number; end: number }> = [];

  let match: RegExpExecArray | null;
  while ((match = headingRegex.exec(html)) !== null) {
    headings.push({
      class: match[1],
      text: stripHtml(match[2]),
      index: match.index,
      end: match.index + match[0].length,
    });
  }

  for (let i = 0; i < headings.length; i++) {
    const heading = headings[i];
    const headingText = heading.text;

    // Normalize heading level: ActHead5, New5, Heading5 all map to level 5
    const levelMatch = heading.class.match(/(\d)$/);
    const level = levelMatch ? parseInt(levelMatch[1]) : 0;

    // Update structural context
    if (level === 1) {
      currentPart = headingText;
      currentDivision = undefined;
    } else if (level === 2) {
      currentPart = headingText;
      currentDivision = undefined;
    } else if (level === 3) {
      currentDivision = headingText;
    } else if (level === 4) {
      currentDivision = headingText;
    } else if (level === 5 || level === 9) {
      // This is a section heading. Extract section number and title.
      // Formats: "6  Interpretation", "2A  Objects", "476.2  Meaning of..."
      // Also handles: "3LA  Person with knowledge..."
      const sectMatch = headingText.match(/^(\d+(?:\.\d+)*[A-Za-z]*)\s+(.*)/);
      if (!sectMatch) continue;

      const sectionNum = sectMatch[1];
      const sectionTitle = sectMatch[2].trim();

      // Get body content: everything from after this heading to the next heading of same or higher level
      const nextHeadingIdx = i + 1 < headings.length ? headings[i + 1].index : html.length;
      const bodyHtml = html.substring(heading.end, nextHeadingIdx);

      // Build part context
      const partContext = [currentPart, currentDivision].filter(Boolean).join(' > ') || undefined;

      sections.push({
        sectionNum,
        sectionTitle,
        bodyHtml,
        partContext,
        position: heading.index,
      });
    }
  }

  return sections;
}

/**
 * Extract text content from a section's body HTML.
 * Extracts only the meaningful content paragraphs, ignoring pure styling elements.
 */
function extractSectionContent(bodyHtml: string): string {
  const contentParts: string[] = [];

  // Extract all content-class paragraphs
  const classPattern = CONTENT_CLASSES.map(c => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const contentRegex = new RegExp(`<p[^>]*class="(${classPattern})"[^>]*>([\\s\\S]*?)<\\/p>`, 'gi');

  let match: RegExpExecArray | null;
  while ((match = contentRegex.exec(bodyHtml)) !== null) {
    const text = stripHtml(match[2]);
    if (text.length > 2) {
      contentParts.push(text);
    }
  }

  // If no content found via class matching, fall back to stripping all HTML
  if (contentParts.length === 0) {
    const fallback = stripHtml(bodyHtml);
    if (fallback.length > 10) {
      contentParts.push(fallback);
    }
  }

  return contentParts.join(' ').substring(0, 8000);
}

/**
 * Extract definitions from the body HTML of a definitions section.
 * Definitions use the "Definition" CSS class.
 */
function extractDefinitions(bodyHtml: string, provisionRef: string): ParsedDefinition[] {
  const definitions: ParsedDefinition[] = [];
  const defRegex = /<p[^>]*class="Definition"[^>]*>([\s\S]*?)<\/p>/gi;

  let match: RegExpExecArray | null;
  while ((match = defRegex.exec(bodyHtml)) !== null) {
    const fullText = stripHtml(match[1]);

    // Extract bold/italic terms - definitions typically start with the term in bold or italic
    const termMatch = match[1].match(/<(?:b|i|em|strong|span[^>]*font-style:\s*italic[^>]*)>([\s\S]*?)<\/(?:b|i|em|strong|span)>/i);
    if (termMatch) {
      const term = stripHtml(termMatch[1]).trim();
      if (term && term.length > 1 && term.length < 100) {
        definitions.push({
          term,
          definition: fullText.substring(0, 4000),
          source_provision: provisionRef,
        });
      }
    }
  }

  return definitions;
}

/**
 * Parse Australian legislation XHTML (from EPUB endpoint) into structured provisions.
 */
export function parseAustralianHtml(html: string, act: ActIndexEntry, versionInfo?: VersionInfo | null): ParsedAct {
  const provisions: ParsedProvision[] = [];
  const definitions: ParsedDefinition[] = [];
  const seenRefs = new Set<string>();

  // Split into sections
  const sections = splitIntoSections(html);

  for (const section of sections) {
    const provisionRef = `s${section.sectionNum}`;

    // Skip duplicates (schedule sections may repeat numbering)
    if (seenRefs.has(provisionRef)) continue;
    seenRefs.add(provisionRef);

    // Extract content
    const content = extractSectionContent(section.bodyHtml);
    if (content.length < 5) continue;

    provisions.push({
      provision_ref: provisionRef,
      chapter: section.partContext,
      section: section.sectionNum,
      title: section.sectionTitle,
      content,
    });

    // Extract definitions if this looks like a definitions section
    const lowerTitle = section.sectionTitle.toLowerCase();
    if (lowerTitle.includes('interpretation') || lowerTitle.includes('definition') || lowerTitle === 'definitions') {
      const defs = extractDefinitions(section.bodyHtml, provisionRef);
      definitions.push(...defs);
    }
  }

  // Determine dates
  const makingDate = versionInfo?.makingDate
    ? versionInfo.makingDate.split('T')[0]
    : `${act.year}-01-01`;

  const inForceDate = versionInfo?.start
    ? versionInfo.start.split('T')[0]
    : `${act.year}-01-01`;

  // Map API status to our schema
  const statusMap: Record<string, ParsedAct['status']> = {
    'InForce': 'in_force',
    'Ceased': 'repealed',
    'Repealed': 'repealed',
    'NeverEffective': 'repealed',
  };

  const status = versionInfo?.status
    ? (statusMap[versionInfo.status] ?? 'in_force')
    : act.status;

  // Build description
  const description = `${act.title} - Australian federal legislation. ` +
    `Register ID: ${versionInfo?.registerId ?? 'unknown'}. ` +
    `Compilation number: ${versionInfo?.compilationNumber ?? 'unknown'}. ` +
    `Source: Federal Register of Legislation (legislation.gov.au).`;

  return {
    id: act.id,
    type: 'statute',
    title: act.title,
    title_en: act.title, // Australian legislation is in English
    short_name: act.title,
    status,
    issued_date: makingDate,
    in_force_date: inForceDate,
    url: act.url,
    description,
    provisions,
    definitions,
  };
}

/**
 * Pre-configured list of key Australian federal acts to ingest.
 * These are the most important federal acts for cybersecurity, data protection,
 * and compliance use cases.
 *
 * titleId is the Federal Register of Legislation identifier used in the OData API.
 * url is the human-readable URL for reference.
 */
export const KEY_AUSTRALIAN_ACTS: ActIndexEntry[] = [
  {
    id: 'privacy-act-1988',
    title: 'Privacy Act 1988',
    year: 1988,
    titleId: 'C2004A03712',
    url: 'https://www.legislation.gov.au/C2004A03712/latest/text',
    status: 'in_force',
  },
  {
    id: 'soci-act-2018',
    title: 'Security of Critical Infrastructure Act 2018',
    year: 2018,
    titleId: 'C2018A00029',
    url: 'https://www.legislation.gov.au/C2018A00029/latest/text',
    status: 'in_force',
  },
  {
    id: 'cybercrime-act-2001',
    title: 'Cybercrime Act 2001',
    year: 2001,
    titleId: 'C2004A00937',
    url: 'https://www.legislation.gov.au/C2004A00937/latest/text',
    status: 'in_force',
  },
  {
    id: 'electronic-transactions-act-1999',
    title: 'Electronic Transactions Act 1999',
    year: 1999,
    titleId: 'C2004A00553',
    url: 'https://www.legislation.gov.au/C2004A00553/latest/text',
    status: 'in_force',
  },
  {
    id: 'telecommunications-act-1997',
    title: 'Telecommunications Act 1997',
    year: 1997,
    titleId: 'C2004A05145',
    url: 'https://www.legislation.gov.au/C2004A05145/latest/text',
    status: 'in_force',
  },
  {
    id: 'criminal-code-act-1995',
    title: 'Criminal Code Act 1995',
    year: 1995,
    titleId: 'C2004A04868',
    url: 'https://www.legislation.gov.au/C2004A04868/latest/text',
    status: 'in_force',
  },
  {
    id: 'spam-act-2003',
    title: 'Spam Act 2003',
    year: 2003,
    titleId: 'C2004A01214',
    url: 'https://www.legislation.gov.au/C2004A01214/latest/text',
    status: 'in_force',
  },
  {
    id: 'surveillance-devices-act-2004',
    title: 'Surveillance Devices Act 2004',
    year: 2004,
    titleId: 'C2004A01387',
    url: 'https://www.legislation.gov.au/C2004A01387/latest/text',
    status: 'in_force',
  },
  {
    id: 'corporations-act-2001',
    title: 'Corporations Act 2001',
    year: 2001,
    titleId: 'C2004A00818',
    url: 'https://www.legislation.gov.au/C2004A00818/latest/text',
    status: 'in_force',
  },
  {
    id: 'cca-2010',
    title: 'Competition and Consumer Act 2010',
    year: 2010,
    titleId: 'C2004A00109',
    url: 'https://www.legislation.gov.au/C2004A00109/latest/text',
    status: 'in_force',
  },
];
