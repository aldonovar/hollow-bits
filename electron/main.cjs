const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const os = require('node:os');
const { spawn } = require('node:child_process');

const AUDIO_FORMATS = new Set(['wav', 'aiff', 'flac', 'mp3']);
const AUDIO_MIME_BY_FORMAT = {
    wav: 'audio/wav',
    aiff: 'audio/aiff',
    flac: 'audio/flac',
    mp3: 'audio/mpeg'
};

let ffmpegBinaryPath = null;
try {
    const resolved = require('ffmpeg-static');
    if (resolved) {
        ffmpegBinaryPath = resolved.includes('app.asar')
            ? resolved.replace('app.asar', 'app.asar.unpacked')
            : resolved;
    }
} catch (error) {
    ffmpegBinaryPath = null;
    console.warn('FFmpeg static binary is not available.', error);
}

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const toNodeBuffer = (value) => {
    if (!value) return null;
    if (Buffer.isBuffer(value)) return value;
    if (value instanceof ArrayBuffer) return Buffer.from(new Uint8Array(value));
    if (ArrayBuffer.isView(value)) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
    if (typeof value === 'object' && value.type === 'Buffer' && Array.isArray(value.data)) {
        return Buffer.from(value.data);
    }
    return null;
};

const getCodecArgs = (format, bitDepth) => {
    if (format === 'wav') {
        const codec = bitDepth === 32 ? 'pcm_f32le' : bitDepth === 24 ? 'pcm_s24le' : 'pcm_s16le';
        return ['-c:a', codec];
    }

    if (format === 'aiff') {
        const codec = bitDepth === 32 ? 'pcm_f32be' : bitDepth === 24 ? 'pcm_s24be' : 'pcm_s16be';
        return ['-c:a', codec];
    }

    if (format === 'flac') {
        const sampleFmt = bitDepth <= 16 ? 's16' : 's32';
        return ['-c:a', 'flac', '-compression_level', '8', '-sample_fmt', sampleFmt];
    }

    return ['-c:a', 'libmp3lame', '-b:a', '320k', '-joint_stereo', '1'];
};

const runFfmpeg = (args) => new Promise((resolve, reject) => {
    if (!ffmpegBinaryPath) {
        reject(new Error('FFmpeg no esta disponible en esta build.'));
        return;
    }

    const child = spawn(ffmpegBinaryPath, args, {
        windowsHide: true
    });

    let stderr = '';

    child.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
    });

    child.on('error', (error) => {
        reject(error);
    });

    child.on('close', (code) => {
        if (code === 0) {
            resolve();
            return;
        }

        reject(new Error(stderr || `FFmpeg finalizo con codigo ${code}.`));
    });
});

const DIRECTORY_SCAN_LIMIT = 10000;
const MAX_DIRECT_FILE_READ_BYTES = 512 * 1024 * 1024;
const MAX_IMPORT_FILE_BYTES = 256 * 1024 * 1024;
const MAX_IMPORT_BATCH_BYTES = 1024 * 1024 * 1024;

let mainWindow = null;

const logMainError = (label, error) => {
    const message = error instanceof Error
        ? `${error.message}\n${error.stack || ''}`.trim()
        : String(error);
    console.error(`[main:${label}] ${message}`);
};

process.on('uncaughtException', (error) => {
    logMainError('uncaughtException', error);
});

process.on('unhandledRejection', (reason) => {
    logMainError('unhandledRejection', reason);
});

const sanitizeExtensions = (extensions) => {
    if (!Array.isArray(extensions)) return new Set();

    return new Set(
        extensions
            .filter((entry) => typeof entry === 'string')
            .map((entry) => entry.trim().toLowerCase().replace(/^\./, ''))
            .filter((entry) => entry.length > 0)
    );
};

const scanDirectoryRecursive = async (rootDirectory, allowedExtensions) => {
    const queue = [rootDirectory];
    const collected = [];

    while (queue.length > 0 && collected.length < DIRECTORY_SCAN_LIMIT) {
        const current = queue.pop();
        if (!current) continue;

        let entries = [];
        try {
            entries = await fs.readdir(current, { withFileTypes: true });
        } catch {
            continue;
        }

        for (const entry of entries) {
            if (collected.length >= DIRECTORY_SCAN_LIMIT) break;

            const fullPath = path.join(current, entry.name);

            if (entry.isDirectory()) {
                queue.push(fullPath);
                continue;
            }

            if (!entry.isFile()) continue;

            const extension = path.extname(entry.name).toLowerCase().replace(/^\./, '');
            if (allowedExtensions.size > 0 && !allowedExtensions.has(extension)) {
                continue;
            }

            let size = 0;
            try {
                const fileStats = await fs.stat(fullPath);
                size = fileStats.size;
            } catch {
                size = 0;
            }

            collected.push({
                name: entry.name,
                path: fullPath,
                size
            });
        }
    }

    return collected;
};

