import { describe, expect, it } from 'vitest';
import { importFeed, searchProducts, type DemoState } from '../src/lib/pharmafind';

const now = new Date('2026-11-10T12:00:00.000Z');
const state: DemoState = {
  pharmacies: [
    { id: 'central', name: 'Central Pharmacy', verified: true, optedIn: true, accessible: true, latitude: 9.93, longitude: -84.08 },
    { id: 'north', name: 'North Pharmacy', verified: true, optedIn: true, accessible: false, latitude: 9.96, longitude: -84.08 },
    { id: 'pending', name: 'Pending Pharmacy', verified: false, optedIn: true, accessible: true, latitude: 9.92, longitude: -84.07 },
  ],
  products: [
    { id: 'acet-500-tab', catalogId: 'PF-ACET-500-TAB', brandName: 'PainAway', genericName: 'Acetaminophen', presentation: 'Tablet', dosage: '500 mg', packSize: '20 tablets' },
    { id: 'acet-250-syr', catalogId: 'PF-ACET-250-SYR', brandName: 'PainAway Kids', genericName: 'Acetaminophen', presentation: 'Oral suspension', dosage: '250 mg/5 mL', packSize: '120 mL' },
  ],
  listings: [
    { id: 'l1', pharmacyId: 'central', productId: 'acet-500-tab', stock: 12, price: 1200, updatedAt: now.toISOString() },
    { id: 'l2', pharmacyId: 'north', productId: 'acet-500-tab', stock: 0, price: 1050, updatedAt: '2026-11-08T12:00:00.000Z' },
    { id: 'l3', pharmacyId: 'pending', productId: 'acet-500-tab', stock: 8, price: 990, updatedAt: now.toISOString() },
  ],
};

describe('Pharmafind search', () => {
  it('matches brand or generic name, keeps presentations separate and ranks by distance', () => {
    const results = searchProducts(state, { query: 'acetaminophen', origin: { latitude: 9.93, longitude: -84.08 }, now });
    expect(results).toHaveLength(2);
    expect(results[0].pharmacyName).toBe('Central Pharmacy');
    expect(results[0].presentation).toBe('Tablet');
    expect(results[1].presentation).toBe('Tablet');
    expect(results[0].verified).toBe(true);
  });

  it('hides unverified pharmacies and marks listings older than 24 hours stale', () => {
    const results = searchProducts(state, { query: 'PainAway', origin: { latitude: 9.93, longitude: -84.08 }, now });
    expect(results.every((result) => result.pharmacyName !== 'Pending Pharmacy')).toBe(true);
    expect(results.find((result) => result.pharmacyName === 'North Pharmacy')?.isStale).toBe(true);
  });

  it('filters to accessible pharmacies when requested', () => {
    const results = searchProducts(state, { query: 'PainAway', origin: { latitude: 9.93, longitude: -84.08 }, accessibleOnly: true, now });
    expect(results.map((result) => result.pharmacyName)).toEqual(['Central Pharmacy']);
  });
});

describe('Feed import', () => {
  it('accepts standard catalog rows and rejects non-compliant rows without normalization', () => {
    const summary = importFeed(state, 'central', [
      { catalogId: 'PF-ACET-500-TAB', stock: 4, price: 1000 },
      { catalogId: 'acet-500-tab', stock: 4, price: 1000 },
      { catalogId: 'PF-ACET-250-SYR', stock: -1, price: 1000 },
    ], now);
    expect(summary.accepted).toBe(1);
    expect(summary.rejected).toBe(2);
    expect(state.listings.find((listing) => listing.id === 'l1')?.stock).toBe(4);
  });

  it('rejects a pharmacy attempting to import for another pharmacy', () => {
    expect(() => importFeed(state, 'north', [{ catalogId: 'PF-ACET-500-TAB', stock: 1, price: 50 }], now, 'central')).toThrow(/access denied/i);
  });
});
