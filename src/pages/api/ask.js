import { getAnthropicClient, SQL_MODEL, ANSWER_MODEL } from '../../lib/claude.js';
import { runReadonlyQuery } from '../../lib/db-readonly.js';
import { validateAndCapSql } from '../../lib/sql-guardrails.js';
import { getServiceClient } from '../../lib/supabase.js';

export const prerender = false;

const SCHEMA_DESCRIPTION = `You have exactly these relations available (Postgres):

mentions_for_query(
  id uuid, source text, platform text, url text, product text,
  author_type text, author_type_confidence numeric,
  sentiment text, sentiment_score numeric,
  title text, excerpt text, published_at timestamptz, discovered_at timestamptz
)
  -- source in ('reddit','youtube','web')
  -- product in ('signatera','guardant360','foundationone_liquid')
  -- author_type in ('patient','caregiver','doctor','healthcare_professional','other','unknown')
  -- sentiment in ('positive','neutral','negative','mixed'), sentiment_score -1.0..1.0

mention_rollups_daily(rollup_date date, product_id smallint, author_type text, mention_count int, avg_sentiment_score numeric, positive_count int, neutral_count int, negative_count int, mixed_count int)

mention_rollups_weekly(week_start date, product_id smallint, author_type text, mention_count bigint, avg_sentiment_score numeric)

products(id smallint, slug text, display_name text)

Write exactly one PostgreSQL SELECT statement that answers the user's question using only these relations. Prefer mention_rollups_daily/weekly for trend/volume/"gaining or declining" questions, and mentions_for_query for questions about specific mentions or quotes. Join to products on product_id = products.id when you need product names in the rollup tables.`;

const GENERATE_SQL_TOOL = {
  name: 'submit_sql',
  description: 'Submit the SQL query that answers the question.',
  input_schema: {
    type: 'object',
    properties: {
      sql: { type: 'string', description: 'A single PostgreSQL SELECT statement.' },
    },
    required: ['sql'],
  },
};

async function generateSql(anthropic, question, priorError) {
  const messages = [{ role: 'user', content: `Question: ${question}` }];
  if (priorError) {
    messages.push({
      role: 'user',
      content: `Your previous query was rejected: ${priorError}. Please submit a corrected query.`,
    });
  }

  const response = await anthropic.messages.create({
    model: SQL_MODEL,
    max_tokens: 1024,
    system: SCHEMA_DESCRIPTION,
    tools: [GENERATE_SQL_TOOL],
    tool_choice: { type: 'tool', name: 'submit_sql' },
    messages,
  });

  const toolUse = response.content.find((block) => block.type === 'tool_use');
  return toolUse?.input?.sql ?? '';
}

async function synthesizeAnswer(anthropic, question, rows) {
  const cappedRows = rows.slice(0, 50);
  const response = await anthropic.messages.create({
    model: ANSWER_MODEL,
    max_tokens: 1024,
    messages: [
      {
        role: 'user',
        content:
          `Question: ${question}\n\nQuery result (${rows.length} row(s), showing up to 50):\n` +
          `${JSON.stringify(cappedRows, null, 2)}\n\n` +
          'Write a concise, plain-language answer to the question based on this data. ' +
          'If the result is empty, say so plainly rather than guessing. ' +
          'Mention specific numbers from the data where relevant.',
      },
    ],
  });
  return response.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n');
}

async function logQuery(supabase, entry) {
  const { error } = await supabase.from('query_log').insert(entry);
  if (error) console.error('Failed to write query_log entry:', error.message);
}

export async function POST({ request }) {
  const startedAt = Date.now();
  const { question } = await request.json();

  if (!question || typeof question !== 'string' || question.trim().length === 0) {
    return new Response(JSON.stringify({ error: 'A question is required.' }), { status: 400 });
  }

  const anthropic = getAnthropicClient();
  const supabase = getServiceClient();

  let generatedSql = await generateSql(anthropic, question);
  let validation = validateAndCapSql(generatedSql);

  if (!validation.valid) {
    // One retry, feeding the validation error back to the model.
    generatedSql = await generateSql(anthropic, question, validation.error);
    validation = validateAndCapSql(generatedSql);
  }

  if (!validation.valid) {
    await logQuery(supabase, {
      question,
      generated_sql: generatedSql,
      sql_valid: false,
      validation_error: validation.error,
      row_count: null,
      answer: null,
      duration_ms: Date.now() - startedAt,
    });
    return new Response(
      JSON.stringify({
        answer: "I couldn't turn that into a safe query against the allowed data. Try rephrasing it.",
        sql: null,
        rows: [],
      }),
      { status: 200 }
    );
  }

  try {
    const rows = await runReadonlyQuery(validation.sql);
    const answer = await synthesizeAnswer(anthropic, question, rows);

    await logQuery(supabase, {
      question,
      generated_sql: validation.sql,
      sql_valid: true,
      validation_error: null,
      row_count: rows.length,
      answer,
      duration_ms: Date.now() - startedAt,
    });

    return new Response(JSON.stringify({ answer, sql: validation.sql, rows }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    await logQuery(supabase, {
      question,
      generated_sql: validation.sql,
      sql_valid: true,
      validation_error: `execution error: ${err.message}`,
      row_count: null,
      answer: null,
      duration_ms: Date.now() - startedAt,
    });
    return new Response(
      JSON.stringify({ answer: 'That query failed to run. Try rephrasing the question.', sql: validation.sql, rows: [] }),
      { status: 200 }
    );
  }
}
