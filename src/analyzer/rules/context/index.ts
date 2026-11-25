import type { Rule } from '../types.ts';
import { instructionSize } from './instructionSize.ts';
import { mcpServers } from './mcpServers.ts';
import { skillDescriptions } from './skillDescriptions.ts';
import { unusedSetup } from './unusedSetup.ts';

export const contextRules: Rule[] = [instructionSize, skillDescriptions, mcpServers, unusedSetup];
