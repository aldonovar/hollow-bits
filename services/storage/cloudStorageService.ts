import { supabase } from '../../../lib/supabase';

/**
 * Service to manage cloud storage operations for audio files in Supabase.
 */
class CloudStorageService {
  private readonly BUCKET_NAME = 'project-audio-assets';

  public async uploadAudioToCloud(projectId: string, fileId: string, data: Blob): Promise<string> {
    const filePath = `${projectId}/${fileId}.wav`;
    
    const { data: uploadData, error } = await supabase.storage
      .from(this.BUCKET_NAME)
      .upload(filePath, data, {
        cacheControl: '31536000',
        upsert: true,
        contentType: 'audio/wav'
      });

    if (error) {
      console.error('Cloud upload error:', error);
      throw new Error(`Failed to upload to cloud: ${error.message}`);
    }

    return uploadData.path;
  }

  public async downloadAudioFromCloud(projectId: string, fileId: string): Promise<Blob> {
    const filePath = `${projectId}/${fileId}.wav`;
    
    const { data, error } = await supabase.storage
      .from(this.BUCKET_NAME)
      .download(filePath);

    if (error) {
      console.error('Cloud download error:', error);
      throw new Error(`Failed to download from cloud: ${error.message}`);
    }

    return data;
  }
}

export const cloudStorageService = new CloudStorageService();
