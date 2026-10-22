const { contextBridge, ipcRenderer } = require('electron');
const methods = ['petDrag','petDock','windowTransitionReady','getCompanionState','companionSettings','companionMemory','companionDeleteMemory','companionTodo','companionDeleteTodo','companionChooseDirectory','companionRemoveDirectory','companionForget','companionSuggestion','recordToolUsage','getOptimizerState','optimizerSettings','optimizerForgetUsage','optimizerPropose','optimizerTrial','optimizerApply','optimizerRollback','optimizerDismiss','petInteraction','uiReady','authStatus','authLogin','authLogout','windowAction','info','listTools','listArchivedTools','saveTool','deleteTool','listVersions','restoreVersion','getSettings','saveSettings','engineStatus','generate','cancelGeneration','pickFiles','readFile','saveText','planRename','executeRename','undoOperation','listTasks','notify','openOutput','readClipboard','writeClipboard','updatePet','authorizeTool','runtimeInvoke','getPetState','petAction','pickPetImage','resetPetImage','generatePet'];
const api = Object.fromEntries(methods.map(method => [method, payload => ipcRenderer.invoke(`momo:${method}`, payload)]));
for (const [method, channel] of Object.entries({onCompanionState:'momo:companion-state',onOptimizerState:'momo:optimizer-state',onPetMotion:'momo:pet-motion',onWindowTransition:'momo:window-transition',onToolsChanged:'momo:tools-changed',onAuthState:'momo:auth-state',onGeneration:'momo:generation',onPetAction:'momo:pet-action',onPetState:'momo:pet-state'})) {
  api[method] = callback => {
    if (typeof callback !== 'function') throw new TypeError('事件订阅需要回调函数');
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  };
}
contextBridge.exposeInMainWorld('momoDesktop', Object.freeze(api));
