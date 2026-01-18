import { describe, it, expect } from 'vitest';
import { detectMassOperations, type AllGraphOperations } from '../carRepo.js';
import type { MassOpsSettings, GraphOperation } from '../types.js';

describe('Mass Operations Detection', () => {
  const defaultSettings: MassOpsSettings = {
    timeWindowMinutes: 5,
    minOperationCount: 10,
  };

  describe('detectMassOperations', () => {
    it('detects a cluster of blocks within the time window', () => {
      const baseTime = Date.now();
      const blocks: GraphOperation[] = Array.from({ length: 15 }, (_, i) => ({
        type: 'block' as const,
        did: `did:plc:user${i}`,
        rkey: `rkey${i}`,
        createdAt: baseTime + i * 10000, // 10 seconds apart
      }));

      const operations: AllGraphOperations = {
        blocks,
        follows: [],
        listitems: [],
      };

      const clusters = detectMassOperations(operations, defaultSettings);

      expect(clusters).toHaveLength(1);
      expect(clusters[0].type).toBe('block');
      expect(clusters[0].count).toBe(15);
      expect(clusters[0].operations).toHaveLength(15);
    });

    it('detects a cluster of follows within the time window', () => {
      const baseTime = Date.now();
      const follows: GraphOperation[] = Array.from({ length: 12 }, (_, i) => ({
        type: 'follow' as const,
        did: `did:plc:user${i}`,
        rkey: `rkey${i}`,
        createdAt: baseTime + i * 15000, // 15 seconds apart
      }));

      const operations: AllGraphOperations = {
        blocks: [],
        follows,
        listitems: [],
      };

      const clusters = detectMassOperations(operations, defaultSettings);

      expect(clusters).toHaveLength(1);
      expect(clusters[0].type).toBe('follow');
      expect(clusters[0].count).toBe(12);
    });

    it('detects a cluster of list items', () => {
      const baseTime = Date.now();
      const listitems: GraphOperation[] = Array.from({ length: 20 }, (_, i) => ({
        type: 'listitem' as const,
        did: `did:plc:user${i}`,
        rkey: `rkey${i}`,
        createdAt: baseTime + i * 5000,
        listUri: 'at://did:plc:creator/app.bsky.graph.list/abc123',
        listName: 'Test List',
      }));

      const operations: AllGraphOperations = {
        blocks: [],
        follows: [],
        listitems,
      };

      const clusters = detectMassOperations(operations, defaultSettings);

      expect(clusters).toHaveLength(1);
      expect(clusters[0].type).toBe('listitem');
      expect(clusters[0].count).toBe(20);
    });

    it('ignores scattered operations that do not form a cluster', () => {
      const baseTime = Date.now();
      // Operations spread over 30 minutes - way outside 5 minute window
      const blocks: GraphOperation[] = Array.from({ length: 15 }, (_, i) => ({
        type: 'block' as const,
        did: `did:plc:user${i}`,
        rkey: `rkey${i}`,
        createdAt: baseTime + i * 2 * 60 * 1000, // 2 minutes apart
      }));

      const operations: AllGraphOperations = {
        blocks,
        follows: [],
        listitems: [],
      };

      const clusters = detectMassOperations(operations, defaultSettings);

      expect(clusters).toHaveLength(0);
    });

    it('respects minOperationCount setting', () => {
      const baseTime = Date.now();
      // Only 5 blocks - below default threshold of 10
      const blocks: GraphOperation[] = Array.from({ length: 5 }, (_, i) => ({
        type: 'block' as const,
        did: `did:plc:user${i}`,
        rkey: `rkey${i}`,
        createdAt: baseTime + i * 10000,
      }));

      const operations: AllGraphOperations = {
        blocks,
        follows: [],
        listitems: [],
      };

      // With default settings (min 10), should not detect
      const clustersDefault = detectMassOperations(operations, defaultSettings);
      expect(clustersDefault).toHaveLength(0);

      // With lower threshold, should detect
      const lowThresholdSettings: MassOpsSettings = {
        timeWindowMinutes: 5,
        minOperationCount: 3,
      };
      const clustersLow = detectMassOperations(operations, lowThresholdSettings);
      expect(clustersLow).toHaveLength(1);
      expect(clustersLow[0].count).toBe(5);
    });

    it('respects timeWindowMinutes setting', () => {
      const baseTime = Date.now();
      // Operations spread over 3 minutes
      const blocks: GraphOperation[] = Array.from({ length: 10 }, (_, i) => ({
        type: 'block' as const,
        did: `did:plc:user${i}`,
        rkey: `rkey${i}`,
        createdAt: baseTime + i * 18000, // 18 seconds apart = 3 minutes total
      }));

      const operations: AllGraphOperations = {
        blocks,
        follows: [],
        listitems: [],
      };

      // With 5 minute window, should detect
      const clusters5min = detectMassOperations(operations, defaultSettings);
      expect(clusters5min).toHaveLength(1);

      // With 1 minute window, should not detect
      const tightSettings: MassOpsSettings = {
        timeWindowMinutes: 1,
        minOperationCount: 10,
      };
      const clusters1min = detectMassOperations(operations, tightSettings);
      expect(clusters1min).toHaveLength(0);
    });

    it('detects multiple separate clusters', () => {
      const baseTime = Date.now();

      // First cluster: 12 blocks in 2 minutes
      const cluster1 = Array.from({ length: 12 }, (_, i) => ({
        type: 'block' as const,
        did: `did:plc:cluster1user${i}`,
        rkey: `cluster1rkey${i}`,
        createdAt: baseTime + i * 10000,
      }));

      // Gap of 30 minutes
      const gapMs = 30 * 60 * 1000;

      // Second cluster: 15 blocks in 3 minutes
      const cluster2 = Array.from({ length: 15 }, (_, i) => ({
        type: 'block' as const,
        did: `did:plc:cluster2user${i}`,
        rkey: `cluster2rkey${i}`,
        createdAt: baseTime + gapMs + i * 12000,
      }));

      const operations: AllGraphOperations = {
        blocks: [...cluster1, ...cluster2],
        follows: [],
        listitems: [],
      };

      const clusters = detectMassOperations(operations, defaultSettings);

      expect(clusters).toHaveLength(2);
      expect(clusters[0].count).toBe(15); // Sorted by startTime desc, so cluster2 is first
      expect(clusters[1].count).toBe(12);
    });

    it('handles operations at the same timestamp', () => {
      const baseTime = Date.now();
      // All operations at the exact same time
      const blocks: GraphOperation[] = Array.from({ length: 10 }, (_, i) => ({
        type: 'block' as const,
        did: `did:plc:user${i}`,
        rkey: `rkey${i}`,
        createdAt: baseTime,
      }));

      const operations: AllGraphOperations = {
        blocks,
        follows: [],
        listitems: [],
      };

      const clusters = detectMassOperations(operations, defaultSettings);

      expect(clusters).toHaveLength(1);
      expect(clusters[0].count).toBe(10);
      expect(clusters[0].startTime).toBe(baseTime);
      expect(clusters[0].endTime).toBe(baseTime);
    });

    it('returns empty array for no operations', () => {
      const operations: AllGraphOperations = {
        blocks: [],
        follows: [],
        listitems: [],
      };

      const clusters = detectMassOperations(operations, defaultSettings);

      expect(clusters).toHaveLength(0);
    });

    it('returns empty array when operations are below minimum count', () => {
      const baseTime = Date.now();
      const blocks: GraphOperation[] = Array.from({ length: 3 }, (_, i) => ({
        type: 'block' as const,
        did: `did:plc:user${i}`,
        rkey: `rkey${i}`,
        createdAt: baseTime + i * 1000,
      }));

      const operations: AllGraphOperations = {
        blocks,
        follows: [],
        listitems: [],
      };

      const clusters = detectMassOperations(operations, defaultSettings);

      expect(clusters).toHaveLength(0);
    });

    it('detects clusters of different types independently', () => {
      const baseTime = Date.now();

      // 12 blocks in 2 minutes
      const blocks: GraphOperation[] = Array.from({ length: 12 }, (_, i) => ({
        type: 'block' as const,
        did: `did:plc:blockuser${i}`,
        rkey: `blockrkey${i}`,
        createdAt: baseTime + i * 10000,
      }));

      // 15 follows at same time
      const follows: GraphOperation[] = Array.from({ length: 15 }, (_, i) => ({
        type: 'follow' as const,
        did: `did:plc:followuser${i}`,
        rkey: `followrkey${i}`,
        createdAt: baseTime + i * 10000,
      }));

      const operations: AllGraphOperations = {
        blocks,
        follows,
        listitems: [],
      };

      const clusters = detectMassOperations(operations, defaultSettings);

      expect(clusters).toHaveLength(2);
      const blockCluster = clusters.find((c) => c.type === 'block');
      const followCluster = clusters.find((c) => c.type === 'follow');
      expect(blockCluster).toBeDefined();
      expect(followCluster).toBeDefined();
      expect(blockCluster!.count).toBe(12);
      expect(followCluster!.count).toBe(15);
    });

    it('assigns unique IDs to clusters', () => {
      const baseTime = Date.now();
      const blocks: GraphOperation[] = Array.from({ length: 10 }, (_, i) => ({
        type: 'block' as const,
        did: `did:plc:user${i}`,
        rkey: `rkey${i}`,
        createdAt: baseTime + i * 10000,
      }));

      const operations: AllGraphOperations = {
        blocks,
        follows: [],
        listitems: [],
      };

      const clusters = detectMassOperations(operations, defaultSettings);

      expect(clusters).toHaveLength(1);
      expect(clusters[0].id).toBeDefined();
      expect(clusters[0].id).toMatch(/^cluster_/);
    });

    it('correctly calculates startTime and endTime', () => {
      const baseTime = 1700000000000;
      const blocks: GraphOperation[] = Array.from({ length: 10 }, (_, i) => ({
        type: 'block' as const,
        did: `did:plc:user${i}`,
        rkey: `rkey${i}`,
        createdAt: baseTime + i * 10000,
      }));

      const operations: AllGraphOperations = {
        blocks,
        follows: [],
        listitems: [],
      };

      const clusters = detectMassOperations(operations, defaultSettings);

      expect(clusters).toHaveLength(1);
      expect(clusters[0].startTime).toBe(baseTime);
      expect(clusters[0].endTime).toBe(baseTime + 9 * 10000);
    });
  });
});
