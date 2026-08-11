import { useState } from 'react';

const EXAMPLES = [
  'Is Signatera mention volume up or down over the last month?',
  'What do doctors say about Guardant360?',
  'Which product has the most negative patient sentiment right now?',
];

export default function AskBox() {
  const [question, setQuestion] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ answer: string; sql: string | null; rows: unknown[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showDetails, setShowDetails] = useState(false);

  async function ask(q: string) {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: q }),
      });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const json = await res.json();
      setResult(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (question.trim()) ask(question.trim());
        }}
        className="flex gap-2"
      >
        <input
          type="text"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Ask a question about the collected data..."
          className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-500/30"
        />
        <button
          type="submit"
          disabled={loading || question.trim().length === 0}
          className="rounded-lg bg-accent-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? 'Asking…' : 'Ask'}
        </button>
      </form>

      <div className="mt-2 flex flex-wrap gap-2">
        {EXAMPLES.map((example) => (
          <button
            key={example}
            type="button"
            onClick={() => {
              setQuestion(example);
              ask(example);
            }}
            className="rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-500 transition-colors hover:bg-slate-50"
          >
            {example}
          </button>
        ))}
      </div>

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

      {result && (
        <div className="mt-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="whitespace-pre-wrap text-sm text-slate-800">{result.answer}</p>
          {(result.sql || result.rows?.length > 0) && (
            <>
              <button
                type="button"
                onClick={() => setShowDetails((v) => !v)}
                className="mt-3 text-xs font-medium text-accent-600 hover:underline"
              >
                {showDetails ? 'Hide' : 'Show'} the SQL and raw data
              </button>
              {showDetails && (
                <div className="mt-2 space-y-2">
                  {result.sql && (
                    <pre className="overflow-x-auto rounded-lg bg-slate-900 p-3 text-xs text-slate-100">{result.sql}</pre>
                  )}
                  {result.rows?.length > 0 && (
                    <pre className="max-h-64 overflow-auto rounded-lg bg-slate-50 p-3 text-xs text-slate-700">
                      {JSON.stringify(result.rows, null, 2)}
                    </pre>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
