import {
  PROJECT_SCHEMA_VERSION,
  STORAGE_BUCKETS,
  type StorageBucket,
  type Tier,
  type UsageMetric,
  resolveTier,
} from '@hollowbits/core';
import type { ProjectData } from '../types';
import { supabase } from './supabase';

type ProjectOsStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
type RenderKind = 'master' | 'stems' | 'preview';
type RenderFormat = 'wav' | 'aiff' | 'flac' | 'mp3';

type UntypedSupabaseTables = {
  from: (table: string) => any;
};

const table = (name: string) => (supabase as unknown as UntypedSupabaseTables).from(name);

export interface CreateProjectSnapshotInput {
  projectId: string;
  workspaceId?: string;
  project: ProjectData;
  label?: string;
}

export interface ProjectSnapshotRecord {
  id: string;
  project_id: string;
  workspace_id: string;
  created_by: string;
  label: string | null;
  schema_version: string;
  data: ProjectData;
  size_bytes: number;
  created_at: string;
}

export interface RegisterProjectAssetInput {
  bucket: StorageBucket;
  path: string;
  projectId?: string | null;
  workspaceId?: string | null;
  hash?: string | null;
  sizeBytes?: number;
  durationSeconds?: number | null;
  format?: string | null;
  sampleRate?: number | null;
  licenseState?: 'unknown' | 'owned' | 'royalty-free' | 'marketplace-licensed' | 'restricted';
  metadata?: Record<string, unknown>;
}

