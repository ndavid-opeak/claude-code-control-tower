import type { Rule } from '../types.ts';
import { duplicateServices } from './duplicateServices.ts';
import { pluginOverlap } from './pluginOverlap.ts';
import { repeatedInstructionLines } from './repeatedLines.ts';
import { duplicateSkillNames } from './skillNames.ts';

export const duplicatesRules: Rule[] = [duplicateSkillNames, pluginOverlap, duplicateServices, repeatedInstructionLines];
