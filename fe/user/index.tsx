import { createRoot } from 'react-dom/client';
import { AlertPage } from './alert-page';
import { Popup } from './popup';
import './style.css';

const viewId = new URLSearchParams(location.search).get('alert');
if (viewId === null && chrome.extension.getViews({ type: 'popup' }).includes(window)) {
  document.documentElement.classList.add('toolbar-popup');
}
createRoot(document.getElementById('root')!).render(viewId === null ? <Popup /> : <AlertPage viewId={viewId} />);
