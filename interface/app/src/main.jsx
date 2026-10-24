import { setupIonicReact } from '@ionic/react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';

import '@ionic/react/css/core.css';
import '@ionic/react/css/normalize.css';
import '@ionic/react/css/structure.css';
import '@ionic/react/css/typography.css';
import '@ionic/react/css/padding.css';
import '@ionic/react/css/flex-utils.css';
import '@ionic/react/css/display.css';
import '@ionic/react/css/palettes/dark.system.css';
import './theme.css';

// Material look everywhere: the app is an Android app first, and one look is easier to keep consistent.
setupIonicReact({ mode: 'md' });

createRoot(document.getElementById('root')).render(<App />);
