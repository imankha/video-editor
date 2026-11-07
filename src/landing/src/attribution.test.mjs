import test from 'node:test'
import assert from 'node:assert/strict'
import { readFirstTouch, applyFirstTouch, computeLref } from './attribution.ts'

function memoryStore(initial = {}) {
  const data = { ...initial }
  return {
    getItem(key) {
      return key in data ? data[key] : null
    },
    setItem(key, value) {
      data[key] = value
    },
    _data: data,
  }
}

function throwingStore() {
  return {
    getItem() {
      throw new Error('storage blocked')
    },
    setItem() {
      throw new Error('storage blocked')
    },
  }
}

test('writes a first-touch record on the first page, keeping only whitelisted params', () => {
  const store = memoryStore()
  const record = readFirstTouch('?utm_source=x&foo=bar', '', 'reelballers.com', '/soccer', store)
  assert.deepEqual(record.params, { utm_source: 'x' })
  assert.equal(record.lp, '/soccer')
  assert.ok(store._data.rbFirstTouch)
})

test('a later page with new params does not change the first touch', () => {
  const store = memoryStore()
  readFirstTouch('?utm_source=x', '', 'reelballers.com', '/soccer', store)
  const second = readFirstTouch('?utm_source=y&utm_medium=cpc', '', 'reelballers.com', '/hockey', store)
  assert.equal(second.params.utm_source, 'x')
  assert.equal(second.params.utm_medium, undefined)
  assert.equal(second.lp, '/soccer')
})

test('lref is only captured on the first page, and only when the referrer is external', () => {
  const store = memoryStore()
  const record = readFirstTouch('', 'https://www.google.com/search', 'reelballers.com', '/', store)
  assert.equal(record.lref, 'www.google.com')

  const internalStore = memoryStore()
  const internal = readFirstTouch('', 'https://reelballers.com/sports', 'reelballers.com', '/', internalStore)
  assert.equal(internal.lref, '')
})

test('computeLref folds apex/www and excludes the current host', () => {
  assert.equal(computeLref('https://www.reelballers.com/x', 'reelballers.com'), '')
  assert.equal(computeLref('https://reddit.com/r/hockey', 'reelballers.com'), 'reddit.com')
  assert.equal(computeLref('not a url', 'reelballers.com'), '')
})

test('unknown query params are dropped', () => {
  const store = memoryStore()
  const record = readFirstTouch('?foo=bar&ref=abc', '', 'reelballers.com', '/', store)
  assert.deepEqual(record.params, { ref: 'abc' })
})

test('applyFirstTouch merges stored params and lref without overwriting params already on the link', () => {
  const record = { params: { utm_source: 'x', ref: 'y' }, lref: 'google.com', lp: '/', landed_at: 't' }
  const href = applyFirstTouch('https://app.reelballers.com/signup?utm_source=existing', record)
  const url = new URL(href)
  assert.equal(url.searchParams.get('utm_source'), 'existing')
  assert.equal(url.searchParams.get('ref'), 'y')
  assert.equal(url.searchParams.get('lref'), 'google.com')
})

test('a null record (storage blocked) leaves the href untouched', () => {
  const store = throwingStore()
  const record = readFirstTouch('?utm_source=x', '', 'reelballers.com', '/', store)
  assert.equal(record, null)
  const href = 'https://app.reelballers.com/signup?a=1'
  assert.equal(applyFirstTouch(href, record), href)
})
