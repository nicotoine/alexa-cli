// The interface's build: Svelte 5, Tailwind 4, shadcn-svelte. The routine translation is the CLI's own
// (../../src/routine-spec.js), imported as is, so the editor and the CLI read and write routines with the same code.
import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const cliSrc = fileURLToPath(new URL('../../src', import.meta.url));

export default defineConfig({
    plugins: [tailwindcss(), svelte()],
    resolve: {
        alias: {
            $lib: fileURLToPath(new URL('./src/lib', import.meta.url)),
            '@cli': cliSrc,
        },
    },
    server: {
        fs: { allow: ['.', cliSrc] },
        // `npm run dev` talks to the interface server (npm run ui) for the data; changeOrigin keeps its host check happy.
        proxy: { '/api': { target: 'http://127.0.0.1:3457', changeOrigin: true } },
    },
    build: { outDir: 'dist', emptyOutDir: true },
});
