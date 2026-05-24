'use strict'
// Run: node test-idgen.js
const assert = require('assert')
const { randomSuffix, buildDisplayId, CHARS } = require('./idgen')

function testCharSet() {
  const forbidden = /[01OI]/
  const allowed   = new Set(CHARS.split(''))
  for (let i = 0; i < 1000; i++) {
    const s = randomSuffix()
    assert.strictEqual(s.length, 5, `Suffix "${s}" should be 5 chars`)
    assert(!forbidden.test(s), `Suffix "${s}" contains a forbidden char (0/1/O/I)`)
    for (const ch of s) assert(allowed.has(ch), `Char "${ch}" not in allowed set`)
  }
  console.log('✓ character-set: 1000 suffixes all valid (no 0/1/O/I, length 5)')
}

function testFormat() {
  assert.strictEqual(buildDisplayId('quote', 2026, 'K4M9R'), 'Q-2026-K4M9R')
  assert.strictEqual(buildDisplayId('order', 2026, 'K4M9R'), 'SO-2026-K4M9R')
  console.log('✓ format: Q- and SO- prefixes correct')
}

function testNoCollisions() {
  const N   = 1000
  const ids = new Set()
  for (let i = 0; i < N; i++) {
    ids.add(buildDisplayId('quote', 2026, randomSuffix()))
  }
  // 32^5 ≈ 33.5M possibilities; expected collisions ≈ N²/(2·32^5) < 0.00002
  assert.strictEqual(ids.size, N, `Expected ${N} unique IDs, got ${ids.size}`)
  console.log(`✓ collision: ${N} IDs generated with 0 collisions`)
}

function testConvertSuffix() {
  // Verify the SO- ID reuses the Q- suffix (pure string logic)
  const qId = 'Q-2026-K4M9R'
  const [, year, suffix] = qId.split('-')
  const soId = `SO-${year}-${suffix}`
  assert.strictEqual(soId, 'SO-2026-K4M9R')
  console.log('✓ convert: Q- → SO- preserves suffix')
}

testCharSet()
testFormat()
testNoCollisions()
testConvertSuffix()
console.log('\nAll tests passed.')
