import { useMemo, useState } from 'react';
import { CANCER_TYPES, PRICE_REFERENCE_POINTS } from '../lib/market-data.js';

type CancerInputs = { penetration: number; testsPerYear: number; years: number; price: number };

// Working-assumption defaults per cancer type (not sourced reference data —
// see PRICE_REFERENCE_POINTS and the per-cancer notes below the table for
// the actual cited figures; these are just where the calculator starts).
const DEFAULT_INPUTS: Record<string, CancerInputs> = {
  colorectal: { penetration: 30, testsPerYear: 2.75, years: 4, price: 1500 },
  breast: { penetration: 10, testsPerYear: 4, years: 5, price: 1500 },
  bladder: { penetration: 10, testsPerYear: 6, years: 1, price: 1500 },
};

function formatNumber(n: number) {
  return Math.round(n).toLocaleString('en-US');
}

function formatCurrency(n: number) {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  return `$${formatNumber(n)}`;
}

export default function MarketSizingCalculator() {
  const [perCancer, setPerCancer] = useState<Record<string, CancerInputs>>(() =>
    Object.fromEntries(CANCER_TYPES.map((c) => [c.slug, { ...DEFAULT_INPUTS[c.slug] }]))
  );

  function updateCancer(slug: string, field: keyof CancerInputs, value: number) {
    setPerCancer((prev) => ({ ...prev, [slug]: { ...prev[slug], [field]: value } }));
  }

  const columns = useMemo(() => {
    return CANCER_TYPES.map((cancer) => {
      const inputs = perCancer[cancer.slug];
      const diagnoses = cancer.incidence.us + cancer.incidence.intl;
      const addressable = diagnoses * (inputs.penetration / 100);
      const testsYr = addressable * inputs.testsPerYear;
      const cohortRevenue = testsYr * inputs.price;
      const runRateRevenue = cohortRevenue * inputs.years;
      return { cancer, inputs, diagnoses, addressable, testsYr, cohortRevenue, runRateRevenue };
    });
  }, [perCancer]);

  const total = useMemo(() => {
    const diagnoses = columns.reduce((s, c) => s + c.diagnoses, 0);
    const addressable = columns.reduce((s, c) => s + c.addressable, 0);
    const testsYr = columns.reduce((s, c) => s + c.testsYr, 0);
    const cohortRevenue = columns.reduce((s, c) => s + c.cohortRevenue, 0);
    const runRateRevenue = columns.reduce((s, c) => s + c.runRateRevenue, 0);
    // Blended inputs for the Total column are derived from each cancer's
    // chosen values, not entered independently — e.g. blended price is
    // total revenue / total tests, which collapses to each column's own
    // price when there's only one column and to a revenue-weighted average
    // across columns otherwise.
    return {
      diagnoses,
      addressable,
      testsYr,
      cohortRevenue,
      runRateRevenue,
      blendedPenetration: diagnoses > 0 ? (addressable / diagnoses) * 100 : 0,
      blendedTestsPerYear: addressable > 0 ? testsYr / addressable : 0,
      blendedPrice: testsYr > 0 ? cohortRevenue / testsYr : 0,
      blendedYears: cohortRevenue > 0 ? runRateRevenue / cohortRevenue : 0,
    };
  }, [columns]);

  return (
    <div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-medium text-slate-500">Newly diagnosed patients / year (all 3 cancers, both regions)</p>
          <p className="mt-1 text-2xl font-semibold text-slate-900">{formatNumber(total.diagnoses)}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-medium text-slate-500">Revenue from one diagnosis-year cohort</p>
          <p className="mt-1 text-2xl font-semibold text-slate-900">{formatCurrency(total.cohortRevenue)}</p>
        </div>
        <div className="rounded-xl border border-accent-200 bg-accent-50 p-5 shadow-sm">
          <p className="text-xs font-medium text-accent-700">Projected run-rate revenue</p>
          <p className="mt-1 text-2xl font-semibold text-accent-600">{formatCurrency(total.runRateRevenue)}</p>
        </div>
      </div>

      <div className="mt-6 overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              <th className="px-4 py-2 font-medium">&nbsp;</th>
              {columns.map((c) => (
                <th key={c.cancer.slug} className="px-4 py-2 font-medium">{c.cancer.label}</th>
              ))}
              <th className="px-4 py-2 font-medium">Total</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-t border-slate-100">
              <td className="px-4 py-2 text-slate-500">Market penetration (%)</td>
              {columns.map((c) => (
                <td key={c.cancer.slug} className="px-4 py-2">
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step={0.5}
                    value={c.inputs.penetration}
                    onChange={(e) => updateCancer(c.cancer.slug, 'penetration', Number(e.target.value))}
                    className="w-24 rounded-lg border border-slate-300 px-2 py-1 text-sm focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-500/30"
                  />
                </td>
              ))}
              <td className="px-4 py-2 text-slate-500 italic">{total.blendedPenetration.toFixed(1)}% (blended)</td>
            </tr>

            <tr className="border-t border-slate-100">
              <td className="px-4 py-2 text-slate-500">Avg. years tested</td>
              {columns.map((c) => (
                <td key={c.cancer.slug} className="px-4 py-2">
                  <input
                    type="number"
                    min={0}
                    step={0.5}
                    value={c.inputs.years}
                    onChange={(e) => updateCancer(c.cancer.slug, 'years', Number(e.target.value))}
                    className="w-24 rounded-lg border border-slate-300 px-2 py-1 text-sm focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-500/30"
                  />
                </td>
              ))}
              <td className="px-4 py-2 text-slate-500 italic">{total.blendedYears.toFixed(2)} yrs (blended)</td>
            </tr>

            <tr className="border-t border-slate-100">
              <td className="px-4 py-2 text-slate-500">Avg. price paid / test ($)</td>
              {columns.map((c) => (
                <td key={c.cancer.slug} className="px-4 py-2">
                  <input
                    type="number"
                    min={0}
                    step={25}
                    value={c.inputs.price}
                    onChange={(e) => updateCancer(c.cancer.slug, 'price', Number(e.target.value))}
                    className="w-24 rounded-lg border border-slate-300 px-2 py-1 text-sm focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-500/30"
                  />
                  <div className="mt-1 flex flex-col gap-0.5">
                    {PRICE_REFERENCE_POINTS.map((p) => (
                      <button
                        key={p.label}
                        type="button"
                        title={p.label}
                        onClick={() => updateCancer(c.cancer.slug, 'price', p.value)}
                        className="w-fit rounded-full border border-slate-200 px-1.5 py-0.5 text-[10px] text-slate-500 transition-colors hover:bg-slate-50"
                      >
                        ${formatNumber(p.value)}
                      </button>
                    ))}
                  </div>
                </td>
              ))}
              <td className="px-4 py-2 text-slate-500 italic">${formatNumber(total.blendedPrice)} (blended)</td>
            </tr>

            <tr className="border-t border-slate-200">
              <td className="px-4 py-2 text-slate-500">New diagnoses / yr</td>
              {columns.map((c) => (
                <td key={c.cancer.slug} className="px-4 py-2 text-slate-700">
                  {formatNumber(c.diagnoses)}
                  <span className="block text-[11px] text-slate-400">
                    US {formatNumber(c.cancer.incidence.us)} · Intl {formatNumber(c.cancer.incidence.intl)}
                  </span>
                </td>
              ))}
              <td className="px-4 py-2 font-medium text-slate-900">{formatNumber(total.diagnoses)}</td>
            </tr>

            <tr className="border-t border-slate-100">
              <td className="px-4 py-2 text-slate-500">Addressable patients</td>
              {columns.map((c) => (
                <td key={c.cancer.slug} className="px-4 py-2 text-slate-700">{formatNumber(c.addressable)}</td>
              ))}
              <td className="px-4 py-2 font-medium text-slate-900">{formatNumber(total.addressable)}</td>
            </tr>

            <tr className="border-t border-slate-100">
              <td className="px-4 py-2 text-slate-500">Avg. tests / patient / yr</td>
              {columns.map((c) => (
                <td key={c.cancer.slug} className="px-4 py-2">
                  <input
                    type="number"
                    min={0}
                    step={0.5}
                    value={c.inputs.testsPerYear}
                    onChange={(e) => updateCancer(c.cancer.slug, 'testsPerYear', Number(e.target.value))}
                    className="w-24 rounded-lg border border-slate-300 px-2 py-1 text-sm focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-500/30"
                  />
                </td>
              ))}
              <td className="px-4 py-2 text-slate-500 italic">{total.blendedTestsPerYear.toFixed(2)} (blended)</td>
            </tr>

            <tr className="border-t border-slate-100">
              <td className="px-4 py-2 text-slate-500">Tests / yr</td>
              {columns.map((c) => (
                <td key={c.cancer.slug} className="px-4 py-2 text-slate-700">{formatNumber(c.testsYr)}</td>
              ))}
              <td className="px-4 py-2 font-medium text-slate-900">{formatNumber(total.testsYr)}</td>
            </tr>

            <tr className="border-t border-slate-100">
              <td className="px-4 py-2 text-slate-500">Cohort revenue</td>
              {columns.map((c) => (
                <td key={c.cancer.slug} className="px-4 py-2 text-slate-700">{formatCurrency(c.cohortRevenue)}</td>
              ))}
              <td className="px-4 py-2 font-medium text-slate-900">{formatCurrency(total.cohortRevenue)}</td>
            </tr>

            <tr className="border-t border-slate-200 bg-accent-50/50 font-medium">
              <td className="px-4 py-2 text-slate-900">Total annual revenue (run-rate)</td>
              {columns.map((c) => (
                <td key={c.cancer.slug} className="px-4 py-2 text-accent-700">{formatCurrency(c.runRateRevenue)}</td>
              ))}
              <td className="px-4 py-2 text-accent-700">{formatCurrency(total.runRateRevenue)}</td>
            </tr>
          </tbody>
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
