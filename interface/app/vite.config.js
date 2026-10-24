// The interface's build. The routine translation is the CLI's own (../../src/routine-spec.js), imported as is, so
// the editor and the CLI read and write routines with the same code.
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const cliSrc = fileURLToPath(new URL('../../src', import.meta.url));

export default defineConfig({
    plugins: [react()],
    resolve: { alias: { '@cli': cliSrc } },
    server: {
        fs: { allow: ['.', cliSrc] },
        // `npm run dev` talks to the interface server (npm run ui) for the data; changeOrigin keeps its host check happy.
        proxy: { '/api': { target: 'http://127.0.0.1:3457', changeOrigin: true } },
    },
    build: { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 1500 },
});
