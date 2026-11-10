import { installV2Browser } from '../src/v2/browser';
declare const __SYNTHETIC_V2__: boolean;
if (!__SYNTHETIC_V2__) throw new Error('V2_SYNTHETIC_ONLY');
installV2Browser({ uiPath: 'synthetic/harness.html', pilot: true, participant: false });
