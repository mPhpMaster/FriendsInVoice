// BetterDiscord keeps one plugin data file for every Discord on the computer, and each Discord writes all of it back,
// so anything that belongs to one account is saved in this Discord's own IndexedDB, under the account's id
const DB_NAME = "FriendsInVoice";
const STORES = ["accounts", "voiceLogs"];

let dbPromise = null;
function openDb() {
    return dbPromise ??= new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 1);
        request.onupgradeneeded = () => { for (const name of STORES) request.result.createObjectStore(name); };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    }).catch(error => { dbPromise = null; throw error; });
}

function run(storeName, mode, action) {
    return openDb().then(db => new Promise((resolve, reject) => {
        const transaction = db.transaction(storeName, mode);
        const request = action(transaction.objectStore(storeName));
        transaction.oncomplete = () => resolve(request.result);
        transaction.onerror = () => reject(transaction.error);
    }));
}

/** a { get, put } store for one kind of per-account data */
export function accountStore(storeName) {
    return {
        get: id => run(storeName, "readonly", store => store.get(id)),
        put: (id, value) => run(storeName, "readwrite", store => store.put(value, id))
    };
}

