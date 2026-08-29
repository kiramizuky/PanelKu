/**
 * Fase 2 Tests: Docker App Store, Container Resource Limits & Real-Time GeoIP Threat Map
 */
import { describe, it, expect, beforeAll } from '@jest/globals';
import { getDb, generateId, now } from '../src/core/db/sqlite.js';
import dockerService from '../src/modules/docker/docker.service.js';
import { APP_STORE_CATALOG } from '../src/modules/docker/appstore.catalog.js';
import geoipService from '../src/modules/waf/geoip.service.js';

describe('Fase 2: Docker App Store & GeoIP Threat Map', () => {
  beforeAll(() => {
    // Ensure DB initialized
    getDb();
  });

  describe('Docker App Store Catalog', () => {
    it('returns catalog list with 15+ curated templates', () => {
      const catalog = dockerService.getAppStoreCatalog();
      expect(Array.isArray(catalog)).toBe(true);
      expect(catalog.length).toBeGreaterThanOrEqual(15);
    });

    it('contains essential fields for every template in catalog', () => {
      for (const t of APP_STORE_CATALOG) {
        expect(t.id).toBeDefined();
        expect(t.name).toBeDefined();
        expect(t.category).toBeDefined();
        expect(t.compose).toContain('version:');
        expect(Array.isArray(t.fields)).toBe(true);
      }
    });

    it('has AI, CMS, Database and DevOps categories represented', () => {
      const categories = new Set(APP_STORE_CATALOG.map(t => t.category));
      expect(categories.has('AI & LLM')).toBe(true);
      expect(categories.has('Web & CMS')).toBe(true);
      expect(categories.has('Dev & Tools')).toBe(true);
      expect(categories.has('Database')).toBe(true);
    });
  });

  describe('GeoIP & Real-time Threat Map Service', () => {
    it('resolves local IPs to LOCAL without error', async () => {
      const geo = await geoipService.resolveIp('127.0.0.1');
      expect(geo.countryCode).toBe('LOCAL');
    });

    it('resolves public IPs to valid country metadata', async () => {
      const geo = await geoipService.resolveIp('45.33.32.156');
      expect(geo.countryCode).toBeDefined();
      expect(geo.countryName).toBeDefined();
      expect(typeof geo.lat).toBe('number');
      expect(typeof geo.lng).toBe('number');
    });

    it('aggregates threat map data with country breakdowns', async () => {
      const data = await geoipService.getThreatMapData();
      expect(data).toHaveProperty('totalThreats');
      expect(data).toHaveProperty('uniqueIps');
      expect(Array.isArray(data.countries)).toBe(true);
      expect(Array.isArray(data.allCountryOptions)).toBe(true);
      expect(data.allCountryOptions.length).toBeGreaterThan(10);
    });

    it('handles 1-click Country Geo-Blocking and unblocking', async () => {
      const testCode = 'RU';
      const blockRes = await geoipService.blockCountry(testCode, 'Automated Test Geo-Block');
      expect(blockRes.success).toBe(true);
      expect(blockRes.countryCode).toBe('RU');

      // Verify country is recorded in blocked countries
      const data = await geoipService.getThreatMapData();
      const isBlocked = data.blockedCountriesList.some(b => b.countryCode === 'RU');
      expect(isBlocked).toBe(true);

      // Duplicate block should throw
      await expect(geoipService.blockCountry(testCode)).rejects.toThrow();

      // Unblock
      const unblockRes = await geoipService.unblockCountry(testCode);
      expect(unblockRes.success).toBe(true);
    });
  });
});
