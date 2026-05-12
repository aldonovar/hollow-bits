import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  Cloud,
  Database,
  HardDrive,
  History,
  Loader2,
  RotateCcw,
  Save,
  Server,
  Sparkles,
} from 'lucide-react';
import {
  formatUsageMetric,
  getUsageLimitForMetric,
  type Tier,
  type UsageMetric,
} from '@hollowbits/core';
import {
  projectOsService,
  type ProjectAssetRecord,
  type ProjectSnapshotRecord,
  type RenderJobRecord,
  type UsageSummary,
} from '../services/projectOsService';
import type { ProjectData } from '../types';

type ProjectOsTab = 'snapshots' | 'assets' | 'usage' | 'render';

interface ProjectOsPanelProps {
  projectId: string | null;
  projectName: string;
  tier: Tier;
  buildSnapshot: () => ProjectData;
  onRestoreProject: (project: ProjectData, preferredName?: string) => Promise<void>;
  onUpgrade?: () => void;
}

const tabs: Array<{ id: ProjectOsTab; label: string; icon: React.ElementType }> = [
  { id: 'snapshots', label: 'Snapshots', icon: History },
  { id: 'assets', label: 'Assets', icon: HardDrive },
  { id: 'usage', label: 'Usage', icon: Activity },
  { id: 'render', label: 'Render Queue', icon: Server },
];

const usageRows: Array<{ metric: UsageMetric; label: string }> = [
  { metric: 'storage_bytes', label: 'Storage' },
  { metric: 'snapshot', label: 'Snapshots' },
  { metric: 'render_minutes', label: 'Render' },
  { metric: 'ai_action', label: 'AI Actions' },
  { metric: 'sample_claim', label: 'Samples' },
  { metric: 'collaborator_seat', label: 'Seats' },
];

