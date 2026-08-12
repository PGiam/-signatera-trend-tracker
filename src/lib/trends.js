const PATIENT_TYPES = ['patient', 'caregiver'];
const DOCTOR_TYPES = ['doctor', 'healthcare_professional'];

export function authorTypesForView(view) {
  if (view === 'patient') return PATIENT_TYPES;
  if (view === 'doctor') return DOCTOR_TYPES;
  return null; // null = no filter, all author types
}

/**
 * Collapses rollup rows (one per product_id x author_type x period) into one
 * row per product_id x period, respecting an optional author_type filter.
 * Returns a Map<periodKey, Map<product_id, {mentionCount, sentimentSum}>>.
 */
function collapseByPeriod(rows, periodKeyFn, allowedAuthorTypes) {
  const byPeriod = new Map();
  for (const row of rows) {
    if (allowedAuthorTypes && !allowedAuthorTypes.includes(row.author_type)) continue;
    const period = periodKeyFn(row);
    if (!byPeriod.has(period)) byPeriod.set(period, new Map());
    const byProduct = byPeriod.get(period);
    if (!byProduct.has(row.product_id)) {
      byProduct.set(row.product_id, { mentionCount: 0, sentimentSum: 0 });
    }
    const agg = byProduct.get(row.product_id);
    const count = Number(row.mention_count) || 0;
    agg.mentionCount += count;
    agg.sentimentSum += (Number(row.avg_sentiment_score) || 0) * count;
  }
  return byPeriod;
}

export function collapseWeekly(rows, allowedAuthorTypes) {
  return collapseByPeriod(rows, (row) => row.week_start, allowedAuthorTypes);
}

// From mention_rollups_daily rows (rollup_date is a plain 'YYYY-MM-DD'
// string from Postgres) — buckets into calendar months.
export function collapseMonthly(rows, allowedAuthorTypes) {
  return collapseByPeriod(rows, (row) => row.rollup_date.slice(0, 7), allowedAuthorTypes);
}

export function buildChartSeries(byWeek, productsBySlug) {
  const weeks = [...byWeek.keys()].sort();
  const volume = [];
  const sentiment = [];
  for (const week of weeks) {
    const volumeRow = { date: week };
    const sentimentRow = { date: week };
    for (const [slug, product] of Object.entries(productsBySlug)) {
      const agg = byWeek.get(week)?.get(product.id);
      volumeRow[slug] = agg?.mentionCount ?? 0;
      sentimentRow[slug] = agg && agg.mentionCount > 0 ? Number((agg.sentimentSum / agg.mentionCount).toFixed(2)) : null;
    }
    volume.push(volumeRow);
    sentiment.push(sentimentRow);
  }
  return { volume, sentiment, weeks };
}

/**
 * Cumulative (expanding-window) weighted average sentiment per period — at
 * each period, averages every mention from the start of history through
 * that period, not just that period's own mentions. Smooths out
 * week-to-week/month-to-month noise (especially early on when volume per
 * period is low) in exchange for reacting more slowly to real shifts.
 */
export function buildCumulativeSentimentSeries(byPeriod, productsBySlug) {
  const periods = [...byPeriod.keys()].sort();
  const running = {};
  for (const product of Object.values(productsBySlug)) {
    running[product.id] = { count: 0, sum: 0 };
  }

  const sentiment = [];
  for (const period of periods) {
    const row = { date: period };
    for (const [slug, product] of Object.entries(productsBySlug)) {
      const agg = byPeriod.get(period)?.get(product.id);
      if (agg && agg.mentionCount > 0) {
        running[product.id].count += agg.mentionCount;
        running[product.id].sum += agg.sentimentSum;
      }
      const r = running[product.id];
      row[slug] = r.count > 0 ? Number((r.sum / r.count).toFixed(2)) : null;
    }
    sentiment.push(row);
  }
  return { sentiment, periods };
}

export function computeWowStats(byWeek, weeks, productsBySlug) {
  const lastWeek = weeks[weeks.length - 1];
  const priorWeek = weeks[weeks.length - 2];
  const stats = {};
  for (const [slug, product] of Object.entries(productsBySlug)) {
    const last = byWeek.get(lastWeek)?.get(product.id) ?? { mentionCount: 0, sentimentSum: 0 };
    const prior = priorWeek ? byWeek.get(priorWeek)?.get(product.id) ?? { mentionCount: 0, sentimentSum: 0 } : null;

    const lastAvgSentiment = last.mentionCount > 0 ? last.sentimentSum / last.mentionCount : null;
    const priorAvgSentiment = prior && prior.mentionCount > 0 ? prior.sentimentSum / prior.mentionCount : null;

    let volumeDeltaPct = null;
    if (prior && prior.mentionCount > 0) {
      volumeDeltaPct = ((last.mentionCount - prior.mentionCount) / prior.mentionCount) * 100;
    }

    stats[slug] = {
      mentionCount: last.mentionCount,
      volumeDeltaPct,
      avgSentiment: lastAvgSentiment,
      sentimentDelta: lastAvgSentiment != null && priorAvgSentiment != null ? lastAvgSentiment - priorAvgSentiment : null,
    };
  }
  return stats;
}

export function computeShareOfVoice(byWeek, weeks, productsBySlug) {
  const lastWeek = weeks[weeks.length - 1];
  const weekData = byWeek.get(lastWeek);
  if (!weekData) return {};
  let total = 0;
  for (const agg of weekData.values()) total += agg.mentionCount;
  const shares = {};
  for (const [slug, product] of Object.entries(productsBySlug)) {
    const count = weekData.get(product.id)?.mentionCount ?? 0;
    shares[slug] = total > 0 ? count / total : null;
  }
  return shares;
}