const serializeWindowState = (win) => {
    if (!win) {
        return {
            isMaximized: false,
            isMinimized: false,
            isFullScreen: false
        };
    }

    return {
        isMaximized: win.isMaximized(),
        isMinimized: win.isMinimized(),
        isFullScreen: win.isFullScreen()
    };
};

const broadcastWindowState = (win) => {
    if (!win || win.isDestroyed()) return;
    win.webContents.send('window-state-changed', serializeWindowState(win));
};

// IPC Handlers
ipcMain.on('window-minimize', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    win?.minimize();
});
ipcMain.on('window-maximize', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win?.isMaximized()) {
        win.unmaximize();
    } else {
        win?.maximize();
    }
    broadcastWindowState(win);
});
ipcMain.on('window-close', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    win?.close();
});
ipcMain.handle('window-get-state', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    return serializeWindowState(win);
});

// --- File System Handlers ---

// Save Project
ipcMain.handle('save-project', async (event, data, defaultName) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
        title: 'Guardar Proyecto Ethereal',
        defaultPath: defaultName || 'Sin-titulo.esp',
        filters: [{ name: 'Ethereal Studio Project', extensions: ['esp'] }]
    });

    if (canceled || !filePath) {
        return { success: false };
    }

    await fs.writeFile(filePath, data, 'utf-8');
    return { success: true, filePath: path.basename(filePath, '.esp') };
});

// Open Project
ipcMain.handle('open-project', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const { filePaths } = await dialog.showOpenDialog(win, {
        title: 'Abrir Proyecto',
        properties: ['openFile'],
        filters: [{ name: 'Ethereal Studio Project', extensions: ['esp'] }]
    });

    if (filePaths && filePaths.length > 0) {
        const content = await fs.readFile(filePaths[0], 'utf-8');
        const filename = path.basename(filePaths[0]); // Extract filename
        return { text: content, filename };
    }
    return null;
});

// Select Audio Files
ipcMain.handle('select-files', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const { filePaths } = await dialog.showOpenDialog(win, {
        title: 'Importar Audio',
        properties: ['openFile', 'multiSelections'],
        filters: [
            { name: 'Audio Files', extensions: ['wav', 'mp3', 'aif', 'aiff', 'flac', 'ogg'] }
        ]
    });

    if (filePaths && filePaths.length > 0) {
        const files = [];
        let accumulatedSize = 0;

        for (const filePath of filePaths) {
            const stats = await fs.stat(filePath);
            if (!stats.isFile()) {
                continue;
            }

            if (stats.size > MAX_IMPORT_FILE_BYTES) {
                throw new Error(`El archivo ${path.basename(filePath)} supera el limite de 256 MB.`);
            }

            accumulatedSize += stats.size;
            if (accumulatedSize > MAX_IMPORT_BATCH_BYTES) {
                throw new Error('La importacion supera el limite de 1 GB por lote. Importa menos archivos por tanda.');
            }

            const buffer = await fs.readFile(filePath);
            const data = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);

            files.push({
                name: path.basename(filePath),
                path: filePath,
                data
            });
        }

        return files;
    }
    return [];
});

ipcMain.handle('read-file-from-path', async (_event, rawFilePath) => {
    const filePath = typeof rawFilePath === 'string' ? rawFilePath.trim() : '';
    if (!filePath) return null;

    try {
        const stats = await fs.stat(filePath);
        if (!stats.isFile()) return null;
        if (stats.size > MAX_DIRECT_FILE_READ_BYTES) {
            throw new Error('El archivo excede el tamano permitido para carga directa.');
        }

        const buffer = await fs.readFile(filePath);
        const data = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);

        return {
            name: path.basename(filePath),
            path: filePath,
            data
        };
    } catch (error) {
        console.error('read-file-from-path failed', error);
        return null;
    }
});

ipcMain.handle('select-directory', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
        title: 'Seleccionar carpeta',
        properties: ['openDirectory']
    });

    if (canceled || !filePaths || filePaths.length === 0) {
        return null;
    }

    return filePaths[0];
});

ipcMain.handle('scan-directory-files', async (_event, payload) => {
    const directory = typeof payload?.directory === 'string' ? payload.directory : '';
    if (!directory) return [];

    try {
        const stats = await fs.stat(directory);
        if (!stats.isDirectory()) return [];
    } catch {
        return [];
    }

    const extensions = sanitizeExtensions(payload?.extensions);
    const files = await scanDirectoryRecursive(directory, extensions);
    return files;
});

