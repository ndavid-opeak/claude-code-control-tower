import type { Category } from '../types.ts';
import { contextRules } from './context/index.ts';
import { duplicatesRules } from './duplicates/index.ts';
import { hygieneRules } from './hygiene/index.ts';
import type { Rule } from './types.ts';
import { usageRules } from './usage/index.ts';

// To add a check: write one rule module in its category's folder and append it to that folder's index.ts.
export const RULES: Record<Category, Rule[]> = {
  usage: usageRules,
  context: contextRules,
  duplicates: duplicatesRules,
  hygiene: hygieneRules,
};
