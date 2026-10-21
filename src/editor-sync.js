// An async save may finish after navigation or another edit. Only the same
// editing session learns its version; only unchanged input becomes saved.
export function editorSync(current,snapshot,result){
 const sameEditor=Boolean(current&&snapshot&&current.epoch===snapshot.epoch&&current.id===snapshot.id);
 const unchanged=sameEditor&&(current.version||0)<=(result.version||0)&&['config','title','prompt','bundle'].every(key=>JSON.stringify(current[key])===JSON.stringify(snapshot[key]));
 return{sameEditor,unchanged};
}
