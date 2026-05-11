import { describe, expect, it } from 'vitest';
import {
  CORE_CONTRACT_VERSION,
  PROJECT_SCHEMA_VERSION,
  STORAGE_BUCKETS,
  TIER_FLAGS,
  TIER_LIMITS,
  TRACK_CONTRACT_FIELDS,
  getTierLimits,
  isAllowedStorageBucket,
} from '@hollowbits/core';

describe('ecosystem core contract', () => {
  it('keeps the local-first schema and storage buckets stable', () => {
    expect(CORE_CONTRACT_VERSION).toBe('2026.05-local-first');
    expect(PROJECT_SCHEMA_VERSION).toBe('3.0-reference');
    expect(STORAGE_BUCKETS).toEqual([
      'project-audio',
      'project-stems',
      'project-exports',
      'asset-library',
      'user-avatars',
    ]);
    expect(isAllowedStorageBucket('project-audio')).toBe(true);
    expect(isAllowedStorageBucket('project-audio-assets')).toBe(false);
  });

  it('keeps freemium monetization on infrastructure scale', () => {
    expect(getTierLimits('free').maxSampleRate).toBe(192000);
    expect(getTierLimits('free').maxCollaborators).toBe(2);
    expect(getTierLimits('free').storageBytes).toBe(5 * 1024 ** 3);
    expect(TIER_LIMITS.pro.renderMinutesPerMonth).toBeGreaterThan(0);
    expect(TIER_LIMITS.studio.renderMinutesPerMonth).toBe(-1);
    expect(TIER_FLAGS.free.cloudRender).toBe(false);
    expect(TIER_FLAGS.pro.cloudRender).toBe(true);
    expect(TIER_FLAGS.studio.apiWebhooks).toBe(true);
  });

  it('declares project fields that must survive Web/Desktop roundtrip', () => {
    expect(TRACK_CONTRACT_FIELDS).toContain('sends');
    expect(TRACK_CONTRACT_FIELDS).toContain('sendModes');
    expect(TRACK_CONTRACT_FIELDS).toContain('groupId');
    expect(TRACK_CONTRACT_FIELDS).toContain('vcaGroupId');
    expect(TRACK_CONTRACT_FIELDS).toContain('soloSafe');
    expect(TRACK_CONTRACT_FIELDS).toContain('sidechainSourceTrackId');
    expect(TRACK_CONTRACT_FIELDS).toContain('isFrozen');
    expect(TRACK_CONTRACT_FIELDS).toContain('frozenBufferSourceId');
  });
});
