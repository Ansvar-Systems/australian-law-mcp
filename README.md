# Australian Law MCP

Australian federal law database for the [Model Context Protocol](https://modelcontextprotocol.io/), covering privacy, cybersecurity, critical infrastructure, corporations, consumer law, electronic transactions, and cybercrime legislation with full-text search.

**MCP Registry:** `eu.ansvar/australian-law-mcp`
**npm:** `@ansvar/australian-law-mcp`
**License:** Apache-2.0

---

## Deployment Tier

**MEDIUM** -- dual tier, free database bundled in npm package.

| Tier | Platform | Database | Content |
|------|----------|----------|---------|
| **Free** | Vercel (Hobby) / npm (stdio) | Statutes only (~150-200 MB) | Core Commonwealth legislation, FTS search, EU/international cross-references |
| **Professional** | Azure Container Apps / Docker / Local | Full database (~800 MB - 1 GB) | + Case law (via AustLII), explanatory memoranda, regulatory guidance |

The full database is larger due to case law from AustLII and supplementary materials. The free tier contains all Commonwealth Acts and regulations from the Federal Register of Legislation.

---

## Data Sources

| Source | Authority | Method | Update Frequency | License | Coverage |
|--------|-----------|--------|-----------------|---------|----------|
| [Federal Register of Legislation](https://www.legislation.gov.au) | Australian Government, Office of Parliamentary Counsel | XML Download | Weekly | CC BY 4.0 | All Commonwealth Acts, legislative instruments, regulations |
| [AustLII](https://www.austlii.edu.au) | UTS / UNSW Sydney | HTML Scrape | Weekly | AustLII Terms of Use | Case law, state legislation, treaties |

> Full provenance metadata: [`sources.yml`](./sources.yml)

---

## Quick Start

### Claude Desktop / Cursor (stdio)

```json
{
  "mcpServers": {
    "australian-law": {
      "command": "npx",
      "args": ["-y", "@ansvar/australian-law-mcp"]
    }
  }
}
```

### Vercel Streamable HTTP (ChatGPT / Claude.ai)

Once deployed, the public endpoint will be available at:

```
https://australian-law-mcp.vercel.app/api/mcp
```

---

## Tools

| Tool | Description | Free Tier | Professional |
|------|-------------|-----------|-------------|
| `get_provision` | Retrieve a specific section/article from an Australian Act | Yes | Yes |
| `search_legislation` | Full-text search across all Commonwealth legislation | Yes | Yes |
| `list_acts` | List all available Acts with metadata | Yes | Yes |
| `get_act_structure` | Get table of contents / structure of an Act | Yes | Yes |
| `get_provision_eu_basis` | Cross-reference Australian law to EU/international equivalents | Yes | Yes |
| `search_case_law` | Search case law from Australian courts | No (upgrade) | Yes |
| `get_explanatory_memoranda` | Retrieve explanatory memoranda for Acts | No (upgrade) | Yes |

---

## Key Legislation Covered

| Act | Year | Domain | Key Topics |
|-----|------|--------|------------|
| **Privacy Act** | 1988 | Data Protection | Australian Privacy Principles (APPs), personal information, data breach notification |
| **Security of Critical Infrastructure Act (SOCI)** | 2018 | Critical Infrastructure | Critical infrastructure sectors, positive security obligations, incident reporting |
| **Telecommunications Act** | 1997 | Communications | Carrier obligations, interception, data retention |
| **Corporations Act** | 2001 | Corporate Law | Company regulation, financial services, market conduct |
| **Competition and Consumer Act** | 2010 | Consumer Protection | Australian Consumer Law (ACL), anti-competitive conduct |
| **Cybercrime Act** | 2001 | Cybercrime | Computer offences, unauthorised access, data interference |
| **Electronic Transactions Act** | 1999 | Digital | Electronic signatures, electronic contracts, validity |

---

## Database Estimates

| Component | Free Tier | Full (Professional) |
|-----------|-----------|---------------------|
| Commonwealth Acts | ~150-200 MB | ~150-200 MB |
| Case law (AustLII) | -- | ~400-500 MB |
| Explanatory memoranda | -- | ~100-200 MB |
| Cross-references & metadata | ~5 MB | ~15 MB |
| **Total** | **~150-200 MB** | **~800 MB - 1 GB** |

**Delivery strategy:** Free-tier DB bundled in npm package (Strategy A -- fits within Vercel 250 MB function limit). If final size exceeds 250 MB after ingestion, switch to Strategy B (runtime download from GitHub Releases).

---

## Development

```bash
# Clone the repository
git clone https://github.com/Ansvar-Systems/australian-law-mcp.git
cd australian-law-mcp

# Install dependencies
npm install

# Build
npm run build

# Run tests
npm test

# Run contract tests
npm run test:contract

# Build database (requires raw data in data/ directory)
npm run build:db

# Build free-tier database
npm run build:db:free

# Run drift detection
npm run drift:detect

# Full validation
npm run validate
```

---

## Architecture

```
australian-law-mcp/
├── .github/
│   ├── workflows/
│   │   ├── ci.yml                    # Test + lint + security scan
│   │   ├── publish.yml               # npm publish on version tags
│   │   ├── check-source-updates.yml  # Data freshness monitoring
│   │   └── drift-detect.yml          # Upstream drift detection
│   ├── SECURITY.md
│   ├── SECURITY-SETUP.md
│   └── ISSUE_TEMPLATE/
│       └── data-error.md
├── data/
│   └── .gitkeep
├── fixtures/
│   ├── golden-tests.json             # 12 contract tests
│   ├── golden-hashes.json            # 6 drift detection anchors
│   └── README.md
├── scripts/
│   ├── build-db.ts
│   ├── build-db-free.ts
│   ├── ingest.ts
│   ├── drift-detect.ts
│   └── check-source-updates.ts
├── src/
│   ├── server.ts
│   ├── db.ts
│   └── tools/
│       ├── get-provision.ts
│       ├── search-legislation.ts
│       ├── list-acts.ts
│       ├── get-act-structure.ts
│       ├── get-provision-eu-basis.ts
│       ├── search-case-law.ts
│       └── get-explanatory-memoranda.ts
├── __tests__/
│   ├── unit/
│   ├── contract/
│   │   └── golden.test.ts
│   └── integration/
├── sources.yml
├── server.json
├── package.json
├── tsconfig.json
├── CHANGELOG.md
├── LICENSE
└── README.md
```

---

## Related Documents

- [MCP Quality Standard](../../mcp-quality-standard.md) -- quality requirements for all Ansvar MCPs
- [MCP Infrastructure Blueprint](../../mcp-infrastructure-blueprint.md) -- infrastructure implementation templates
- [MCP Deployment Tiers](../../mcp-deployment-tiers.md) -- free vs. professional tier strategy
- [MCP Server Registry](../../mcp-server-registry.md) -- operational registry of all MCPs
- [MCP Remote Access](../../mcp-remote-access.md) -- public Vercel endpoint URLs

---

## Security

Report vulnerabilities to **security@ansvar.eu** (48-hour acknowledgment SLA).

See [SECURITY.md](.github/SECURITY.md) for full disclosure policy.

---

**Maintained by:** Ansvar Systems Engineering
**Contact:** hello@ansvar.eu
