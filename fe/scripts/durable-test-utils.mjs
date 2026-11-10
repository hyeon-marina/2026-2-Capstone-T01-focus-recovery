// Read the actual committed IndexedDB aggregate, never a session-storage mirror.
export async function readDurable(page, key) {
  return page.evaluate(async key => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('focus-recovery');
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction('state'), request = tx.objectStore('state').get('current');
        tx.oncomplete = () => resolve(key ? request.result.value[key] : request.result);
        tx.onabort = () => reject(tx.error);
      });
    } finally { db.close(); }
  }, key);
}
