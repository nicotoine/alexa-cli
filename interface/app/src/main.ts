import { mount } from 'svelte';
import App from './App.svelte';
import './app.css';

// Dark when the system is dark: shadcn's theme switches on the `dark` class.
const dark = window.matchMedia('(prefers-color-scheme: dark)');
const applyTheme = () => document.documentElement.classList.toggle('dark', dark.matches);
applyTheme();
dark.addEventListener('change', applyTheme);

mount(App, { target: document.getElementById('root')! });