ipcMain.handle('transcode-audio', async (_event, payload) => {
    const format = String(payload?.outputFormat || '').toLowerCase();
    if (!AUDIO_FORMATS.has(format)) {
        return { success: false, error: 'Formato de salida invalido.' };
    }

    if (!ffmpegBinaryPath) {
        return { success: false, error: 'FFmpeg no esta disponible en esta build.' };
    }

    const inputBuffer = toNodeBuffer(payload?.inputData);
    if (!inputBuffer || inputBuffer.length === 0) {
        return { success: false, error: 'No se recibieron datos de audio validos.' };
    }

    const requestedBitDepth = clamp(Number(payload?.bitDepth || 16), 16, 32);
    const bitDepth = requestedBitDepth <= 16 ? 16 : requestedBitDepth <= 24 ? 24 : 32;
    const requestedSampleRate = clamp(Number(payload?.sampleRate || 44100), 8000, 192000);
    const sampleRate = format === 'mp3' ? Math.min(48000, requestedSampleRate) : requestedSampleRate;

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ethereal-export-'));
    const inputPath = path.join(tempDir, 'input.wav');
    const outputPath = path.join(tempDir, `output.${format}`);

    try {
        await fs.writeFile(inputPath, inputBuffer);

        const codecArgs = getCodecArgs(format, bitDepth);
        const ffmpegArgs = [
            '-hide_banner',
            '-loglevel', 'error',
            '-y',
            '-i', inputPath,
            '-ar', String(sampleRate),
            '-ac', '2',
            ...codecArgs,
            outputPath
        ];

        await runFfmpeg(ffmpegArgs);
        const outputBuffer = await fs.readFile(outputPath);
        const data = outputBuffer.buffer.slice(outputBuffer.byteOffset, outputBuffer.byteOffset + outputBuffer.byteLength);

        return {
            success: true,
            data,
            extension: format,
            mimeType: AUDIO_MIME_BY_FORMAT[format]
        };
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Fallo el proceso de transcodificacion.';
        return { success: false, error: message };
    } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
    }
});


// Handle creating/removing shortcuts on Windows when installing/uninstalling.
try {
    if (require('electron-squirrel-startup')) {
        app.quit();
    }
} catch (e) {
    // Config not critical for dev
}

const createWindow = () => {
    const windowIcon = app.isPackaged ? undefined : path.join(__dirname, '../build/icon.png');

    // Create the browser window.
    mainWindow = new BrowserWindow({
        width: 1400,
        height: 900,
        icon: windowIcon,
        frame: false, // Custom TitleBar required
        transparent: false,
        backgroundColor: '#0f1118',
        show: false,
        thickFrame: true,
        roundedCorners: true,
        webPreferences: {
            preload: path.join(__dirname, 'preload.cjs'),
            contextIsolation: true,
            nodeIntegration: false,
        },
        autoHideMenuBar: true,
    });

    const notifyState = () => broadcastWindowState(mainWindow);
    mainWindow.on('maximize', notifyState);
    mainWindow.on('unmaximize', notifyState);
    mainWindow.on('minimize', notifyState);
    mainWindow.on('restore', notifyState);
    mainWindow.on('enter-full-screen', notifyState);
    mainWindow.on('leave-full-screen', notifyState);
    mainWindow.webContents.on('did-finish-load', notifyState);
    mainWindow.on('closed', () => {
        mainWindow = null;
    });
    mainWindow.on('unresponsive', () => {
        logMainError('window-unresponsive', 'Renderer no responde.');
    });
    mainWindow.webContents.on('render-process-gone', (_event, details) => {
        logMainError('render-process-gone', `${details.reason} (exitCode=${details.exitCode})`);
    });
    mainWindow.webContents.on('did-fail-load', (_event, code, description, validatedURL) => {
        logMainError('did-fail-load', `code=${code} url=${validatedURL} reason=${description}`);
    });
    mainWindow.webContents.on('did-finish-load', () => {
        try {
            mainWindow.webContents.setAudioMuted(false);
        } catch {
            // keep running even if platform does not support call
        }
    });

    // Check if running in dev mode
    const isDev = process.env.NODE_ENV === 'development' || process.argv.includes('--dev');

    if (isDev) {
        console.log("Loading Development URL: http://localhost:3000");
        mainWindow.loadURL('http://localhost:3000');
        // mainWindow.webContents.openDevTools();
    } else {
        mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
    }

    mainWindow.once('ready-to-show', () => {
        if (!mainWindow.isDestroyed()) {
            try {
                mainWindow.webContents.setAudioMuted(false);
            } catch {
                // keep running even if platform does not support call
            }
            mainWindow.show();
            broadcastWindowState(mainWindow);
        }
    });
};

app.whenReady().then(() => {
    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('child-process-gone', (_event, details) => {
    logMainError('child-process-gone', `${details.type} (${details.reason}, exitCode=${details.exitCode})`);
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});
