// Shared product definitions used by every ingestion script and by the
// classifier prompt. Keep in sync with the `products` table (sql/001_init_schema.sql).
export const PRODUCTS = [
  {
    id: 1,
    slug: 'signatera',
    displayName: 'Signatera',
    searchTerms: ['Signatera', 'Signatera test', 'Natera Signatera'],
  },
  {
    id: 2,
    slug: 'guardant360',
    displayName: 'Guardant360',
    searchTerms: ['Guardant360', 'Guardant 360', 'Guardant Health'],
  },
  {
    id: 3,
    slug: 'foundationone_liquid',
    displayName: 'FoundationOne Liquid',
    searchTerms: ['FoundationOne Liquid', 'FoundationOneLiquid', 'Foundation One Liquid CDx'],
  },
];

// Disease-specific subreddits where MRD/ctDNA test discussion actually lives,
// vs. general site-wide search which mostly surfaces news reposts.
export const TARGET_SUBREDDITS = [
  'cancer',
  'BreastCancer',
  'ColonCancer',
  'coloncancer',
  'prostatecancer',
  'ovariancancer',
  'lymphoma',
  'lungcancer',
  'braincancer',
  'kidneycancer',
  'pancreaticcancer',
  'Living_with_MBC',
];

export const MEDICAL_NEWS_ALLOWLIST = [
  'onclive.com',
  'medscape.com',
  'healio.com',
  'targetedonc.com',
  'cancertherapyadvisor.com',
];

// Public (no login required to read) patient-community forums — same idea
// as TARGET_SUBREDDITS, just outside Reddit. Scanned via a domain-scoped web
// search, same pattern as MEDICAL_NEWS_ALLOWLIST.
export const PATIENT_FORUM_ALLOWLIST = [
  'connect.mayoclinic.org',
  'breastcancer.org',
  'smartpatients.com',
  'cancercompass.com',
  'healthunlocked.com',
  'csn.cancer.org',
];

// Sources that either require a login, or whose ToS prohibits scraping.
// Enforced as a hard blocklist regardless of what web search surfaces.
export const SOURCE_BLOCKLIST = [
  'doximity.com',
  'sermo.com',
  'inspire.com',
  'patientslikeme.com',
  'facebook.com',
  'quora.com',
];

export function isBlockedUrl(url) {
  const host = new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  return SOURCE_BLOCKLIST.some((blocked) => host === blocked || host.endsWith(`.${blocked}`));
}
