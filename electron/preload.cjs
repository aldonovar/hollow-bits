const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electron', {
    platform: process.platform,
    minimize: () => ipcRenderer.send('window-minimize'),
    maximize: () => ipcRenderer.send('window-maximize'),
    close: () => ipcRenderer.send('window-close'),
    getWindowState: () => ipcRenderer.invoke('window-get-state'),
    onWindowStateChange: (callback) => {
        const handler = (_event, payload) => {
            callback(payload);
        };

        ipcRenderer.on('window-state-changed', handler);
        return () => ipcRenderer.removeListener('window-state-changed', handler);
    },

    // File System Bridges
    saveProject: (data, filename) => ipcRenderer.invoke('save-project', data, filename),
    openProject: () => ipcRenderer.invoke('open-project'),
    selectFiles: () => ipcRenderer.invoke('select-files'),
    readFileFromPath: (filePath) => ipcRenderer.invoke('read-file-from-path', filePath),
    selectDirectory: () => ipcRenderer.invoke('select-directory'),
    scanDirectoryFiles: (request) => ipcRenderer.invoke('scan-directory-files', request),
    transcodeAudio: (request) => ipcRenderer.invoke('transcode-audio', request),
});
