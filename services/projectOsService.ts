import {
  STORAGE_BUCKETS,
  type StorageBucket,
  type Tier,
  type UsageMetric,
} from '@hollowbits/core';
import type { ProjectData } from '../types';
import { supabase } from './supabase';

type ProjectOsStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
type RenderKind = 'master' | 'stems' | 'preview';
type RenderFormat = 'wav' | 'aiff' | 'flac' | 'mp3';

type UntypedSupabase = {
  from: (table: string) => any;
  rpc: (fn: string, args?: Record<string, unknown>) => Promise<{ data: any; error: any }>;
};

const db = supabase as unknown as UntypedSupabase;
const table = (name: string) => db.from(name);

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

const currentMonthStart = (): string => {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`;
};

const assertAllowedBucket = (bucket: StorageBucket): void => {
  if (!STORAGE_BUCKETS.includes(bucket)) {
    throw new Error(`Unsupported storage bucket: ${bucket}`);
  }
};

const firstRpcRow = <T>(data: T[] | T | null | undefined, label: string): T => {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error(`${label} returned no data.`);
  return row as T;
};

class ProjectOsService {
  async createSnapshot(input: CreateProjectSnapshotInput): Promise<ProjectSnapshotRecord> {
    const { data, error } = await db.rpc('create_project_snapshot_with_limit', {
      p_project_id: input.projectId,
      p_label: input.label || null,
      p_data: input.project as unknown as Record<string, unknown>,
    });

    if (error) throw new Error(`Failed to create project snapshot: ${error.message}`);
    return firstRpcRow<ProjectSnapshotRecord>(data, 'Project snapshot');
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
    assertAllowedBucket(input.bucket);
    const { data, error } = await db.rpc('register_project_asset_with_limit', {
      p_bucket: input.bucket,
      p_path: input.path,
      p_project_id: input.projectId || null,
      p_workspace_id: input.workspaceId || null,
      p_hash: input.hash || null,
      p_size_bytes: input.sizeBytes || 0,
      p_duration_seconds: input.durationSeconds || null,
      p_format: input.format || null,
      p_sample_rate: input.sampleRate || null,
      p_license_state: input.licenseState || 'unknown',
      p_metadata: input.metadata || {},
    });

    if (error) throw new Error(`Failed to register project asset: ${error.message}`);
    return firstRpcRow<ProjectAssetRecord>(data, 'Project asset');
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
    const { data, error } = await db.rpc('create_render_job_with_limit', {
      p_project_id: input.projectId,
      p_kind: input.kind || 'master',
      p_format: input.format || 'wav',
      p_bit_depth: input.bitDepth || 24,
      p_sample_rate: input.sampleRate || 48000,
      p_input: input.input || {},
    });

    if (error) throw new Error(`Failed to create render job: ${error.message}`);
    return firstRpcRow<RenderJobRecord>(data, 'Render job');
  }

  async updateRenderJobStatus(
    renderJobId: string,
    status: ProjectOsStatus,
    patch: { outputAssetId?: string | null; error?: string | null } = {}
  ): Promise<RenderJobRecord> {
    const { data, error } = await db.rpc('update_render_job_status_with_scope', {
      p_render_job_id: renderJobId,
      p_status: status,
      p_output_asset_id: patch.outputAssetId ?? null,
      p_error: patch.error ?? null,
    });

    if (error) throw new Error(`Failed to update render job: ${error.message}`);
    return firstRpcRow<RenderJobRecord>(data, 'Render job');
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
    void input;
    console.warn('[ProjectOS] Usage events are recorded by backend RPCs only.');
  }

  async getUsageSummary(input: { workspaceId?: string | null; periodStart?: string } = {}): Promise<UsageSummary> {
    const { data, error } = await db.rpc('get_project_os_usage', {
      p_workspace_id: input.workspaceId || null,
      p_period_start: input.periodStart || currentMonthStart(),
    });

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
