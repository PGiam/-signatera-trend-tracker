// Static reference data for the Market Sizing tab. Unlike everything else in
// this app, this isn't pulled by the ingestion pipeline — annual cancer
// incidence and Signatera's reimbursement rate change slowly enough that
// hand-updating this file every so often (re-check sources, bump the
// numbers) is more appropriate than a scraper.
//
// Cancer selection: the three cancer types chosen are Signatera's most
// established indications by clinical evidence and Medicare coverage —
// colorectal (170+ publications, longest track record, Medicare-covered
// since 2019), breast (Medicare-covered for neoadjuvant + adjuvant Stage
// IIb+), and muscle-invasive bladder (Medicare-covered, and the subject of
// real mentions already in this project's own data — the Japan PMDA
// companion-diagnostic submission). Ovarian cancer is also Medicare-covered
// but has materially less publication volume and is excluded here.
//
// "Western Europe" uses GLOBOCAN's own region definition (Austria, Belgium,
// France, Germany, Liechtenstein, Luxembourg, Monaco, Netherlands,
// Switzerland) — not the common pharma "EU5" shorthand (which would also
// include the UK, Italy, and Spain) — because that's the actual named
// region in the source data. Worth knowing if you're comparing against an
// EU5-based model from elsewhere.

export const CANCER_TYPES = [
  {
    slug: 'colorectal',
    label: 'Colorectal cancer',
    note: "Signatera's most established indication — longest track record, most published evidence.",
    incidence: {
      us: 158850, // 108,860 colon + 49,990 rectal — ACS 2026 estimate
      intl: 295893, // Western Europe 150,137 + Japan 145,756 — GLOBOCAN 2022
    },
  },
  {
    slug: 'breast',
    label: 'Breast cancer',
    note: 'Invasive cases only (excludes DCIS); Medicare-covered for neoadjuvant (any stage) and adjuvant/recurrence-monitoring (Stage IIb+).',
    incidence: {
      us: 324580, // 321,910 female + 2,670 male, invasive — ACS 2026 estimate
      intl: 272029, // Western Europe 180,113 (female) + Japan 91,916 (female) — GLOBOCAN 2022
    },
  },
  {
    slug: 'bladder',
    label: 'Muscle-invasive bladder cancer',
    note: 'Estimated as 25% of total bladder cancer incidence (standard MIBC share at diagnosis); Signatera is Medicare-covered for adjuvant/recurrence-monitoring in this indication.',
    incidence: {
      us: 21133, // 84,530 total bladder (ACS 2026) x 25%
      intl: 23941, // (Western Europe ~58,806 + Japan 36,957 total bladder) x 25%
    },
  },
];

// Reference price points shown as quick-select buttons next to the price
// input. 1275 is Natera's own disclosed blended average selling price per
// Signatera test (all payers combined — Medicare, commercial, self-pay,
// international) from Q2 2026 investor materials — the realistic "what
// Signatera actually gets paid" figure, not the Medicare-only list price.
export const PRICE_REFERENCE_POINTS = [
  { label: 'Natera Q2 2026 blended ASP', value: 1275 },
  { label: "Natera's long-term ASP target", value: 2000 },
  { label: 'Medicare fee schedule (CPT/PLA 0340U, list price)', value: 3920 },
];

// BESPOKE (Natera's own real-world observational study for colorectal
// cancer) found a 2-year window of MRD-testing follow-up per patient — cited
// as context for the "years tested" input; some NCCN surveillance windows
// for these cancers run longer (up to ~5 years).

export const SOURCES = [
  { label: 'BESPOKE CRC study follow-up duration (Natera / Targeted Oncology)', url: 'https://www.targetedonc.com/view/breakthrough-device-designations-granted-to-novel-mrd-test-signatera' },
  { label: 'ACS Colorectal Cancer Facts & Figures 2026', url: 'https://www.cancer.org/research/cancer-facts-statistics/colorectal-cancer-facts-figures.html' },
  { label: 'ACS Cancer Facts & Figures 2026 (breast, bladder)', url: 'https://www.cancer.org/research/cancer-facts-statistics/all-cancer-facts-figures/2026-cancer-facts-figures.html' },
  { label: 'GLOBOCAN 2022 — Cancer burden in Europe (BMC Cancer)', url: 'https://link.springer.com/article/10.1186/s12885-025-13862-1' },
  { label: 'GLOBOCAN 2022 colorectal/breast country data (WCRF)', url: 'https://www.wcrf.org/preventing-cancer/cancer-statistics/colorectal-cancer-statistics/' },
  { label: 'Natera Q2 2026 earnings materials (Signatera ASP)', url: 'https://www.sec.gov/Archives/edgar/data/0001604821/000160482126000015/ntra-20260630xex991.htm' },
  { label: 'CPT 0340U Medicare fee schedule', url: 'https://www.discoveriesinhealthpolicy.com/2025/01/brief-blog-cms-revises-fee-schedule.html' },
];
