import { supabase } from '../supabase';

/**
 * Service to manage cloud storage operations for audio files in Supabase.
 */
class CloudStorageService {
  private readonly BUCKET_NAME = 'project-audio';

  private buildAudioPath(projectId: string, fileId: string, extension: 'flac' | 'wav'): string {
    return `${projectId}/${fileId}.${extension}`;
  }

  private async buildScopedAudioPath(projectId: string, fileId: string, extension: 'flac' | 'wav'): Promise<string> {
    const { data } = await supabase.auth.getUser();
    const userId = data.user?.id;
    return userId
      ? `${userId}/${projectId}/${fileId}.${extension}`
      : this.buildAudioPath(projectId, fileId, extension);
  }

  private async buildDownloadCandidates(projectId: string, fileId: string): Promise<string[]> {
    const { data } = await supabase.auth.getUser();
    const userId = data.user?.id;
    const extensions: Array<'flac' | 'wav'> = ['flac', 'wav'];
    const scoped = userId
      ? extensions.map((extension) => `${userId}/${projectId}/${fileId}.${extension}`)
      : [];
    const legacy = extensions.map((extension) => this.buildAudioPath(projectId, fileId, extension));
    return [...scoped, ...legacy];
  }

  public async uploadAudioToCloud(projectId: string, fileId: string, data: Blob): Promise<string> {
    const isWav = data.type === 'audio/wav' || data.type === 'audio/x-wav' || data.type === '';
    const extension = isWav ? 'wav' : 'flac';
    const contentType = isWav ? 'audio/wav' : 'audio/flac';
    const filePath = await this.buildScopedAudioPath(projectId, fileId, extension);
    
    const { data: uploadData, error } = await supabase.storage
      .from(this.BUCKET_NAME)
      .upload(filePath, data, {
        cacheControl: '31536000',
        upsert: true,
        contentType: contentType
      });

    if (error) {
      console.error('Cloud upload error:', error);
      throw new Error(`Failed to upload to cloud: ${error.message}`);
    }

    return uploadData.path;
  }

  public async downloadAudioFromCloud(projectId: string, fileId: string): Promise<Blob> {
    const candidates = await this.buildDownloadCandidates(projectId, fileId);
    let lastError: { message?: string } | null = null;

    for (const filePath of candidates) {
      const { data, error } = await supabase.storage
        .from(this.BUCKET_NAME)
        .download(filePath);

      if (!error && data) {
        return data;
      }

      lastError = error;
    }

    console.error('Cloud download error:', lastError);
    throw new Error(`Failed to download from cloud: ${lastError?.message || 'missing object'}`);
  }
}

export const cloudStorageService = new CloudStorageService();
