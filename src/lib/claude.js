import Anthropic from '@anthropic-ai/sdk';

export function getAnthropicClient() {
  return new Anthropic({ apiKey: import.meta.env.ANTHROPIC_API_KEY });
}

export const SQL_MODEL = 'claude-sonnet-5';
export const ANSWER_MODEL = 'claude-sonnet-5';
