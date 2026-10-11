import test from 'node:test';
import assert from 'node:assert/strict';
import { commandBudget } from '../scripts/nightly/command-budget.mjs';
test('expired run deadline stops work but leaves time for owned cleanup within the thirty-minute slot', () => {
  const budget={now:1000,phaseDeadline:900,slotDeadline:31000};
  assert.equal(commandBudget(10000,budget),-100);
  assert.equal(commandBudget(10000,{...budget,allowFailure:true}),10000);
  assert.equal(commandBudget(60000,{...budget,allowFailure:true}),30000);
  assert.equal(commandBudget(15000,{now:1000,allowFailure:true}),15000,'final cleanup outside a heavy stage keeps its explicit timeout');
});
