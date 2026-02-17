const { execFileSync } = require('node:child_process');
const { existsSync } = require('node:fs');
const path = require('node:path');

module.exports = async (context) => {
    if (context.electronPlatformName !== 'win32') return;

    const projectDir = context.packager.info.projectDir;
    const appOutDir = context.appOutDir;
    const productFilename = context.packager.appInfo.productFilename;
    const executablePath = path.join(appOutDir, `${productFilename}.exe`);
    const iconPath = path.join(projectDir, 'build', 'icon.ico');
    const rceditPath = path.join(projectDir, 'node_modules', 'electron-winstaller', 'vendor', 'rcedit.exe');

    if (!existsSync(executablePath)) {
        throw new Error(`No se encontro el ejecutable para icono: ${executablePath}`);
    }

    if (!existsSync(iconPath)) {
        throw new Error(`No se encontro el icono ICO: ${iconPath}`);
    }

    if (!existsSync(rceditPath)) {
        throw new Error(`No se encontro rcedit: ${rceditPath}`);
    }

    execFileSync(rceditPath, [executablePath, '--set-icon', iconPath], {
        stdio: 'inherit'
    });
};
