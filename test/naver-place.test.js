import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseNaverInt,
  normalizePlace,
  findTargetClinic,
  getNaverPlaceData,
} from '../lib/naver-place.js';

// ---------------------------------------------------------------------------
// parseNaverInt
// ---------------------------------------------------------------------------
describe('parseNaverInt', () => {
  it('parses comma-formatted string', () => {
    assert.equal(parseNaverInt('2,203'), 2203);
    assert.equal(parseNaverInt('3,917'), 3917);
  });
  it('handles plain number strings', () => {
    assert.equal(parseNaverInt('51'), 51);
    assert.equal(parseNaverInt('0'), 0);
  });
  it('handles actual numbers', () => {
    assert.equal(parseNaverInt(51), 51);
  });
  it('returns null for null/undefined', () => {
    assert.equal(parseNaverInt(null), null);
    assert.equal(parseNaverInt(undefined), null);
  });
  it('returns null for non-numeric strings', () => {
    assert.equal(parseNaverInt('N/A'), null);
    assert.equal(parseNaverInt(''), null);
  });
});

// ---------------------------------------------------------------------------
// normalizePlace
// ---------------------------------------------------------------------------
describe('normalizePlace', () => {
  const raw = {
    id: '1234567',
    name: '테스트치과의원',
    category: '치과',
    address: '역삼동 815',
    roadAddress: '강남대로 432',
    phone: '02-1234-5678',
    x: '127.0266249',
    y: '37.5012350',
    visitorReviewCount: '2,203',
    blogCafeReviewCount: '3,917',
    bookingReviewCount: '0',
    imageCount: 51,
    businessHours: null,
  };

  it('builds naverUrl from id', () => {
    const n = normalizePlace(raw);
    assert.equal(n.naverUrl, 'https://map.naver.com/v5/entry/place/1234567');
  });
  it('parses review counts as integers', () => {
    const n = normalizePlace(raw);
    assert.equal(n.visitorReviews, 2203);
    assert.equal(n.blogReviews, 3917);
    assert.equal(n.bookingReviews, 0);
  });
  it('parses coords as floats', () => {
    const n = normalizePlace(raw);
    assert.ok(Math.abs(n.coords.lng - 127.0266249) < 0.0001);
    assert.ok(Math.abs(n.coords.lat - 37.501235) < 0.0001);
  });
  it('returns null coords when x/y absent', () => {
    const n = normalizePlace({ ...raw, x: null, y: null });
    assert.equal(n.coords, null);
  });
  it('preserves phone as-is', () => {
    const n = normalizePlace(raw);
    assert.equal(n.phone, '02-1234-5678');
  });
  it('sets businessHours to null when null', () => {
    const n = normalizePlace(raw);
    assert.equal(n.businessHours, null);
  });
});

// ---------------------------------------------------------------------------
// findTargetClinic
// ---------------------------------------------------------------------------
describe('findTargetClinic', () => {
  const items = [
    { id: 'a', name: '우리치과의원', phone: '02-111-2222' },
    { id: 'b', name: '강남플란트치과', phone: '02-333-4444' },
    { id: 'c', name: '목동치과의원', phone: null },
  ];

  it('matches by exact phone', () => {
    const r = findTargetClinic(items, { clinicPhone: '02-111-2222' });
    assert.equal(r?.id, 'a');
  });
  it('matches by last-7 digits (ignoring area code format)', () => {
    const r = findTargetClinic(items, { clinicPhone: '021112222' });
    assert.equal(r?.id, 'a');
  });
  it('matches by name substring', () => {
    const r = findTargetClinic(items, { clinicName: '플란트' });
    assert.equal(r?.id, 'b');
  });
  it('name match is case-insensitive', () => {
    const r = findTargetClinic(items, { clinicName: '강남플란트' });
    assert.equal(r?.id, 'b');
  });
  it('returns null when no match', () => {
    const r = findTargetClinic(items, { clinicPhone: '000-000-0000', clinicName: '없는치과' });
    assert.equal(r, null);
  });
  it('title-derived guess with location prefix finds the official place name (트리움 regression)', () => {
    const places = [
      { id: 'x', name: '닥터재일치과의원', phone: null },
      { id: 'y', name: '트리움치과의원', phone: null },
    ];
    const r = findTargetClinic(places, { clinicName: '둔촌동 트리움치과' });
    assert.equal(r?.id, 'y');
  });
  it('strips chained specialty suffixes (교정과치과의원)', () => {
    const places = [{ id: 's', name: '시그니처치과교정과치과의원', phone: null }];
    const r = findTargetClinic(places, { clinicName: '시그니처치과' });
    assert.equal(r?.id, 's');
  });
  it('exact core equality beats fuzzy includes ordering', () => {
    const places = [
      { id: 'fuzzy', name: '강남서울미소치과의원', phone: null },
      { id: 'exact', name: '서울미소치과의원', phone: null },
    ];
    const r = findTargetClinic(places, { clinicName: '서울미소치과' });
    assert.equal(r?.id, 'exact');
  });
  it('does not match on degenerate short cores', () => {
    const places = [{ id: 'z', name: '치과의원', phone: null }];
    const r = findTargetClinic(places, { clinicName: '둔촌동 트리움치과' });
    assert.equal(r, null);
  });
  it('returns null on empty items', () => {
    assert.equal(findTargetClinic([], { clinicPhone: '02-111-2222' }), null);
  });
  it('returns null with no criteria', () => {
    assert.equal(findTargetClinic(items, {}), null);
  });
});

