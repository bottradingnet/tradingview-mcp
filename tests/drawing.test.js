/**
 * Drawing tests.
 *
 * Two failures shipped in this area and neither was caught by CI, because the only
 * drawing coverage lived in e2e.test.js, which needs a live TradingView Desktop and
 * is excluded from `npm run test:unit`. These tests run fully offline.
 *
 *  1. draw_shape returned { success: true } even when nothing was drawn.
 *  2. listDrawings/getProperties/removeOne/clearAll called bare `evaluate` and
 *     `getChartApi`, which this module imports under `_`-prefixed aliases, so every
 *     one of them threw ReferenceError at runtime. Only drawShape survived, because
 *     it destructures those names out of _resolve(). The source audit at the bottom
 *     of this file is what would have caught it.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { drawShape } from '../src/core/drawing.js';

// evaluate() is called three times per drawShape: getAllShapes, createShape, getAllShapes.
// Only the getAllShapes calls return ids.
function stubDeps(beforeIds, afterIds, createReturns = undefined) {
  let shapeReads = 0;
  return {
    getChartApi: async () => 'API',
    evaluate: async (expr) => {
      if (expr.includes('getAllShapes')) return ++shapeReads === 1 ? beforeIds : afterIds;
      return null;
    },
    // createShape goes through evaluateAsync (awaitPromise:true). Default stub returns
    // nothing, so the id has to come from the getAllShapes diff — the harder path.
    evaluateAsync: async () => createReturns,
  };
}

const POINT = { time: 1750000000, price: 24550 };

describe('drawShape — success is earned, not assumed', () => {
  it('reports success and the new entity id when a shape appears', async () => {
    const r = await drawShape({ shape: 'horizontal_line', point: POINT, _deps: stubDeps(['a'], ['a', 'b']) });
    assert.equal(r.success, true);
    assert.equal(r.entity_id, 'b');
  });

  it('reports FAILURE when TradingView draws nothing', async () => {
    const r = await drawShape({ shape: 'horizontal_line', point: POINT, _deps: stubDeps(['a'], ['a']) });
    assert.equal(r.success, false, 'a call that drew nothing must not report success');
    assert.equal(r.entity_id, null);
    assert.match(r.error, /no drawing appeared/i);
    assert.match(r.error, /horizontal_line/, 'error should name the shape that was attempted');
  });

  it('reports FAILURE on an empty chart that stays empty', async () => {
    const r = await drawShape({ shape: 'not_a_real_shape', point: POINT, _deps: stubDeps([], []) });
    assert.equal(r.success, false);
    assert.equal(r.shapes_before, 0);
    assert.equal(r.shapes_after, 0);
  });

  it('handles a null getAllShapes result without throwing', async () => {
    const r = await drawShape({ shape: 'text', point: POINT, text: 'PDH', _deps: stubDeps(null, null) });
    assert.equal(r.success, false);
  });

  it('two-point shapes take the same path', async () => {
    const r = await drawShape({
      shape: 'trend_line', point: POINT, point2: { time: 1750086400, price: 24700 },
      _deps: stubDeps([], ['t1']),
    });
    assert.equal(r.success, true);
    assert.equal(r.entity_id, 't1');
  });

  it('uses the id createShape resolves to, without needing the diff', async () => {
    // The Promise resolves to the entity id. Before the awaitPromise fix this value was
    // thrown away and entity_id came back null even on a successful draw.
    const r = await drawShape({ shape: 'horizontal_line', point: POINT, _deps: stubDeps([], [], 'shape_42') });
    assert.equal(r.success, true);
    assert.equal(r.entity_id, 'shape_42');
  });

  it('still succeeds when createShape resolves to nothing but the chart grew', async () => {
    const r = await drawShape({ shape: 'rectangle', point: POINT, point2: { time: 2, price: 3 }, _deps: stubDeps(['a'], ['a', 'z']) });
    assert.equal(r.success, true);
    assert.equal(r.entity_id, 'z');
  });

  it('rejects a non-finite coordinate instead of drawing at NaN', async () => {
    await assert.rejects(
      () => drawShape({ shape: 'horizontal_line', point: { time: 1, price: 'abc' }, _deps: stubDeps([], []) }),
    );
  });
});

// ── Source audit: the ReferenceError class of bug ────────────────────────────
// A module that imports `evaluate as _evaluate` must never call bare `evaluate(`
// unless that name is destructured locally (the _resolve(deps) pattern).
describe('source audit — no bare calls to aliased imports', () => {
  const CORE_DIR = fileURLToPath(new URL('../src/core/', import.meta.url));

  for (const file of readdirSync(CORE_DIR).filter(f => f.endsWith('.js'))) {
    it(`${file} calls only names that exist in scope`, () => {
      const src = readFileSync(join(CORE_DIR, file), 'utf8');

      const aliased = [...src.matchAll(/(\w+)\s+as\s+(_\w+)/g)]
        .filter(m => /^import|^\s*\w+\s+as\s+_/m.test(m[0]) || src.slice(0, src.indexOf(m[0])).includes('import'))
        .map(m => m[1]);
      if (!aliased.length) return;

      // Split into top-level function bodies so a local destructure only excuses its own body.
      const bodies = src.split(/\n(?=(?:export\s+)?(?:async\s+)?function\s)/);

      for (const body of bodies) {
        const header = body.split('\n')[0];
        for (const name of aliased) {
          const callsBare = new RegExp(`(?<![\\w.$])${name}\\s*\\(`).test(body);
          if (!callsBare) continue;
          const destructured = new RegExp(`\\{[^}]*\\b${name}\\b[^}]*\\}\\s*=`).test(body);
          assert.ok(
            destructured,
            `${file}: ${header.trim()}\n  calls bare "${name}(" but the module imports it as an alias `
            + `and this function does not destructure it. That is a ReferenceError at runtime. `
            + `Use the _-prefixed import, or destructure via _resolve(deps).`,
          );
        }
      }
    });
  }
});