export interface ProjectAssetRecord {
  id: string;
  project_id: string | null;
  workspace_id: string | null;
  owner_id: string;
  bucket: StorageBucket;
  path: string;
  hash: string | null;
  size_bytes: number;
  duration_seconds: number | null;
  format: string | null;
  sample_rate: number | null;
  license_state: string;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface CreateRenderJobInput {
  projectId: string;
  workspaceId?: string | null;
  kind?: RenderKind;
  format?: RenderFormat;
  bitDepth?: 16 | 24 | 32;
  sampleRate?: 44100 | 48000 | 88200 | 96000 | 192000;
  input?: Record<string, unknown>;
}

export interface RenderJobRecord {
  id: string;
  project_id: string;
  workspace_id: string;
  requested_by: string;
  kind: RenderKind;
  status: ProjectOsStatus;
  format: RenderFormat;
  bit_depth: number;
  sample_rate: number;
  input: Record<string, unknown>;
  output_asset_id: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  completed_at: string | null;
}

export interface RecordUsageEventInput {
  metric: UsageMetric;
  quantity?: number;
  workspaceId?: string | null;
  tierAtEvent?: Tier;
  metadata?: Record<string, unknown>;
  periodStart?: string;
}

export type UsageSummary = Record<UsageMetric, number>;

const emptyUsageSummary = (): UsageSummary => ({
  storage_bytes: 0,
  ai_action: 0,
  render_minutes: 0,
  sample_claim: 0,
  collaborator_seat: 0,
  snapshot: 0,
});

const jsonSizeBytes = (value: unknown): number => {
  const encoded = JSON.stringify(value);
  return new TextEncoder().encode(encoded).byteLength;
};

const currentMonthStart = (): string => {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`;
};

const assertAllowedBucket = (bucket: StorageBucket): void => {
  if (!STORAGE_BUCKETS.includes(bucket)) {
    throw new Error(`Unsupported storage bucket: ${bucket}`);
  }
};

class ProjectOsService {
  private async requireUserId(): Promise<string> {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) {
      throw new Error('Authentication is required for Project OS operations.');
    }

    return data.user.id;
  }

  private async resolveWorkspaceId(projectId: string, workspaceId?: string | null): Promise<string> {
    if (workspaceId) return workspaceId;

    const { data, error } = await table('projects')
      .select('workspace_id')
      .eq('id', projectId)
      .single();

    if (error || !data?.workspace_id) {
      throw new Error(`Unable to resolve workspace for project ${projectId}.`);
    }

    return data.workspace_id;
  }

  private async resolveTierAtEvent(userId: string, explicitTier?: Tier): Promise<Tier> {
    if (explicitTier) return explicitTier;

    const { data } = await table('profiles')
      .select('tier')
      .eq('id', userId)
      .maybeSingle();

    return resolveTier(data?.tier);
  }

  async createSnapshot(input: CreateProjectSnapshotInput): Promise<ProjectSnapshotRecord> {
    const userId = await this.requireUserId();
    const workspaceId = await this.resolveWorkspaceId(input.projectId, input.workspaceId);
    const schemaVersion = input.project.version || PROJECT_SCHEMA_VERSION;

    const { data, error } = await table('project_snapshots')
      .insert({
        project_id: input.projectId,
        workspace_id: workspaceId,
        created_by: userId,
        label: input.label || null,
        schema_version: schemaVersion,
        data: input.project,
        size_bytes: jsonSizeBytes(input.project),
      })
      .select('*')
      .single();

    if (error) throw new Error(`Failed to create project snapshot: ${error.message}`);
    await this.recordUsageEvent({
      metric: 'snapshot',
      quantity: 1,
      workspaceId,
      metadata: { projectId: input.projectId, snapshotId: data.id },
    });

    return data as ProjectSnapshotRecord;
  }

  async listSnapshots(projectId: string, limit = 30): Promise<ProjectSnapshotRecord[]> {
    const { data, error } = await table('project_snapshots')
      .select('*')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw new Error(`Failed to list project snapshots: ${error.message}`);
    return (data || []) as ProjectSnapshotRecord[];
  }

  async restoreSnapshot(snapshotId: string): Promise<ProjectData> {
    const { data: snapshot, error: snapshotError } = await table('project_snapshots')
      .select('*')
      .eq('id', snapshotId)
      .single();

    if (snapshotError || !snapshot) {
      throw new Error(`Failed to load project snapshot: ${snapshotError?.message || snapshotId}`);
    }

    const projectData = snapshot.data as ProjectData;
    const { error: updateError } = await table('projects')
      .update({
        data: projectData,
        updated_at: new Date().toISOString(),
      })
      .eq('id', snapshot.project_id);

    if (updateError) throw new Error(`Failed to restore project snapshot: ${updateError.message}`);
    return projectData;
  }

  async registerAsset(input: RegisterProjectAssetInput): Promise<ProjectAssetRecord> {
    const userId = await this.requireUserId();
    assertAllowedBucket(input.bucket);
    const workspaceId = input.projectId
      ? await this.resolveWorkspaceId(input.projectId, input.workspaceId)
      : input.workspaceId || null;

    const { data, error } = await table('project_assets')
      .upsert({
        bucket: input.bucket,
        path: input.path,
        project_id: input.projectId || null,
        workspace_id: workspaceId,
        owner_id: userId,
        hash: input.hash || null,
        size_bytes: input.sizeBytes || 0,
        duration_seconds: input.durationSeconds || null,
        format: input.format || null,
        sample_rate: input.sampleRate || null,
        license_state: input.licenseState || 'unknown',
        metadata: input.metadata || {},
        updated_at: new Date().toISOString(),
      }, {
        onConflict: 'bucket,path',
      })
      .select('*')
      .single();

    if (error) throw new Error(`Failed to register project asset: ${error.message}`);
    if (input.sizeBytes && input.sizeBytes > 0) {
      await this.recordUsageEvent({
        metric: 'storage_bytes',
        quantity: input.sizeBytes,
        workspaceId,
        metadata: { bucket: input.bucket, path: input.path, projectId: input.projectId || null },
      });
    }

    return data as ProjectAssetRecord;
  }

  async listProjectAssets(projectId: string): Promise<ProjectAssetRecord[]> {
    const { data, error } = await table('project_assets')
      .select('*')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false });

    if (error) throw new Error(`Failed to list project assets: ${error.message}`);
    return (data || []) as ProjectAssetRecord[];
  }

  async createRenderJob(input: CreateRenderJobInput): Promise<RenderJobRecord> {
    const userId = await this.requireUserId();
    const workspaceId = await this.resolveWorkspaceId(input.projectId, input.workspaceId);

    const { data, error } = await table('render_jobs')
      .insert({
        project_id: input.projectId,
        workspace_id: workspaceId,
        requested_by: userId,
        kind: input.kind || 'master',
        status: 'queued',
        format: input.format || 'wav',
        bit_depth: input.bitDepth || 24,
        sample_rate: input.sampleRate || 48000,
        input: input.input || {},
      })
      .select('*')
      .single();

    if (error) throw new Error(`Failed to create render job: ${error.message}`);
    return data as RenderJobRecord;
  }

  async updateRenderJobStatus(
    renderJobId: string,
    status: ProjectOsStatus,
    patch: { outputAssetId?: string | null; error?: string | null } = {}
  ): Promise<RenderJobRecord> {
    const now = new Date().toISOString();
    const payload: Record<string, unknown> = {
      status,
      updated_at: now,
    };

    if (status === 'running') payload.started_at = now;
    if (status === 'succeeded' || status === 'failed' || status === 'cancelled') payload.completed_at = now;
    if (patch.outputAssetId !== undefined) payload.output_asset_id = patch.outputAssetId;
    if (patch.error !== undefined) payload.error = patch.error;

    const { data, error } = await table('render_jobs')
      .update(payload)
      .eq('id', renderJobId)
      .select('*')
      .single();

    if (error) throw new Error(`Failed to update render job: ${error.message}`);
    return data as RenderJobRecord;
  }

  async listRenderJobs(projectId: string, limit = 20): Promise<RenderJobRecord[]> {
    const { data, error } = await table('render_jobs')
      .select('*')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw new Error(`Failed to list render jobs: ${error.message}`);
    return (data || []) as RenderJobRecord[];
  }

  async recordUsageEvent(input: RecordUsageEventInput): Promise<void> {
    const userId = await this.requireUserId();
    const tierAtEvent = await this.resolveTierAtEvent(userId, input.tierAtEvent);

    const { error } = await table('usage_events')
      .insert({
        user_id: userId,
        workspace_id: input.workspaceId || null,
        metric: input.metric,
        quantity: input.quantity ?? 1,
        period_start: input.periodStart || currentMonthStart(),
        tier_at_event: tierAtEvent,
        metadata: input.metadata || {},
      });

    if (error) throw new Error(`Failed to record usage event: ${error.message}`);
  }

  async getUsageSummary(input: { workspaceId?: string | null; periodStart?: string } = {}): Promise<UsageSummary> {
    const userId = await this.requireUserId();
    const periodStart = input.periodStart || currentMonthStart();

    let query = table('usage_events')
      .select('metric, quantity')
      .eq('period_start', periodStart);

    query = input.workspaceId
      ? query.eq('workspace_id', input.workspaceId)
      : query.eq('user_id', userId);

    const { data, error } = await query;
    if (error) throw new Error(`Failed to load usage summary: ${error.message}`);

    const summary = emptyUsageSummary();
    for (const event of data || []) {
      if (event.metric in summary) {
        summary[event.metric as UsageMetric] += Number(event.quantity || 0);
      }
    }

    return summary;
  }
}

export const projectOsService = new ProjectOsService();