// ---------------------------------------------------------------------------
// getNaverPlaceData — unit tests with injected mock fetch
// ---------------------------------------------------------------------------
describe('getNaverPlaceData', () => {
  function makeMockFetch(items, total = items.length) {
    return async () => ({
      ok: true,
      json: async () => ({ data: { places: { total, items } } }),
    });
  }

  const mockItems = [
    {
      id: '100', name: '우리치과', category: '치과',
      address: '역삼동 1', roadAddress: '강남대로 1',
      phone: '02-000-0001', x: '127.02', y: '37.50',
      visitorReviewCount: '100', blogCafeReviewCount: '50',
      bookingReviewCount: '0', imageCount: 5, businessHours: null,
    },
    {
      id: '200', name: '경쟁치과A', category: '치과',
      address: '역삼동 2', roadAddress: '강남대로 2',
      phone: '02-000-0002', x: '127.03', y: '37.51',
      visitorReviewCount: '500', blogCafeReviewCount: '1,200',
      bookingReviewCount: '0', imageCount: 30, businessHours: null,
    },
    {
      id: '300', name: '경쟁치과B', category: '치과',
      address: '역삼동 3', roadAddress: '강남대로 3',
      phone: null, x: '127.04', y: '37.52',
      visitorReviewCount: '200', blogCafeReviewCount: '800',
      bookingReviewCount: '0', imageCount: 10, businessHours: null,
    },
  ];

  it('returns total and normalized items', async () => {
    const result = await getNaverPlaceData({
      query: '강남 임플란트 치과',
      fetch: makeMockFetch(mockItems, 655),
    });
    assert.equal(result.total, 655);
    assert.equal(result.query, '강남 임플란트 치과');
    assert.ok(Array.isArray(result.competitors));
  });

  it('identifies target by phone match', async () => {
    const result = await getNaverPlaceData({
      query: '강남 임플란트 치과',
      clinicPhone: '02-000-0001',
      fetch: makeMockFetch(mockItems, 3),
    });
    assert.equal(result.target?.id, '100');
    assert.ok(!result.competitors.find((c) => c.id === '100'));
  });

  it('excludes target from competitors', async () => {
    const result = await getNaverPlaceData({
      query: '강남 임플란트 치과',
      clinicPhone: '02-000-0002',
      fetch: makeMockFetch(mockItems, 3),
    });
    assert.equal(result.target?.id, '200');
    assert.ok(!result.competitors.find((c) => c.id === '200'));
  });

  it('target is null when no match', async () => {
    const result = await getNaverPlaceData({
      query: '강남 임플란트 치과',
      clinicPhone: '999',
      fetch: makeMockFetch(mockItems, 3),
    });
    assert.equal(result.target, null);
    assert.equal(result.competitors.length, 3);
  });

  it('competitors capped at 5', async () => {
    const manyItems = Array.from({ length: 10 }, (_, i) => ({
      ...mockItems[0], id: String(i), name: `치과${i}`, phone: `02-000-00${String(i).padStart(2,'0')}`,
    }));
    const result = await getNaverPlaceData({
      query: '강남 임플란트 치과',
      fetch: makeMockFetch(manyItems, 10),
    });
    assert.ok(result.competitors.length <= 5);
  });

  it('throws on missing query', async () => {
    await assert.rejects(
      () => getNaverPlaceData({ fetch: makeMockFetch([]) }),
      /query is required/
    );
  });

  it('throws when fetch returns HTTP error', async () => {
    const badFetch = async () => ({ ok: false, status: 500 });
    await assert.rejects(
      () => getNaverPlaceData({ query: 'test', fetch: badFetch }),
      /HTTP 500/
    );
  });

  it('throws on GraphQL errors in response', async () => {
    const errFetch = async () => ({
      ok: true,
      json: async () => ({ errors: [{ message: 'GraphQL bad query' }] }),
    });
    await assert.rejects(
      () => getNaverPlaceData({ query: 'test', fetch: errFetch }),
      /GraphQL/
    );
  });

  it('includes parsedAt and dataNote', async () => {
    const result = await getNaverPlaceData({
      query: '강남 임플란트 치과',
      fetch: makeMockFetch(mockItems, 3),
    });
    assert.ok(result.parsedAt);
    assert.ok(result.dataNote?.includes('Smart Place'));
  });
});
