import { installV2Browser } from '../src/v2/browser';
declare const __COLLECTION_PILOT__: boolean;
installV2Browser({ uiPath: 'participant/index.html', pilot: __COLLECTION_PILOT__, participant: true });
chrome.action.onClicked.addListener(() => { void chrome.tabs.create({ url: chrome.runtime.getURL('participant/index.html') }); });
