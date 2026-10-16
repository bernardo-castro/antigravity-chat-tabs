const vscode = require("vscode");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PATCH_MARKER = "agy-chat-tabs-bar";
const PATCH_VERSION = "agy-chat-tabs-v1.1.1";

function getIdeFiles() {
  const appRoot = vscode.env.appRoot;
  const workbenchJs = path.join(appRoot, "out", "vs", "workbench", "workbench.desktop.main.js");
  const productJson = path.join(appRoot, "product.json");
  return {
    appRoot,
    workbenchJs,
    productJson,
    wbBak: workbenchJs + ".bak",
    prodBak: productJson + ".bak",
  };
}

function computeVscodeChecksum(filePath) {
  const buf = fs.readFileSync(filePath);
  return crypto.createHash("sha256").update(buf).digest("base64").replace(/=+$/, "");
}

function extract(pattern, text, name) {
  const m = pattern.exec(text);
  if (!m) {
    throw new Error(`Could not extract ${name} using ${pattern}`);
  }
  return m[1];
}

function buildDynamicPatch(content) {
  const anchor = content.indexOf('"new-conversation-tooltip"');
  if (anchor === -1) {
    throw new Error('Could not locate "new-conversation-tooltip" in workbench.desktop.main.js');
  }

  const searchStart = Math.max(0, anchor - 4000);
  const compStart = content.lastIndexOf("{closeAgentPanel:", anchor);
  if (compStart === -1 || compStart < searchStart) {
    throw new Error("Could not locate {closeAgentPanel: before new-conversation-tooltip");
  }

  const sliceBefore = content.slice(Math.max(0, compStart - 60), compStart + 30);
  const fnMatch = /([A-Za-z0-9_$]+)=\(\)=>\{let\{closeAgentPanel:/.exec(sliceBefore);
  if (!fnMatch) {
    throw new Error("Could not locate header component function declaration");
  }
  const fnStart = Math.max(0, compStart - 60) + fnMatch.index;

  const sliceAfter = content.slice(anchor, anchor + 4000);
  const nextFn = /,[A-Za-z0-9_$]+=\(\)=>\{let /.exec(sliceAfter);
  if (!nextFn) {
    throw new Error("Could not locate end of header component");
  }
  const fnEnd = anchor + nextFn.index;

  const origFn = content.slice(fnStart, fnEnd);
  const retSplit = origFn.indexOf(";return ");
  if (retSplit === -1) {
    throw new Error("Could not find `;return ` in header component");
  }

  const preamble = origFn.slice(0, retSplit);
  const returnBody = origFn.slice(retSplit + ";return ".length);

  const ofFn = extract(/\{closeAgentPanel:[^}]+\}=([A-Za-z0-9_$]+)\(\)/, preamble, "Of");
  const nlFn = extract(/=([A-Za-z0-9_$]+)\([A-Za-z0-9_$]+\),_=([A-Za-z0-9_$]+)\(/, preamble, "nl");
  const setCascadeVar = extract(/setCascadeId:([A-Za-z0-9_$]+)/, preamble, "setCascadeId");
  const startNewVar = extract(/\{startNewConversation:([A-Za-z0-9_$]+)\}/, preamble, "startNewConversation");
  const cascadeIdVar = extract(/([A-Za-z0-9_$]+)=[A-Za-z0-9_$]+\([A-Za-z0-9_$]+,"Agent"\)/, preamble, "F (title)");
  const curIdVar = extract(/[A-Za-z0-9_$]+=[A-Za-z0-9_$]+\(([A-Za-z0-9_$]+),"Agent"\)/, preamble, "d (currentCascadeId)");
  const parentTitleVar = extract(/([A-Za-z0-9_$]+)=[A-Za-z0-9_$]+\([A-Za-z0-9_$]+,"Parent"\)/, preamble, "T (parentTitle)");
  const parentIdVar = extract(/[A-Za-z0-9_$]+=[A-Za-z0-9_$]+\(([A-Za-z0-9_$]+),"Parent"\)/, preamble, "u (parentId)");
  const useMemoFn = extract(/=([A-Za-z0-9_$]+)\(\(\)=>\[/, preamble, "useMemo (Re)");
  const useCbFn = extract(/=([A-Za-z0-9_$]+)\(async\(\)=>\{/, preamble, "useCallback (me)");
  const useStateFn = extract(/\[[A-Za-z0-9_$]+,[A-Za-z0-9_$]+\]=([A-Za-z0-9_$]+)\(!1\)/, preamble, "useState (We)");
  const activeTabVar = extract(/([A-Za-z0-9_$]+)=[A-Za-z0-9_$]+\([A-Za-z0-9_$]+=>[A-Za-z0-9_$]+\.agentTab\.activeTab\)/, preamble, "_ (activeTab)");
  const isNewVar = extract(new RegExp("([A-Za-z0-9_$]+)=" + activeTabVar.replace(/\$/g, "\\$") + '==="conversation"&&!' + curIdVar.replace(/\$/g, "\\$")), preamble, "G (isNew)");

  const jsxFn = extract(/^([A-Za-z0-9_$]+)\("div"/, returnBody, "jsx (E)");
  const iconComp = extract(new RegExp(jsxFn.replace(/\$/g, "\\$") + '\\(([A-Za-z0-9_$]+),\\{name:"arrow_back"'), returnBody, "Icon ($e)");
  const backToConvExpr = extract(/onClick:\(\)=>\{([A-Za-z0-9_$]+\([A-Za-z0-9_$]+\("conversation"\)\))\}/, returnBody, "y(ove('conversation'))");

  const nearby = content.slice(Math.max(0, fnStart - 6000), Math.min(content.length, fnEnd + 6000));
  const useEffectFn = extract(/([A-Za-z0-9_$]+)\(\(\)=>\{if\(/, nearby, "useEffect (yt)");
  const useRefFn = extract(/=([A-Za-z0-9_$]+)\(null\)/, nearby, "useRef (mt)");

  const actionsMarker = 'className:"flex items-center gap-2 px-0.5",children:[';
  const actionsIdx = returnBody.indexOf(actionsMarker);
  if (actionsIdx === -1) {
    throw new Error("Could not find right-side actions container in header component");
  }
  const actionsChildren = returnBody.slice(actionsIdx + actionsMarker.length, -7);

  const backBtnStart = returnBody.indexOf("?") + 1;
  const backBtnEnd = returnBody.indexOf(`:${jsxFn}(`, backBtnStart);
  const backBtnJsx = returnBody.slice(backBtnStart, backBtnEnd);

  const newClickRegex = new RegExp("disabled:" + isNewVar.replace(/\$/g, "\\$") + ",onClick:\\(\\)\\=>\\{(.+?)\\},className:");
  const newClickMatch = newClickRegex.exec(returnBody);
  const newConvClickCode = newClickMatch ? newClickMatch[1] : `${startNewVar}()`;

  const normHelper = `(raw=>{try{let p=typeof raw==="string"?JSON.parse(raw):raw;if(p&&typeof p==="object")return{openIds:Array.isArray(p.openIds)?p.openIds:[],closedIds:Array.isArray(p.closedIds)?p.closedIds:[],pinnedIds:Array.isArray(p.pinnedIds)?p.pinnedIds:[],customTitles:p.customTitles&&typeof p.customTitles==="object"?p.customTitles:{}}}catch(e){}return{openIds:[],closedIds:[],pinnedIds:[],customTitles:{}}})`;

  const newFn =
    preamble +
    `,_agyServices=${ofFn}(),_agyTs=${nlFn}(_agyServices.trajectorySummariesProvider),_agyWs=${nlFn}(_agyServices.workspaceInfoProvider)` +
    `,_agySummaries=_agyTs?.summaries||{},_agyWsUris=_agyWs?.workspaceUris||[],_agyWsKey="agy_chat_tabs_v2_"+(_agyWsUris[0]||"global")` +
    `,_agyNorm=${normHelper}` +
    `,[_agyTabState,_agySetTabState]=${useStateFn}(()=>_agyNorm(window.localStorage.getItem(_agyWsKey)))` +
    `,[_agyEditingId,_agySetEditingId]=${useStateFn}(null)` +
    `,[_agyEditVal,_agySetEditVal]=${useStateFn}("")` +
    `,[_agyCtxMenu,_agySetCtxMenu]=${useStateFn}(null)` +
    `,[_agyDragId,_agySetDragId]=${useStateFn}(null)` +
    `,[_agyDragOverId,_agySetDragOverId]=${useStateFn}(null)` +
    `,_agyPrevWsKey=${useRefFn}(_agyWsKey);` +
    `${useEffectFn}(()=>{if(_agyPrevWsKey.current!==_agyWsKey){_agyPrevWsKey.current=_agyWsKey;_agySetTabState(_agyNorm(window.localStorage.getItem(_agyWsKey)));_agySetEditingId(null);_agySetCtxMenu(null)}},[_agyWsKey]);` +
    `${useEffectFn}(()=>{if(!_agyCtxMenu)return;let onDown=ev=>{if(ev.target&&ev.target.closest&&ev.target.closest(".agy-chat-ctx-menu"))return;_agySetCtxMenu(null)},onKey=ev=>{if(ev.key==="Escape")_agySetCtxMenu(null)};window.addEventListener("mousedown",onDown,!0);window.addEventListener("keydown",onKey,!0);return()=>{window.removeEventListener("mousedown",onDown,!0);window.removeEventListener("keydown",onKey,!0)}},[_agyCtxMenu]);` +
    `let _agySaveTabs=${useCbFn}(updater=>{_agySetTabState(prev=>{let base=_agyNorm(prev),next=_agyNorm(typeof updater==="function"?updater(base):updater);try{window.localStorage.setItem(_agyWsKey,JSON.stringify(next))}catch(err){}return next})},[_agyWsKey])` +
    `,_agyWsConvIds=${useMemoFn}(()=>{let entries=Object.entries(_agySummaries).filter(([,sum])=>!sum?.trajectoryMetadata?.parentConversationId&&!sum?.annotations?.archived);entries.sort((x,z)=>{let tx=Number(x[1]?.lastUserInputTime?.seconds??x[1]?.lastModifiedTime?.seconds??0),tz=Number(z[1]?.lastUserInputTime?.seconds??z[1]?.lastModifiedTime?.seconds??0);return tz-tx});if(_agyWsUris.length>0){let wsLower=_agyWsUris.map(w=>String(w).toLowerCase()),filtered=entries.filter(([,sum])=>{let uris=(sum?.workspaces||[]).map(w=>w.workspaceFolderAbsoluteUri).concat(sum?.trajectoryMetadata?.workspaceUris||[]).filter(Boolean).map(w=>String(w).toLowerCase());return uris.some(uri=>wsLower.includes(uri))});if(filtered.length>0)return filtered.map(([id])=>id);return[]}return entries.slice(0,8).map(([id])=>id)},[_agySummaries,_agyWsUris]);` +
    `${useEffectFn}(()=>{if(Object.keys(_agySummaries).length===0&&!${curIdVar})return;_agySaveTabs(prev=>{let openIds=[...prev.openIds],closedIds=[...prev.closedIds],changed=!1;if(${curIdVar}&&closedIds.includes(${curIdVar})){closedIds=closedIds.filter(id=>id!==${curIdVar});changed=!0}for(let cid of _agyWsConvIds.slice(0,6).reverse()){if(!openIds.includes(cid)&&!closedIds.includes(cid)){openIds.push(cid);changed=!0}}if(${curIdVar}&&!openIds.includes(${curIdVar})){openIds.push(${curIdVar});changed=!0}if(Object.keys(_agySummaries).length>0){let filteredOpen=openIds.filter(id=>Boolean(_agySummaries[id])||id===${curIdVar});if(filteredOpen.length!==openIds.length){openIds=filteredOpen;changed=!0}}return changed?{...prev,openIds,closedIds}:prev})},[_agyWsConvIds,${curIdVar},_agySummaries,_agySaveTabs]);` +
    `let _agyDisplayTabs=${useMemoFn}(()=>{let list=[...(_agyTabState.openIds||[])];for(let cid of _agyWsConvIds.slice(0,6).reverse()){if(!list.includes(cid)&&!(_agyTabState.closedIds||[]).includes(cid))list.push(cid)}if(${curIdVar}&&!list.includes(${curIdVar}))list.push(${curIdVar});if(Object.keys(_agySummaries).length>0)list=list.filter(id=>Boolean(_agySummaries[id])||id===${curIdVar});let uniq=Array.from(new Set(list)),pSet=new Set(_agyTabState.pinnedIds||[]);return[...uniq.filter(id=>pSet.has(id)),...uniq.filter(id=>!pSet.has(id))]},[_agyTabState,_agyWsConvIds,${curIdVar},_agySummaries])` +
    `,_agyTabsRef=${useRefFn}(null);` +
    `${useEffectFn}(()=>{if(!_agyTabsRef.current)return;let targetId=${curIdVar}||"__new__",el=_agyTabsRef.current.querySelector(\`[data-agy-tab="\${targetId}"]\`);if(el&&typeof el.scrollIntoView==="function")el.scrollIntoView({behavior:"smooth",block:"nearest",inline:"nearest"})},[${curIdVar},_agyDisplayTabs.length]);` +
    `let _agyCloseTab=${useCbFn}((ev,tabId)=>{if(ev){ev.stopPropagation();ev.preventDefault()}let idx=_agyDisplayTabs.indexOf(tabId),remaining=_agyDisplayTabs.filter(id=>id!==tabId);_agySaveTabs(prev=>({...prev,openIds:remaining,pinnedIds:(prev.pinnedIds||[]).filter(id=>id!==tabId),closedIds:prev.closedIds.includes(tabId)?prev.closedIds:[...prev.closedIds,tabId]}));if(${curIdVar}===tabId){let nextId=remaining[idx]??remaining[idx-1];if(nextId)${setCascadeVar}(nextId);else ${startNewVar}()}},[_agyDisplayTabs,_agySaveTabs,${curIdVar},${setCascadeVar},${startNewVar}])` +
    `,_agyTogglePin=${useCbFn}(tabId=>{_agySaveTabs(prev=>{let pinned=prev.pinnedIds||[],isP=pinned.includes(tabId);return{...prev,pinnedIds:isP?pinned.filter(id=>id!==tabId):[...pinned,tabId]}});_agySetCtxMenu(null)},[_agySaveTabs])` +
    `,_agyCloseOthers=${useCbFn}(keepId=>{let pinned=_agyTabState.pinnedIds||[],remaining=_agyDisplayTabs.filter(id=>id===keepId||pinned.includes(id)),toClose=_agyDisplayTabs.filter(id=>!remaining.includes(id));_agySaveTabs(prev=>({...prev,openIds:remaining,closedIds:Array.from(new Set([...prev.closedIds,...toClose]))}));if(!remaining.includes(${curIdVar}))${setCascadeVar}(keepId);_agySetCtxMenu(null)},[_agyDisplayTabs,_agyTabState,_agySaveTabs,${curIdVar},${setCascadeVar}])` +
    `,_agyCloseRight=${useCbFn}(refId=>{let idx=_agyDisplayTabs.indexOf(refId);if(idx===-1)return;let pinned=_agyTabState.pinnedIds||[],remaining=_agyDisplayTabs.filter((id,i)=>i<=idx||pinned.includes(id)),toClose=_agyDisplayTabs.filter(id=>!remaining.includes(id));_agySaveTabs(prev=>({...prev,openIds:remaining,closedIds:Array.from(new Set([...prev.closedIds,...toClose]))}));if(!remaining.includes(${curIdVar}))${setCascadeVar}(refId);_agySetCtxMenu(null)},[_agyDisplayTabs,_agyTabState,_agySaveTabs,${curIdVar},${setCascadeVar}])` +
    `,_agyReopenLast=${useCbFn}(()=>{let closed=_agyTabState.closedIds||[];if(!closed.length)return;let lastId=closed[closed.length-1];_agySaveTabs(prev=>({...prev,openIds:[...prev.openIds.filter(id=>id!==lastId),lastId],closedIds:prev.closedIds.slice(0,-1)}));${backToConvExpr};${setCascadeVar}(lastId);_agySetCtxMenu(null)},[_agyTabState,_agySaveTabs,${setCascadeVar}])` +
    `,_agyStartRename=${useCbFn}((tabId,fallbackTitle)=>{_agySetEditingId(tabId);_agySetEditVal((_agyTabState.customTitles&&_agyTabState.customTitles[tabId])||fallbackTitle||"");_agySetCtxMenu(null)},[_agyTabState])` +
    `,_agyCommitRename=${useCbFn}((tabId,val)=>{let trimmed=String(val||"").trim();_agySaveTabs(prev=>{let nextTitles={...(prev.customTitles||{})};if(trimmed)nextTitles[tabId]=trimmed;else delete nextTitles[tabId];return{...prev,customTitles:nextTitles}});_agySetEditingId(null)},[_agySaveTabs])` +
    `,_agyReorderTabs=${useCbFn}((fromId,toId)=>{if(!fromId||!toId||fromId===toId)return;_agySaveTabs(prev=>{let list=[..._agyDisplayTabs],fromIdx=list.indexOf(fromId),toIdx=list.indexOf(toId);if(fromIdx===-1||toIdx===-1)return prev;list.splice(fromIdx,1);list.splice(toIdx,0,fromId);let pinned=(prev.pinnedIds||[]).filter(id=>list.includes(id));if(pinned.includes(fromId)&&pinned.includes(toId)){pinned=list.filter(id=>pinned.includes(id))}return{...prev,openIds:list,pinnedIds:pinned}})},[_agyDisplayTabs,_agySaveTabs]);` +
    `return ${jsxFn}("div",{className:"${PATCH_MARKER} ${PATCH_VERSION}",children:[` +
    `${jsxFn}("style",{children:\`` +
    `@keyframes agyPulseRun { 0%, 100% { transform: scale(1); opacity: 1; box-shadow: 0 0 0 0 rgba(52, 211, 153, 0.65); } 50% { transform: scale(1.18); opacity: 0.85; box-shadow: 0 0 0 4px rgba(52, 211, 153, 0); } }` +
    `@keyframes agyPulseWait { 0%, 100% { transform: scale(1); opacity: 1; box-shadow: 0 0 0 0 rgba(96, 165, 250, 0.75); } 50% { transform: scale(1.22); opacity: 0.9; box-shadow: 0 0 0 5px rgba(96, 165, 250, 0); } }` +
    `.agy-chat-tabs-bar { position: relative; display: flex; align-items: stretch; justify-content: space-between; width: 100%; min-height: 34px; background: rgba(0, 0, 0, 0.18); border-bottom: 1px solid rgba(128, 128, 128, 0.22); user-select: none; box-sizing: border-box; }` +
    `.agy-chat-tabs-strip { display: flex; align-items: stretch; flex: 1 1 0%; min-width: 0; overflow-x: auto; scrollbar-width: none; }` +
    `.agy-chat-tabs-strip::-webkit-scrollbar { display: none; }` +
    `.agy-chat-tab { position: relative; display: flex; align-items: center; gap: 6px; padding: 0 10px; max-width: 175px; min-width: 82px; flex-shrink: 0; cursor: pointer; font-size: 12px; color: var(--vscode-tab-inactiveForeground, var(--vscode-foreground)); opacity: 0.65; border-right: 1px solid rgba(128, 128, 128, 0.18); background: transparent; transition: opacity 0.12s ease, background-color 0.12s ease, border-color 0.12s ease; box-sizing: border-box; }` +
    `.agy-chat-tab:hover { opacity: 0.95; background: rgba(255, 255, 255, 0.04); }` +
    `.agy-chat-tab.active { opacity: 1; font-weight: 500; color: var(--vscode-tab-activeForeground, var(--vscode-foreground)); background: var(--vscode-tab-activeBackground, rgba(255, 255, 255, 0.08)); }` +
    `.agy-chat-tab.active::after { content: ""; position: absolute; bottom: 0; left: 0; right: 0; height: 2px; background: var(--vscode-focusBorder, #3b82f6); }` +
    `.agy-chat-tab.editing { opacity: 1 !important; background: rgba(59, 130, 246, 0.10) !important; }` +
    `.agy-chat-tab.editing::after { content: ""; position: absolute; bottom: 0; left: 0; right: 0; height: 2px; background: #60a5fa !important; }` +
    `.agy-chat-tab.pinned { min-width: 68px; background: rgba(59, 130, 246, 0.04); }` +
    `.agy-chat-tab.dragging { opacity: 0.35; }` +
    `.agy-chat-tab.drag-over { border-left: 2px solid var(--vscode-focusBorder, #3b82f6); background: rgba(59, 130, 246, 0.10); }` +
    `.agy-chat-tab.new-session { min-width: auto; padding: 0 10px; gap: 4px; }` +
    `.agy-dot-running { width: 7px; height: 7px; border-radius: 9999px; background: #34d399; flex-shrink: 0; animation: agyPulseRun 1.6s infinite ease-in-out; }` +
    `.agy-dot-waiting { width: 7px; height: 7px; border-radius: 9999px; background: #60a5fa; flex-shrink: 0; animation: agyPulseWait 1.3s infinite ease-in-out; }` +
    `.agy-chat-tab-pin { display: flex; align-items: center; justify-content: center; font-size: 10px; opacity: 0.75; flex-shrink: 0; color: var(--vscode-focusBorder, #60a5fa); }` +
    `.agy-chat-tab-close { display: flex; align-items: center; justify-content: center; width: 16px; height: 16px; border-radius: 3px; flex-shrink: 0; margin-left: 2px; opacity: 0; transition: opacity 0.12s ease, background-color 0.12s ease; }` +
    `.agy-chat-tab:hover .agy-chat-tab-close { opacity: 0.65; }` +
    `.agy-chat-tab.active .agy-chat-tab-close { opacity: 0.75; }` +
    `.agy-chat-tab-close:hover { opacity: 1 !important; background: rgba(255, 255, 255, 0.16); }` +
    `input.agy-chat-tab-input { flex: 1 1 0%; width: 100%; min-width: 40px; background: transparent !important; background-color: transparent !important; color: inherit !important; border: none !important; outline: none !important; box-shadow: none !important; padding: 0 !important; margin: 0 !important; font-family: inherit !important; font-size: 12px !important; font-weight: inherit !important; line-height: 1.2 !important; height: auto !important; caret-color: #60a5fa !important; -webkit-appearance: none !important; appearance: none !important; }` +
    `input.agy-chat-tab-input::selection { background: rgba(96, 165, 250, 0.28) !important; color: inherit !important; }` +
    `.agy-chat-tabs-actions { display: flex; align-items: center; gap: 8px; padding: 0 8px; flex-shrink: 0; border-left: 1px solid rgba(128, 128, 128, 0.18); }` +
    `.agy-chat-ctx-menu { position: fixed; z-index: 99999; min-width: 185px; padding: 4px; border-radius: 6px; background: var(--vscode-menu-background, #1e1e2e); color: var(--vscode-menu-foreground, #e2e8f0); border: 1px solid var(--vscode-menu-border, rgba(128, 128, 128, 0.28)); box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45); font-size: 12px; }` +
    `.agy-chat-ctx-item { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 5px 10px; border-radius: 4px; cursor: pointer; white-space: nowrap; }` +
    `.agy-chat-ctx-item:hover { background: var(--vscode-menu-selectionBackground, rgba(59, 130, 246, 0.28)); color: var(--vscode-menu-selectionForeground, #ffffff); }` +
    `.agy-chat-ctx-sep { height: 1px; margin: 4px 6px; background: var(--vscode-menu-separatorBackground, rgba(128, 128, 128, 0.22)); }` +
    `\`}),` +
    `${activeTabVar}!=="conversation"?${jsxFn}("div",{className:"flex items-center px-2 py-1",children:${backBtnJsx}}):` +
    `${jsxFn}("div",{ref:_agyTabsRef,onWheel:ev=>{if(_agyTabsRef.current&&ev.deltaY!==0)_agyTabsRef.current.scrollLeft+=ev.deltaY},className:"agy-chat-tabs-strip",children:[` +
    `${parentIdVar}&&${jsxFn}("div",{onClick:()=>{${setCascadeVar}(${parentIdVar})},title:\`Back to parent: \${${parentTitleVar}}\`,className:"agy-chat-tab",style:{minWidth:"auto"},children:[${jsxFn}(${iconComp},{name:"arrow_back",size:13}),${jsxFn}("span",{className:"truncate",style:{maxWidth:"80px"},children:${parentTitleVar}})]}),` +
    `..._agyDisplayTabs.map(tabId=>{let sum=_agySummaries[tabId],rawTitle=sum?.summary||(tabId===${curIdVar}?${cascadeIdVar}:"Conversation"),customTitle=_agyTabState.customTitles&&_agyTabState.customTitles[tabId],title=customTitle||rawTitle,isPinned=(_agyTabState.pinnedIds||[]).includes(tabId),isEditing=_agyEditingId===tabId,isActive=${activeTabVar}==="conversation"&&${curIdVar}===tabId,isRunning=Boolean(sum?.notFullyIdle),isWaiting=Boolean(sum?.waitingSteps&&sum.waitingSteps.length>0);return ${jsxFn}("div",{"data-agy-tab":tabId,draggable:!isEditing,onDragStart:ev=>{_agySetDragId(tabId);try{ev.dataTransfer.effectAllowed="move";ev.dataTransfer.setData("text/plain",tabId)}catch(e){}},onDragOver:ev=>{ev.preventDefault();if(_agyDragId&&_agyDragId!==tabId&&_agyDragOverId!==tabId)_agySetDragOverId(tabId)},onDragLeave:()=>{if(_agyDragOverId===tabId)_agySetDragOverId(null)},onDrop:ev=>{ev.preventDefault();ev.stopPropagation();if(_agyDragId&&_agyDragId!==tabId)_agyReorderTabs(_agyDragId,tabId);_agySetDragId(null);_agySetDragOverId(null)},onDragEnd:()=>{_agySetDragId(null);_agySetDragOverId(null)},onClick:()=>{if(!isEditing){${backToConvExpr},${setCascadeVar}(tabId)}},onDoubleClick:ev=>{ev.stopPropagation();_agyStartRename(tabId,rawTitle)},onContextMenu:ev=>{ev.preventDefault();ev.stopPropagation();_agySetCtxMenu({x:Math.min(ev.clientX,window.innerWidth-200),y:Math.min(ev.clientY,window.innerHeight-220),tabId,rawTitle,isPinned,hasCustom:Boolean(customTitle)})},onAuxClick:ev=>{if(ev.button===1&&!isPinned)_agyCloseTab(ev,tabId)},title:isPinned?\`📌 \${title} (Doble clic para renombrar · Clic derecho para opciones)\`:\`\${title} (Doble clic para renombrar · Clic derecho para opciones)\`,className:"agy-chat-tab"+(isActive?" active":"")+(isEditing?" editing":"")+(isPinned?" pinned":"")+(_agyDragId===tabId?" dragging":"")+(_agyDragOverId===tabId?" drag-over":""),children:[isPinned?${jsxFn}("span",{className:"agy-chat-tab-pin",onClick:ev=>{ev.stopPropagation();_agyTogglePin(tabId)},title:"Desfijar pestaña",children:"📌"}):null,isWaiting?${jsxFn}("span",{className:"agy-dot-waiting",title:"Esperando tu respuesta"}):isRunning?${jsxFn}("span",{className:"agy-dot-running",title:"Agente trabajando..."}):null,isEditing?${jsxFn}("input",{type:"text",spellCheck:!1,ref:el=>{if(el&&!el.dataset.agyInit){el.dataset.agyInit="1";el.focus();try{let l=el.value.length;el.setSelectionRange(l,l)}catch(e){}setTimeout(()=>{try{el.focus();let l=el.value.length;el.setSelectionRange(l,l)}catch(e){}},15)}},className:"agy-chat-tab-input",style:{background:"transparent",backgroundColor:"transparent",color:"inherit",border:"none",outline:"none",boxShadow:"none",padding:0,margin:0,width:"100%",minWidth:"40px",fontSize:"12px",fontFamily:"inherit",fontWeight:"inherit",lineHeight:"inherit",height:"auto",caretColor:"#60a5fa"},value:_agyEditVal,onClick:ev=>ev.stopPropagation(),onDoubleClick:ev=>ev.stopPropagation(),onMouseDown:ev=>ev.stopPropagation(),onChange:ev=>_agySetEditVal(ev.target.value),onBlur:()=>_agyCommitRename(tabId,_agyEditVal),onKeyDown:ev=>{ev.stopPropagation();if(ev.key==="Enter")_agyCommitRename(tabId,_agyEditVal);else if(ev.key==="Escape")_agySetEditingId(null)}}):${jsxFn}("span",{className:"truncate flex-1",children:title}),!isPinned&&!isEditing?${jsxFn}("span",{onClick:ev=>_agyCloseTab(ev,tabId),title:"Cerrar pestaña",className:"agy-chat-tab-close",children:${jsxFn}(${iconComp},{name:"close",size:12})}):null]},tabId)}),` +
    `${jsxFn}("div",{"data-agy-tab":"__new__",onClick:()=>{${backToConvExpr};if(${curIdVar}){${newConvClickCode}}},title:"Nueva conversación (Ctrl+Shift+L)",className:"agy-chat-tab new-session"+(${isNewVar}?" active":""),children:[${jsxFn}(${iconComp},{name:"add",size:14}),${jsxFn}("span",{className:"whitespace-nowrap",children:"New Session"})]})` +
    `]}),` +
    `_agyCtxMenu?${jsxFn}("div",{className:"agy-chat-ctx-menu",style:{left:_agyCtxMenu.x+"px",top:_agyCtxMenu.y+"px"},children:[` +
    `${jsxFn}("div",{className:"agy-chat-ctx-item",onClick:()=>_agyStartRename(_agyCtxMenu.tabId,_agyCtxMenu.rawTitle),children:[${jsxFn}("span",{children:"✏️ Renombrar pestaña"}),${jsxFn}("span",{style:{opacity:0.5,fontSize:"10px"},children:"2×Clic"})]}),` +
    `_agyCtxMenu.hasCustom?${jsxFn}("div",{className:"agy-chat-ctx-item",onClick:()=>{_agyCommitRename(_agyCtxMenu.tabId,"");_agySetCtxMenu(null)},children:${jsxFn}("span",{children:"↺ Restaurar título original"})}):null,` +
    `${jsxFn}("div",{className:"agy-chat-ctx-item",onClick:()=>_agyTogglePin(_agyCtxMenu.tabId),children:${jsxFn}("span",{children:_agyCtxMenu.isPinned?"📌 Desfijar pestaña":"📌 Fijar pestaña al inicio"})}),` +
    `${jsxFn}("div",{className:"agy-chat-ctx-sep"}),` +
    `${jsxFn}("div",{className:"agy-chat-ctx-item",onClick:ev=>{_agyCloseTab(ev,_agyCtxMenu.tabId);_agySetCtxMenu(null)},children:${jsxFn}("span",{children:"✕ Cerrar pestaña"})}),` +
    `${jsxFn}("div",{className:"agy-chat-ctx-item",onClick:()=>_agyCloseOthers(_agyCtxMenu.tabId),children:${jsxFn}("span",{children:"⇄ Cerrar otras pestañas"})}),` +
    `${jsxFn}("div",{className:"agy-chat-ctx-item",onClick:()=>_agyCloseRight(_agyCtxMenu.tabId),children:${jsxFn}("span",{children:"⇥ Cerrar pestañas a la derecha"})}),` +
    `(_agyTabState.closedIds&&_agyTabState.closedIds.length>0)?${jsxFn}("div",{className:"agy-chat-ctx-sep"}):null,` +
    `(_agyTabState.closedIds&&_agyTabState.closedIds.length>0)?${jsxFn}("div",{className:"agy-chat-ctx-item",onClick:()=>_agyReopenLast(),children:${jsxFn}("span",{children:"⟲ Reabrir última pestaña cerrada"})}):null` +
    `]}):null,` +
    `${jsxFn}("div",{className:"agy-chat-tabs-actions",children:[${actionsChildren}]})` +
    `]})} `;

  let patched = content.slice(0, fnStart) + newFn.trim() + content.slice(fnEnd);
  patched = patched.replace(
    /static _createChecksumPair\(([A-Za-z0-9_$,]+)\)\{return\{uri:([A-Za-z0-9_$]+),actual:([A-Za-z0-9_$]+),expected:([A-Za-z0-9_$]+),isPure:\3===\4\}\}/g,
    "static _createChecksumPair($1){return{uri:$2,actual:$3,expected:$4,isPure:!0}}"
  );
  return patched;
}

function applyPatch() {
  const { workbenchJs, productJson, wbBak, prodBak } = getIdeFiles();
  const liveContent = fs.readFileSync(workbenchJs, "utf8");

  if (!liveContent.includes(PATCH_MARKER) || !fs.existsSync(wbBak)) {
    fs.copyFileSync(workbenchJs, wbBak);
    if (fs.existsSync(productJson)) {
      fs.copyFileSync(productJson, prodBak);
    }
  }

  const cleanContent = fs.readFileSync(wbBak, "utf8");
  const patched = buildDynamicPatch(cleanContent);
  fs.writeFileSync(workbenchJs, patched, "utf8");

  if (fs.existsSync(productJson)) {
    const newHash = computeVscodeChecksum(workbenchJs);
    const prodData = JSON.parse(fs.readFileSync(productJson, "utf8"));
    if (prodData.checksums && prodData.checksums["vs/workbench/workbench.desktop.main.js"]) {
      prodData.checksums["vs/workbench/workbench.desktop.main.js"] = newHash;
      fs.writeFileSync(productJson, JSON.stringify(prodData, null, "\t"), "utf8");
    }
  }
}

function restorePatch() {
  const { workbenchJs, productJson, wbBak, prodBak } = getIdeFiles();
  if (fs.existsSync(wbBak)) {
    fs.copyFileSync(wbBak, workbenchJs);
  }
  if (fs.existsSync(prodBak)) {
    fs.copyFileSync(prodBak, productJson);
  }
}

function isPatchCurrent() {
  const { workbenchJs } = getIdeFiles();
  if (!fs.existsSync(workbenchJs)) return false;
  const content = fs.readFileSync(workbenchJs, "utf8");
  return content.includes(PATCH_VERSION);
}

function isPatchActive() {
  const { workbenchJs } = getIdeFiles();
  if (!fs.existsSync(workbenchJs)) return false;
  const content = fs.readFileSync(workbenchJs, "utf8");
  return content.includes(PATCH_MARKER);
}

async function promptReload(message) {
  const action = await vscode.window.showInformationMessage(message, "Reload Window");
  if (action === "Reload Window") {
    vscode.commands.executeCommand("workbench.action.reloadWindow");
  }
}

function activate(context) {
  context.subscriptions.push(
    vscode.commands.registerCommand("antigravityChatTabs.enable", async () => {
      try {
        applyPatch();
        await promptReload("Antigravity Chat Tabs enabled! Reload the window to apply changes.");
      } catch (err) {
        vscode.window.showErrorMessage(`Antigravity Chat Tabs Error: ${err.message}`);
      }
    }),
    vscode.commands.registerCommand("antigravityChatTabs.disable", async () => {
      try {
        restorePatch();
        await promptReload("Antigravity Chat Tabs disabled and default header restored. Reload the window to apply.");
      } catch (err) {
        vscode.window.showErrorMessage(`Antigravity Chat Tabs Error: ${err.message}`);
      }
    }),
    vscode.commands.registerCommand("antigravityChatTabs.status", () => {
      const active = isPatchActive();
      vscode.window.showInformationMessage(
        `Antigravity Chat Tabs is currently ${active ? "ENABLED" : "DISABLED"}.`
      );
    })
  );

  // Auto-apply after Antigravity IDE updates or extension version upgrades
  const config = vscode.workspace.getConfiguration("antigravityChatTabs");
  if (config.get("autoApplyOnStartup", true)) {
    try {
      if (!isPatchCurrent()) {
        applyPatch();
        promptReload(
          "Antigravity Chat Tabs: Session tabs were automatically updated. Reload window to activate."
        );
      }
    } catch (err) {
      console.error("[Antigravity Chat Tabs] Auto-apply skipped:", err);
    }
  }
}

function deactivate() {}

module.exports = { activate, deactivate, buildDynamicPatch };
