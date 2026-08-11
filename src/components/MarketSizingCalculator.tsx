import { useMemo, useState } from 'react';
import { CANCER_TYPES, DEFAULT_PRICE_PER_TEST, DEFAULT_YEARS_TESTED, PRICE_REFERENCE_POINTS } from '../lib/market-data.js';

const REGIONS = [
  { key: 'us', label: 'United States' },
  { key: 'intl', label: 'Western Europe + Japan' },
] as const;

function formatNumber(n: number) {
  return Math.round(n).toLocaleString('en-US');
}

function formatCurrency(n: number) {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  return `$${formatNumber(n)}`;
}

export default function MarketSizingCalculator() {
  const [penetration, setPenetration] = useState(10);
  const [testsPerYear, setTestsPerYear] = useState(4);
  const [pricePerTest, setPricePerTest] = useState(DEFAULT_PRICE_PER_TEST);
  const [yearsTested, setYearsTested] = useState(DEFAULT_YEARS_TESTED);

  const rows = useMemo(() => {
    return CANCER_TYPES.flatMap((cancer) =>
      REGIONS.map((region) => {
        const incidentPatients = cancer.incidence[region.key];
        const addressablePatients = incidentPatients * (penetration / 100);
        const annualTests = addressablePatients * testsPerYear;
        const cohortRevenue = annualTests * pricePerTest;
        // Run-rate: at steady state, patients from each of the last
        // `yearsTested` diagnosis-year cohorts are still being actively
        // monitored simultaneously, so the active testing population — and
        // the revenue it generates — scales with that overlap.
        const runRateRevenue = cohortRevenue * yearsTested;
        return { cancer, region, incidentPatients, addressablePatients, annualTests, cohortRevenue, runRateRevenue };
      })
    );
  }, [penetration, testsPerYear, pricePerTest, yearsTested]);

  const totalCohortRevenue = rows.reduce((sum, r) => sum + r.cohortRevenue, 0);
  const totalRunRateRevenue = rows.reduce((sum, r) => sum + r.runRateRevenue, 0);
  const totalIncident = rows.reduce((sum, r) => sum + r.incidentPatients, 0);

  return (
    <div>
      <div className="grid grid-cols-1 gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:grid-cols-2 lg:grid-cols-4">
        <label className="block">
          <span className="text-xs font-medium text-slate-500">Market penetration (%)</span>
          <input
            type="number"
            min={0}
            max={100}
            step={0.5}
            value={penetration}
            onChange={(e) => setPenetration(Number(e.target.value))}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-500/30"
          />
          <span className="mt-1 block text-xs text-slate-400">Share of newly diagnosed patients who get tested</span>
        </label>

        <label className="block">
          <span className="text-xs font-medium text-slate-500">Avg. Signatera tests / patient / year</span>
          <input
            type="number"
            min={0}
            step={0.5}
            value={testsPerYear}
            onChange={(e) => setTestsPerYear(Number(e.target.value))}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-500/30"
          />
          <span className="mt-1 block text-xs text-slate-400">Serial monitoring means more than one test per patient per year</span>
        </label>

        <label className="block">
          <span className="text-xs font-medium text-slate-500">Avg. price paid / test ($)</span>
          <input
            type="number"
            min={0}
            step={25}
            value={pricePerTest}
            onChange={(e) => setPricePerTest(Number(e.target.value))}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-500/30"
          />
          <div className="mt-1 flex flex-wrap gap-1">
            {PRICE_REFERENCE_POINTS.map((p) => (
              <button
                key={p.label}
                type="button"
                onClick={() => setPricePerTest(p.value)}
                className="rounded-full border border-slate-200 px-2 py-0.5 text-[11px] text-slate-500 transition-colors hover:bg-slate-50"
              >
                {p.label}: ${formatNumber(p.value)}
              </button>
            ))}
          </div>
        </label>

        <label className="block">
          <span className="text-xs font-medium text-slate-500">Avg. years tested per patient</span>
          <input
            type="number"
            min={0}
            step={0.5}
            value={yearsTested}
            onChange={(e) => setYearsTested(Number(e.target.value))}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-500/30"
          />
          <span className="mt-1 block text-xs text-slate-400">
            Default is BESPOKE's 2-year CRC follow-up window — how long each diagnosis cohort keeps getting tested, which is what turns cohort revenue into steady-state run rate
          </span>
        </label>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-medium text-slate-500">Newly diagnosed patients / year (all 3 cancers, both regions)</p>
          <p className="mt-1 text-2xl font-semibold text-slate-900">{formatNumber(totalIncident)}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-medium text-slate-500">Revenue from one diagnosis-year cohort</p>
          <p className="mt-1 text-2xl font-semibold text-slate-900">{formatCurrency(totalCohortRevenue)}</p>
        </div>
        <div className="rounded-xl border border-accent-200 bg-accent-50 p-5 shadow-sm">
          <p className="text-xs font-medium text-accent-700">Projected run-rate revenue ({yearsTested}-yr steady state)</p>
          <p className="mt-1 text-2xl font-semibold text-accent-600">{formatCurrency(totalRunRateRevenue)}</p>
        </div>
      </div>

      <div className="mt-6 overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              <th className="px-4 py-2 font-medium">Cancer type</th>
              <th className="px-4 py-2 font-medium">Region</th>
              <th className="px-4 py-2 font-medium">New diagnoses / yr</th>
              <th className="px-4 py-2 font-medium">Addressable patients</th>
              <th className="px-4 py-2 font-medium">Tests / yr</th>
              <th className="px-4 py-2 font-medium">Cohort revenue</th>
              <th className="px-4 py-2 font-medium">Run-rate revenue</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.cancer.slug}-${r.region.key}`} className="border-t border-slate-100">
                <td className="px-4 py-2 text-slate-700">{r.cancer.label}</td>
                <td className="px-4 py-2 text-slate-700">{r.region.label}</td>
                <td className="px-4 py-2 text-slate-700">{formatNumber(r.incidentPatients)}</td>
                <td className="px-4 py-2 text-slate-700">{formatNumber(r.addressablePatients)}</td>
                <td className="px-4 py-2 text-slate-700">{formatNumber(r.annualTests)}</td>
                <td className="px-4 py-2 text-slate-700">{formatCurrency(r.cohortRevenue)}</td>
                <td className="px-4 py-2 font-medium text-slate-900">{formatCurrency(r.runRateRevenue)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-slate-200 bg-slate-50 font-medium">
              <td className="px-4 py-2 text-slate-900" colSpan={5}>
                Total
              </td>
              <td className="px-4 py-2 text-slate-900">{formatCurrency(totalCohortRevenue)}</td>
              <td className="px-4 py-2 text-slate-900">{formatCurrency(totalRunRateRevenue)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="mt-4 space-y-1 text-xs text-slate-500">
        {CANCER_TYPES.map((c) => (
          <p key={c.slug}>
            <span className="font-medium text-slate-600">{c.label}:</span> {c.note}
          </p>
        ))}
      </div>
    </div>
  );
}
