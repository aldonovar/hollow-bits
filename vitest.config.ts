import path from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
    resolve: {
        alias: {
            '@hollowbits/core': path.resolve(__dirname, 'hollowbits-core/index.ts')
        }
    },
    test: {
        environment: 'jsdom',
        setupFiles: ['./tests/setup.ts'],
        include: ['tests/**/*.test.ts', 'tests/**/*.test.js'],
        reporters: ['default'],
        clearMocks: true
    }
});
