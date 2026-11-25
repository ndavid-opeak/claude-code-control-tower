import type { Rule } from '../types.ts';
import { baselineOverhead } from './baselineOverhead.ts';
import { cacheShare } from './cacheShare.ts';
import { largeSessions } from './largeSessions.ts';
import { opusShare } from './opusShare.ts';
import { subagentShare } from './subagentShare.ts';

export const usageRules: Rule[] = [cacheShare, largeSessions, opusShare, subagentShare, baselineOverhead];
