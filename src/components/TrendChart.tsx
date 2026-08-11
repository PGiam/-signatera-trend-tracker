import { useState } from 'react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
} from 'recharts';

type Series = { slug: string; label: string; color: string };
type Point = { date: string; [slug: string]: string | number };

export default function TrendChart({
  data,
  series,
  yLabel,
}: {
  data: Point[];
  series: Series[];
  yLabel: string;
}) {
  const [showTable, setShowTable] = useState(false);

  return (
    <div>
      <div style={{ width: '100%', height: 280 }}>
        <ResponsiveContainer>
          <LineChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid stroke="#e1e0d9" vertical={false} />
            <XAxis dataKey="date" tick={{ fontSize: 12, fill: '#898781' }} stroke="#c3c2b7" />
            <YAxis
              tick={{ fontSize: 12, fill: '#898781' }}
              stroke="#c3c2b7"
              label={{ value: yLabel, angle: -90, position: 'insideLeft', fill: '#52514e', fontSize: 12 }}
            />
            <Tooltip
              contentStyle={{ borderRadius: 8, borderColor: '#e1e0d9', fontSize: 13 }}
              labelStyle={{ color: '#0b0b0b', fontWeight: 600 }}
            />
            <Legend wrapperStyle={{ fontSize: 13, color: '#52514e' }} />
            {series.map((s) => (
              <Line
                key={s.slug}
                type="monotone"
                dataKey={s.slug}
                name={s.label}
                stroke={s.color}
                strokeWidth={2}
                dot={{ r: 3 }}
                activeDot={{ r: 5 }}
                connectNulls
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <button
        type="button"
        onClick={() => setShowTable((v) => !v)}
        className="mt-2 text-sm font-medium text-accent-600 hover:underline"
      >
        {showTable ? 'Hide data table' : 'View as table'}
      </button>
      {showTable && (
        <div className="mt-2 overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                <th className="px-3 py-2 font-medium">Date</th>
                {series.map((s) => (
                  <th key={s.slug} className="px-3 py-2 font-medium">
                    {s.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.map((row) => (
                <tr key={row.date} className="border-t border-slate-100">
                  <td className="px-3 py-2 text-slate-700">{row.date}</td>
                  {series.map((s) => (
                    <td key={s.slug} className="px-3 py-2 text-slate-700">
                      {row[s.slug] ?? '—'}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
