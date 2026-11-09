import {expect,it} from 'vitest';
import {isHermesReasoningReplay} from './reasoning-replay.ts';
it('drops only the complete already-streamed reasoning suffix',()=>{
 expect(isHermesReasoningReplay('💭 thinking\n\nanswer','answer')).toBe(true);
 expect(isHermesReasoningReplay('💭 thinking\n\nnew answer','answer')).toBe(false);
 expect(isHermesReasoningReplay('ordinary\n\nanswer','answer')).toBe(false);
 expect(isHermesReasoningReplay('💭 thinking\n\nanswer','')).toBe(false);
});