const formatDate = (value: string | null | undefined): string => {
  if (!value) return '-';
  return new Date(value).toLocaleString('es-MX', {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const isUpgradeError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error);
  return /upgrade|requires Pro|quota exceeded|requires Pro or Studio/i.test(message);
};

const limitLabel = (tier: Tier, metric: UsageMetric): string => {
  const limit = getUsageLimitForMetric(tier, metric);
  if (limit === -1) return 'Ilimitado';
  return formatUsageMetric(metric, limit);
};

export const ProjectOsPanel: React.FC<ProjectOsPanelProps> = ({
  projectId,
  projectName,
  tier,
  buildSnapshot,
  onRestoreProject,
  onUpgrade,
}) => {
  const [activeTab, setActiveTab] = useState<ProjectOsTab>('snapshots');
  const [snapshots, setSnapshots] = useState<ProjectSnapshotRecord[]>([]);
  const [assets, setAssets] = useState<ProjectAssetRecord[]>([]);
  const [renderJobs, setRenderJobs] = useState<RenderJobRecord[]>([]);
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [actionMessage, setActionMessage] = useState('');
  const [upgradeReason, setUpgradeReason] = useState('');

  const canUseSnapshots = tier !== 'free';
  const canUseCloudRender = tier !== 'free';

  const refresh = useCallback(async () => {
    if (!projectId) {
      setSnapshots([]);
      setAssets([]);
      setRenderJobs([]);
      setUsage(null);
      return;
    }

    setLoading(true);
    setActionMessage('');
    try {
      const [snapshotRows, assetRows, jobRows, usageSummary] = await Promise.all([
        projectOsService.listSnapshots(projectId),
        projectOsService.listProjectAssets(projectId),
        projectOsService.listRenderJobs(projectId),
        projectOsService.getUsageSummary(),
      ]);
      setSnapshots(snapshotRows);
      setAssets(assetRows);
      setRenderJobs(jobRows);
      setUsage(usageSummary);
    } catch (error) {
      console.error('[ProjectOS] Refresh failed:', error);
      setActionMessage(error instanceof Error ? error.message : 'No se pudo cargar Project OS.');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const createSnapshot = async () => {
    if (!projectId) return;
    if (!canUseSnapshots) {
      setUpgradeReason('Snapshots cloud requiere Pro o Studio.');
      return;
    }

    setActionMessage('Creando snapshot...');
    try {
      await projectOsService.createSnapshot({
        projectId,
        label: `${projectName} ${new Date().toLocaleDateString('es-MX')}`,
        project: buildSnapshot(),
      });
      setActionMessage('Snapshot creado.');
      await refresh();
    } catch (error) {
      console.error('[ProjectOS] Snapshot failed:', error);
      if (isUpgradeError(error)) setUpgradeReason('Snapshots cloud requiere Pro o Studio.');
      setActionMessage(error instanceof Error ? error.message : 'No se pudo crear el snapshot.');
    }
  };

  const restoreSnapshot = async (snapshot: ProjectSnapshotRecord) => {
    setActionMessage('Restaurando snapshot...');
    try {
      const project = await projectOsService.restoreSnapshot(snapshot.id);
      await onRestoreProject(project, snapshot.label || projectName);
      setActionMessage('Snapshot restaurado.');
      await refresh();
    } catch (error) {
      console.error('[ProjectOS] Restore failed:', error);
      setActionMessage(error instanceof Error ? error.message : 'No se pudo restaurar el snapshot.');
    }
  };

  const createRenderJob = async () => {
    if (!projectId) return;
    if (!canUseCloudRender) {
      setUpgradeReason('Cloud render requiere Pro o Studio.');
      return;
    }

    setActionMessage('Creando render job...');
    try {
      await projectOsService.createRenderJob({
        projectId,
        kind: 'master',
        format: 'wav',
        bitDepth: 24,
        sampleRate: 48000,
        input: { source: 'project-os-panel' },
      });
      setActionMessage('Render job en cola.');
      await refresh();
    } catch (error) {
      console.error('[ProjectOS] Render job failed:', error);
      if (isUpgradeError(error)) setUpgradeReason('Cloud render requiere Pro o Studio.');
      setActionMessage(error instanceof Error ? error.message : 'No se pudo crear el render job.');
    }
  };

  const usageSummary = useMemo(() => usage || {
    storage_bytes: 0,
    ai_action: 0,
    render_minutes: 0,
    sample_claim: 0,
    collaborator_seat: 0,
    snapshot: 0,
  }, [usage]);

  if (!projectId) {
    return (
      <div className="flex flex-col gap-4">
        <div className="border border-white/10 bg-black/30 rounded-sm p-4">
          <div className="flex items-center gap-3 text-white">
            <Cloud size={18} className="text-daw-violet" />
            <span className="text-sm font-bold">Project OS requiere un proyecto cloud.</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-white text-sm font-bold">{projectName}</div>
          <div className="text-[11px] text-gray-500 uppercase tracking-widest">{tier}</div>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          className="h-8 px-3 rounded-sm border border-white/10 bg-white/5 text-xs text-gray-200 hover:bg-white/10 flex items-center gap-2"
        >
          {loading ? <Loader2 size={13} className="animate-spin" /> : <Database size={13} />}
          Sync
        </button>
      </div>

      {upgradeReason && (
        <div className="border border-daw-violet/30 bg-daw-violet/10 rounded-sm p-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm text-white">
            <Sparkles size={15} className="text-daw-violet" />
            <span>{upgradeReason}</span>
          </div>
          <button
            type="button"
            onClick={onUpgrade}
            className="h-8 px-3 rounded-sm bg-daw-violet text-white text-xs font-bold hover:bg-daw-violet/80"
          >
            Ver planes
          </button>
        </div>
      )}

      <div className="grid grid-cols-4 gap-1 rounded-sm border border-white/10 bg-black/30 p-1">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`h-9 rounded-sm text-[11px] font-bold flex items-center justify-center gap-2 ${
                active ? 'bg-white text-black' : 'text-gray-400 hover:text-white hover:bg-white/5'
              }`}
            >
              <Icon size={13} />
              <span className="hidden sm:inline">{tab.label}</span>
            </button>
          );
        })}
      </div>

      {actionMessage && (
        <div className="text-xs text-gray-300 border border-white/10 bg-white/[0.03] rounded-sm p-2">
          {actionMessage}
        </div>
      )}

      {activeTab === 'snapshots' && (
        <div className="flex flex-col gap-3">
          <button
            type="button"
            onClick={() => void createSnapshot()}
            className="h-10 rounded-sm bg-white text-black text-xs font-black uppercase flex items-center justify-center gap-2 hover:bg-gray-200 disabled:opacity-50"
            disabled={loading}
          >
            <Save size={14} />
            Crear snapshot
          </button>
          <div className="flex flex-col gap-2 max-h-[310px] overflow-y-auto custom-scrollbar">
            {snapshots.length === 0 && <div className="text-xs text-gray-500">Sin snapshots cloud.</div>}
            {snapshots.map((snapshot) => (
              <div key={snapshot.id} className="border border-white/10 bg-black/30 rounded-sm p-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm text-white truncate">{snapshot.label || 'Snapshot'}</div>
                  <div className="text-[11px] text-gray-500">{formatDate(snapshot.created_at)} · {formatUsageMetric('storage_bytes', snapshot.size_bytes)}</div>
                </div>
                <button
                  type="button"
                  onClick={() => void restoreSnapshot(snapshot)}
                  className="h-8 w-8 rounded-sm border border-white/10 bg-white/5 text-gray-200 hover:bg-white/10 flex items-center justify-center"
                  title="Restaurar snapshot"
                >
                  <RotateCcw size={14} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {activeTab === 'assets' && (
        <div className="flex flex-col gap-2 max-h-[360px] overflow-y-auto custom-scrollbar">
          {assets.length === 0 && <div className="text-xs text-gray-500">Sin assets indexados.</div>}
          {assets.map((asset) => (
            <div key={asset.id} className="border border-white/10 bg-black/30 rounded-sm p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm text-white truncate">{asset.path}</div>
                <div className="text-[11px] text-gray-400">{formatUsageMetric('storage_bytes', asset.size_bytes)}</div>
              </div>
              <div className="mt-1 text-[11px] text-gray-500">{asset.bucket} · {asset.format || 'asset'} · {asset.license_state}</div>
            </div>
          ))}
        </div>
      )}

      {activeTab === 'usage' && (
        <div className="grid grid-cols-2 gap-2">
          {usageRows.map((row) => (
            <div key={row.metric} className="border border-white/10 bg-black/30 rounded-sm p-3">
              <div className="text-[11px] text-gray-500 uppercase tracking-widest">{row.label}</div>
              <div className="text-lg text-white font-bold mt-1">{formatUsageMetric(row.metric, usageSummary[row.metric])}</div>
              <div className="text-[11px] text-gray-500 mt-1">Límite {limitLabel(tier, row.metric)}</div>
            </div>
          ))}
        </div>
      )}

      {activeTab === 'render' && (
        <div className="flex flex-col gap-3">
          <button
            type="button"
            onClick={() => void createRenderJob()}
            className="h-10 rounded-sm bg-white text-black text-xs font-black uppercase flex items-center justify-center gap-2 hover:bg-gray-200 disabled:opacity-50"
            disabled={loading}
          >
            <Server size={14} />
            Queue master render
          </button>
          <div className="flex flex-col gap-2 max-h-[310px] overflow-y-auto custom-scrollbar">
            {renderJobs.length === 0 && <div className="text-xs text-gray-500">Sin render jobs.</div>}
            {renderJobs.map((job) => (
              <div key={job.id} className="border border-white/10 bg-black/30 rounded-sm p-3 flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm text-white">{job.kind} · {job.format}/{job.bit_depth}</div>
                  <div className="text-[11px] text-gray-500">{formatDate(job.created_at)} · {job.sample_rate}Hz</div>
                </div>
                <span className="text-[11px] uppercase tracking-widest text-gray-300">{job.status}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
